mod binary;
mod protocol;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use ce_core::config::settings::AppSettings;
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex, RwLock};
use tokio::time::{sleep, timeout};
use tracing::{debug, info, warn};

#[cfg(test)]
use tokio::sync::broadcast;

use binary::{codex_process_path, resolve_codex_binary};
use protocol::{
    classify_message, request_id_key, should_surface_server_request, validate_server_response,
    InboundMessage,
};

const RPC_TIMEOUT: Duration = Duration::from_secs(120);
const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(350);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CodexServerState {
    Stopped,
    Starting,
    Ready,
    Stopping,
    Failed,
    Missing,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexServerStatus {
    pub state: CodexServerState,
    pub running: bool,
    pub ready: bool,
    pub generation: u64,
    pub codex_path: Option<String>,
    pub version: Option<String>,
    pub last_error: Option<String>,
}

impl Default for CodexServerStatus {
    fn default() -> Self {
        Self::new(CodexServerState::Stopped, 0, None, None, None)
    }
}

impl CodexServerStatus {
    fn new(
        state: CodexServerState,
        generation: u64,
        codex_path: Option<String>,
        version: Option<String>,
        last_error: Option<String>,
    ) -> Self {
        Self {
            state,
            running: matches!(
                state,
                CodexServerState::Starting | CodexServerState::Ready | CodexServerState::Stopping
            ),
            ready: state == CodexServerState::Ready,
            generation,
            codex_path,
            version,
            last_error,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexEvent {
    pub generation: u64,
    pub method: String,
    pub params: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingServerRequest {
    pub generation: u64,
    pub id: Value,
    pub method: String,
    pub params: Value,
    pub received_at_ms: u64,
}

struct PendingRpc {
    generation: u64,
    sender: oneshot::Sender<Result<Value, String>>,
}

#[derive(Default)]
struct Lifecycle {
    generation: u64,
    child: Option<Child>,
    stdin: Option<Arc<Mutex<ChildStdin>>>,
}

pub struct CodexAppServer {
    app_handle: OnceLock<AppHandle>,
    status: RwLock<CodexServerStatus>,
    lifecycle: Mutex<Lifecycle>,
    operation_lock: Mutex<()>,
    request_id: AtomicU64,
    generation: AtomicU64,
    pending_rpcs: Mutex<HashMap<u64, PendingRpc>>,
    pending_server_requests: Mutex<HashMap<String, PendingServerRequest>>,
    #[cfg(test)]
    test_events: broadcast::Sender<CodexEvent>,
}

impl CodexAppServer {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            app_handle: OnceLock::new(),
            status: RwLock::new(CodexServerStatus::default()),
            lifecycle: Mutex::new(Lifecycle::default()),
            operation_lock: Mutex::new(()),
            request_id: AtomicU64::new(1),
            generation: AtomicU64::new(0),
            pending_rpcs: Mutex::new(HashMap::new()),
            pending_server_requests: Mutex::new(HashMap::new()),
            #[cfg(test)]
            test_events: broadcast::channel(512).0,
        })
    }

    #[cfg(test)]
    fn subscribe_test_events(&self) -> broadcast::Receiver<CodexEvent> {
        self.test_events.subscribe()
    }

    pub fn attach_app(&self, app_handle: AppHandle) {
        let _ = self.app_handle.set(app_handle);
    }

    pub async fn status(&self) -> CodexServerStatus {
        self.status.read().await.clone()
    }

    pub async fn start(self: &Arc<Self>) -> Result<CodexServerStatus, String> {
        let _operation = self.operation_lock.lock().await;
        self.start_locked().await
    }

    pub async fn restart(self: &Arc<Self>) -> Result<CodexServerStatus, String> {
        let _operation = self.operation_lock.lock().await;
        self.stop_locked().await?;
        self.start_locked().await
    }

    pub async fn stop(self: &Arc<Self>) -> Result<CodexServerStatus, String> {
        let _operation = self.operation_lock.lock().await;
        self.stop_locked().await
    }

    pub async fn request(
        self: &Arc<Self>,
        method: &'static str,
        params: Value,
    ) -> Result<Value, String> {
        self.ensure_started().await?;
        let generation = self.status.read().await.generation;
        self.send_request_for_generation(generation, method, Some(params), false)
            .await
    }

    pub async fn request_no_params(
        self: &Arc<Self>,
        method: &'static str,
    ) -> Result<Value, String> {
        self.ensure_started().await?;
        let generation = self.status.read().await.generation;
        self.send_request_for_generation(generation, method, None, false)
            .await
    }

    pub async fn pending_server_requests(&self) -> Vec<PendingServerRequest> {
        let generation = self.status.read().await.generation;
        let mut requests: Vec<_> = self
            .pending_server_requests
            .lock()
            .await
            .values()
            .filter(|request| request.generation == generation)
            .cloned()
            .collect();
        requests.sort_by_key(|request| request.received_at_ms);
        requests
    }

    pub async fn respond_to_server_request(
        self: &Arc<Self>,
        id: Value,
        response: Value,
    ) -> Result<(), String> {
        self.ensure_started().await?;
        let generation = self.status.read().await.generation;
        let key = server_request_key(generation, &id)?;
        let pending = self
            .pending_server_requests
            .lock()
            .await
            .get(&key)
            .cloned()
            .ok_or_else(|| "server request is no longer pending".to_string())?;

        validate_server_response(&pending.method, &response)?;
        let claimed = self.pending_server_requests.lock().await.remove(&key);
        if claimed.is_none() {
            return Err("server request is already being answered".to_string());
        }
        match self
            .write_for_generation(generation, &json!({ "id": id, "result": response }))
            .await
        {
            Ok(()) => Ok(()),
            Err(error) => {
                self.handle_connection_end(generation, &error).await;
                Err(error)
            }
        }
    }

    async fn ensure_started(self: &Arc<Self>) -> Result<(), String> {
        if self.status.read().await.ready {
            return Ok(());
        }
        self.start().await.map(|_| ())
    }

    async fn start_locked(self: &Arc<Self>) -> Result<CodexServerStatus, String> {
        self.start_locked_with_binary(None).await
    }

    async fn start_locked_with_binary(
        self: &Arc<Self>,
        binary_override: Option<PathBuf>,
    ) -> Result<CodexServerStatus, String> {
        if self.status.read().await.ready {
            return Ok(self.status().await);
        }

        // Clean up a stale child from an earlier failed start before advancing
        // the generation. This is idempotent when no process is present.
        self.stop_process_only(None).await;

        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.set_status(CodexServerStatus::new(
            CodexServerState::Starting,
            generation,
            None,
            None,
            None,
        ))
        .await;

        let binary = match binary_override {
            Some(binary) => binary,
            None => {
                let settings = AppSettings::load().unwrap_or_else(|error| {
                    warn!(error = %sanitize_message(&error.to_string()), "failed to load settings for Codex path");
                    AppSettings::default()
                });
                match resolve_codex_binary(settings.codex_path.as_deref()) {
                    Ok(binary) => binary,
                    Err(error) => {
                        let error = sanitize_message(&error);
                        self.set_status(CodexServerStatus::new(
                            CodexServerState::Missing,
                            generation,
                            None,
                            None,
                            Some(error.clone()),
                        ))
                        .await;
                        return Err(error);
                    }
                }
            }
        };
        let codex_path = binary.to_string_lossy().to_string();
        let version = read_codex_version(&binary).await;
        self.set_status(CodexServerStatus::new(
            CodexServerState::Starting,
            generation,
            Some(codex_path.clone()),
            version.clone(),
            None,
        ))
        .await;

        let mut command = Command::new(&binary);
        command
            .args(["app-server", "--listen", "stdio://"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = codex_process_path(&binary) {
            command.env("PATH", path);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let error = sanitize_message(&format!("failed to start Codex app-server: {error}"));
                self.set_status(CodexServerStatus::new(
                    CodexServerState::Failed,
                    generation,
                    Some(codex_path),
                    version,
                    Some(error.clone()),
                ))
                .await;
                return Err(error);
            }
        };

        let (Some(stdin), Some(stdout), Some(stderr)) =
            (child.stdin.take(), child.stdout.take(), child.stderr.take())
        else {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let error = "Codex app-server did not expose its stdio pipes".to_string();
            self.set_status(CodexServerStatus::new(
                CodexServerState::Failed,
                generation,
                Some(codex_path),
                version,
                Some(error.clone()),
            ))
            .await;
            return Err(error);
        };
        let process_id = child.id();

        {
            let mut lifecycle = self.lifecycle.lock().await;
            lifecycle.generation = generation;
            lifecycle.stdin = Some(Arc::new(Mutex::new(stdin)));
            lifecycle.child = Some(child);
        }

        self.spawn_stdout_reader(generation, stdout);
        self.spawn_stderr_reader(generation, stderr);
        self.spawn_process_monitor(generation);

        let initialize = json!({
            "clientInfo": {
                "name": "code_engine",
                "title": "Code Engine",
                "version": env!("CARGO_PKG_VERSION")
            }
        });
        if let Err(error) = self
            .send_request_for_generation(generation, "initialize", Some(initialize), true)
            .await
        {
            self.fail_generation(generation, &error).await;
            return Err(error);
        }
        if let Err(error) = self
            .send_notification_for_generation(generation, "initialized", json!({}))
            .await
        {
            self.fail_generation(generation, &error).await;
            return Err(error);
        }

        info!(generation, process_id, path = %codex_path, "Codex app-server is ready");
        self.set_status(CodexServerStatus::new(
            CodexServerState::Ready,
            generation,
            Some(codex_path),
            version,
            None,
        ))
        .await;
        Ok(self.status().await)
    }

    async fn stop_locked(self: &Arc<Self>) -> Result<CodexServerStatus, String> {
        let current = self.status().await;
        if matches!(current.state, CodexServerState::Stopped) {
            return Ok(current);
        }

        self.set_status(CodexServerStatus::new(
            CodexServerState::Stopping,
            current.generation,
            current.codex_path.clone(),
            current.version.clone(),
            None,
        ))
        .await;

        self.stop_process_only(Some(current.generation)).await;
        self.fail_pending_generation(current.generation, "Codex app-server stopped")
            .await;
        self.clear_server_requests_generation(current.generation)
            .await;
        self.set_status(CodexServerStatus::new(
            CodexServerState::Stopped,
            current.generation,
            current.codex_path,
            current.version,
            None,
        ))
        .await;
        Ok(self.status().await)
    }

    async fn stop_process_only(&self, expected_generation: Option<u64>) {
        let child = {
            let mut lifecycle = self.lifecycle.lock().await;
            if expected_generation.is_some_and(|generation| lifecycle.generation != generation) {
                return;
            }
            lifecycle.stdin = None;
            lifecycle.child.take()
        };
        if let Some(mut child) = child {
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }

    async fn fail_generation(self: &Arc<Self>, generation: u64, error: &str) {
        let error = sanitize_message(error);
        let current = self.status().await;
        self.stop_process_only(Some(generation)).await;
        self.fail_pending_generation(generation, &error).await;
        self.clear_server_requests_generation(generation).await;
        if current.generation == generation && self.status.read().await.generation == generation {
            self.set_status(CodexServerStatus::new(
                CodexServerState::Failed,
                generation,
                current.codex_path,
                current.version,
                Some(error),
            ))
            .await;
        }
    }

    async fn send_request_for_generation(
        self: &Arc<Self>,
        generation: u64,
        method: &'static str,
        params: Option<Value>,
        allow_starting: bool,
    ) -> Result<Value, String> {
        let status = self.status().await;
        let accepts_requests =
            status.ready || (allow_starting && status.state == CodexServerState::Starting);
        if status.generation != generation || !accepts_requests {
            return Err("Codex app-server is not ready".to_string());
        }

        let id = self.request_id.fetch_add(1, Ordering::Relaxed);
        let (sender, receiver) = oneshot::channel();
        self.pending_rpcs
            .lock()
            .await
            .insert(id, PendingRpc { generation, sender });

        let mut message = json!({ "id": id, "method": method });
        if let Some(params) = params {
            message["params"] = params;
        }
        if let Err(error) = self.write_for_generation(generation, &message).await {
            self.pending_rpcs.lock().await.remove(&id);
            self.handle_connection_end(generation, &error).await;
            return Err(error);
        }

        match timeout(RPC_TIMEOUT, receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err(format!("Codex request {method} was cancelled")),
            Err(_) => {
                self.pending_rpcs.lock().await.remove(&id);
                Err(format!("Codex request {method} timed out"))
            }
        }
    }

    async fn send_notification_for_generation(
        &self,
        generation: u64,
        method: &'static str,
        params: Value,
    ) -> Result<(), String> {
        self.write_for_generation(generation, &json!({ "method": method, "params": params }))
            .await
    }

    async fn write_for_generation(&self, generation: u64, message: &Value) -> Result<(), String> {
        let stdin = {
            let lifecycle = self.lifecycle.lock().await;
            if lifecycle.generation != generation {
                return Err("Codex app-server generation changed".to_string());
            }
            lifecycle
                .stdin
                .clone()
                .ok_or_else(|| "Codex app-server stdin is closed".to_string())?
        };

        let mut serialized = serde_json::to_vec(message)
            .map_err(|error| format!("failed to serialize Codex request: {error}"))?;
        serialized.push(b'\n');
        let mut stdin = stdin.lock().await;
        stdin
            .write_all(&serialized)
            .await
            .map_err(|error| format!("failed to write to Codex app-server: {error}"))?;
        stdin
            .flush()
            .await
            .map_err(|error| format!("failed to flush Codex app-server stdin: {error}"))
    }

    fn spawn_stdout_reader(self: &Arc<Self>, generation: u64, stdout: tokio::process::ChildStdout) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(message) => manager.handle_message(generation, message).await,
                        Err(error) => warn!(
                            generation,
                            error = %sanitize_message(&error.to_string()),
                            "ignored malformed Codex app-server JSON"
                        ),
                    },
                    Ok(None) => {
                        manager
                            .handle_connection_end(generation, "Codex app-server stdout closed")
                            .await;
                        break;
                    }
                    Err(error) => {
                        manager
                            .handle_connection_end(
                                generation,
                                &format!("failed to read Codex app-server stdout: {error}"),
                            )
                            .await;
                        break;
                    }
                }
            }
        });
    }

    fn spawn_stderr_reader(self: &Arc<Self>, generation: u64, stderr: tokio::process::ChildStderr) {
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                debug!(
                    target: "codex_app_server",
                    generation,
                    message = %sanitize_stderr(&line),
                    "Codex app-server stderr"
                );
            }
        });
    }

    fn spawn_process_monitor(self: &Arc<Self>, generation: u64) {
        let manager = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                sleep(PROCESS_POLL_INTERVAL).await;
                let process_status = {
                    let mut lifecycle = manager.lifecycle.lock().await;
                    if lifecycle.generation != generation {
                        return;
                    }
                    let Some(child) = lifecycle.child.as_mut() else {
                        return;
                    };
                    child.try_wait()
                };

                match process_status {
                    Ok(Some(status)) => {
                        manager
                            .handle_connection_end(
                                generation,
                                &format!("Codex app-server exited with {status}"),
                            )
                            .await;
                        return;
                    }
                    Ok(None) => {}
                    Err(error) => {
                        manager
                            .handle_connection_end(
                                generation,
                                &format!("failed to inspect Codex app-server: {error}"),
                            )
                            .await;
                        return;
                    }
                }
            }
        });
    }

    async fn handle_message(self: &Arc<Self>, generation: u64, message: Value) {
        if self.status.read().await.generation != generation {
            return;
        }

        match classify_message(message) {
            Ok(InboundMessage::Response { id, result, error }) => {
                let Some(id) = id.as_u64() else {
                    warn!(
                        generation,
                        "ignored Codex response with a non-numeric client id"
                    );
                    return;
                };
                let pending = self.pending_rpcs.lock().await.remove(&id);
                let Some(pending) = pending else {
                    debug!(
                        generation,
                        request_id = id,
                        "ignored late or unknown Codex response"
                    );
                    return;
                };
                if pending.generation != generation {
                    return;
                }
                let response = match error {
                    Some(error) => Err(format_rpc_error(&error)),
                    None => Ok(result.unwrap_or(Value::Null)),
                };
                let _ = pending.sender.send(response);
            }
            Ok(InboundMessage::ServerRequest { id, method, params }) => {
                if !should_surface_server_request(&method) {
                    warn!(
                        generation,
                        method, "rejected unsupported Codex server request"
                    );
                    let error = json!({
                        "id": id,
                        "error": {
                            "code": -32601,
                            "message": format!("Unsupported server request method: {method}"),
                        }
                    });
                    if let Err(error) = self.write_for_generation(generation, &error).await {
                        self.handle_connection_end(generation, &error).await;
                    }
                    return;
                }
                let request = PendingServerRequest {
                    generation,
                    id: id.clone(),
                    method,
                    params,
                    received_at_ms: unix_time_ms(),
                };
                let key = match server_request_key(generation, &id) {
                    Ok(key) => key,
                    Err(error) => {
                        warn!(generation, error = %error, "ignored invalid Codex server request id");
                        return;
                    }
                };
                let status = self.status.read().await;
                if status.generation != generation {
                    return;
                }
                self.pending_server_requests
                    .lock()
                    .await
                    .insert(key, request.clone());
                drop(status);
                self.emit("codex:server-request", &request);
            }
            Ok(InboundMessage::Notification { method, params }) => {
                if method == "serverRequest/resolved" {
                    if let Some(request_id) = params.get("requestId") {
                        if let Ok(key) = server_request_key(generation, request_id) {
                            self.pending_server_requests.lock().await.remove(&key);
                        }
                    }
                }
                let event = CodexEvent {
                    generation,
                    method,
                    params,
                };
                #[cfg(test)]
                let _ = self.test_events.send(event.clone());
                self.emit("codex:event", &event);
            }
            Err(error) => {
                warn!(generation, error = %sanitize_message(&error), "ignored invalid Codex message")
            }
        }
    }

    async fn handle_connection_end(self: &Arc<Self>, generation: u64, error: &str) {
        let current = self.status().await;
        if current.generation != generation
            || matches!(
                current.state,
                CodexServerState::Stopped | CodexServerState::Failed | CodexServerState::Missing
            )
        {
            return;
        }

        let stopping = current.state == CodexServerState::Stopping;
        self.stop_process_only(Some(generation)).await;
        self.fail_pending_generation(generation, error).await;
        self.clear_server_requests_generation(generation).await;
        if self.status.read().await.generation != generation {
            return;
        }
        let state = if stopping {
            CodexServerState::Stopped
        } else {
            CodexServerState::Failed
        };
        self.set_status(CodexServerStatus::new(
            state,
            generation,
            current.codex_path,
            current.version,
            (!stopping).then(|| sanitize_message(error)),
        ))
        .await;
    }

    async fn fail_pending_generation(&self, generation: u64, error: &str) {
        let mut pending = self.pending_rpcs.lock().await;
        let ids: Vec<_> = pending
            .iter()
            .filter_map(|(id, request)| (request.generation == generation).then_some(*id))
            .collect();
        for id in ids {
            if let Some(request) = pending.remove(&id) {
                let _ = request.sender.send(Err(sanitize_message(error)));
            }
        }
    }

    async fn clear_server_requests_generation(&self, generation: u64) {
        self.pending_server_requests
            .lock()
            .await
            .retain(|_, request| request.generation != generation);
    }

    async fn set_status(&self, status: CodexServerStatus) {
        *self.status.write().await = status.clone();
        self.emit("codex:status", &status);
    }

    fn emit<T: Serialize + Clone>(&self, event: &str, payload: &T) {
        if let Some(app_handle) = self.app_handle.get() {
            if let Err(error) = app_handle.emit(event, payload) {
                debug!(event, error = %sanitize_message(&error.to_string()), "failed to emit Tauri event");
            }
        }
    }
}

async fn read_codex_version(binary: &Path) -> Option<String> {
    let output = timeout(
        VERSION_TIMEOUT,
        Command::new(binary).arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    (!version.is_empty()).then(|| sanitize_message(&version))
}

fn format_rpc_error(error: &Value) -> String {
    let code = error.get("code").and_then(Value::as_i64);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("Codex app-server request failed");
    match code {
        Some(code) => sanitize_message(&format!("Codex error {code}: {message}")),
        None => sanitize_message(message),
    }
}

fn server_request_key(generation: u64, id: &Value) -> Result<String, String> {
    Ok(format!("{generation}:{}", request_id_key(id)?))
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn sanitize_stderr(message: &str) -> String {
    let lowercase = message.to_ascii_lowercase();
    if [
        "authorization:",
        "bearer ",
        "access_token",
        "refresh_token",
        "id_token",
        "api_key",
        "sk-",
    ]
    .iter()
    .any(|needle| lowercase.contains(needle))
    {
        return "[redacted potentially sensitive Codex diagnostic]".to_string();
    }
    sanitize_message(message)
}

fn sanitize_message(message: &str) -> String {
    let message = message.replace(['\r', '\n'], " ");
    let mut output: String = message.chars().take(1_000).collect();
    if message.chars().count() > 1_000 {
        output.push('…');
    }
    output
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
    use std::{fs, time::Duration};

    use serde_json::{json, to_value};
    use tokio::{sync::broadcast, time::timeout};

    use super::{sanitize_stderr, CodexAppServer, CodexServerState, CodexServerStatus};

    #[test]
    fn status_serializes_with_frontend_contract_names() {
        let status = CodexServerStatus::new(
            CodexServerState::Ready,
            4,
            Some("/opt/homebrew/bin/codex".to_string()),
            Some("codex-cli test".to_string()),
            None,
        );
        let json = to_value(status).unwrap();
        assert_eq!(json["state"], "ready");
        assert_eq!(json["generation"], 4);
        assert_eq!(json["codexPath"], "/opt/homebrew/bin/codex");
        assert_eq!(json["running"], true);
        assert_eq!(json["ready"], true);
    }

    #[test]
    fn stderr_sanitizer_redacts_likely_credentials() {
        assert_eq!(
            sanitize_stderr("Authorization: Bearer secret-value"),
            "[redacted potentially sensitive Codex diagnostic]"
        );
        assert_eq!(sanitize_stderr("listener started"), "listener started");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn manages_fake_app_server_lifecycle_and_correlates_requests() {
        let temp_dir =
            std::env::temp_dir().join(format!("code-engine-codex-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_dir).unwrap();
        let binary = temp_dir.join("codex");
        fs::write(
            &binary,
            r#"#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "codex-cli fake-test"
  exit 0
fi
while IFS= read -r line; do
  case "$line" in
    *'"method":"initialize"'*)
      printf '%s\n' '{"id":1,"result":{"userAgent":"fake"}}'
      ;;
    *'"method":"account/read"'*)
      printf '%s\n' '{"id":2,"result":{"account":null,"requiresOpenaiAuth":true}}'
      ;;
  esac
done
"#,
        )
        .unwrap();
        let mut permissions = fs::metadata(&binary).unwrap().permissions();
        permissions.set_mode(0o700);
        fs::set_permissions(&binary, permissions).unwrap();

        let manager = CodexAppServer::new();
        {
            let _operation = manager.operation_lock.lock().await;
            let status = manager
                .start_locked_with_binary(Some(binary.clone()))
                .await
                .unwrap();
            assert_eq!(status.state, CodexServerState::Ready);
            assert_eq!(status.version.as_deref(), Some("codex-cli fake-test"));
        }

        let account = manager
            .request("account/read", json!({ "refreshToken": false }))
            .await
            .unwrap();
        assert_eq!(account["requiresOpenaiAuth"], true);
        assert_eq!(
            manager.stop().await.unwrap().state,
            CodexServerState::Stopped
        );

        fs::remove_file(binary).unwrap();
        fs::remove_dir(temp_dir).unwrap();
    }

    #[tokio::test]
    #[ignore = "requires a locally installed Codex CLI and may contact the Codex service"]
    async fn live_installed_codex_smoke_test() {
        let manager = CodexAppServer::new();
        let status = manager.start().await.unwrap();
        assert_eq!(status.state, CodexServerState::Ready);

        let account = manager
            .request("account/read", json!({ "refreshToken": false }))
            .await
            .unwrap();
        assert!(account.is_object());
        let models = manager
            .request("model/list", json!({ "limit": 20, "includeHidden": false }))
            .await
            .unwrap();
        assert!(models["data"].is_array());
        manager.stop().await.unwrap();
    }

    #[tokio::test]
    #[ignore = "uses the installed Codex account to run and archive one read-only model turn"]
    async fn live_installed_codex_turn_stream_smoke_test() {
        let workspace =
            std::env::temp_dir().join(format!("code-engine-live-turn-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&workspace).unwrap();

        let manager = CodexAppServer::new();
        let mut events = manager.subscribe_test_events();
        let status = manager.start().await.unwrap();
        assert_eq!(status.state, CodexServerState::Ready);

        let models = manager
            .request("model/list", json!({ "limit": 50, "includeHidden": false }))
            .await
            .unwrap();
        let available = models["data"].as_array().expect("model/list data array");
        let selected = available
            .iter()
            .find(|model| model["isDefault"] == true)
            .or_else(|| available.first())
            .and_then(|model| model["model"].as_str())
            .expect("at least one usable Codex model")
            .to_string();
        let cwd = workspace.to_string_lossy().to_string();

        let started = manager
            .request(
                "thread/start",
                json!({
                    "cwd": cwd,
                    "model": selected,
                    "approvalPolicy": "never",
                    "sandbox": "read-only",
                    "sessionStartSource": "startup"
                }),
            )
            .await
            .unwrap();
        let thread_id = started["thread"]["id"]
            .as_str()
            .expect("thread/start thread id")
            .to_string();

        let turn = manager
            .request(
                "turn/start",
                json!({
                    "threadId": thread_id,
                    "input": [{
                        "type": "text",
                        "text": "Reply with exactly CODE_ENGINE_SMOKE_OK and do not use tools.",
                        "text_elements": []
                    }],
                    "cwd": workspace.to_string_lossy(),
                    "model": selected,
                    "approvalPolicy": "never",
                    "sandboxPolicy": { "type": "readOnly", "networkAccess": false }
                }),
            )
            .await
            .unwrap();
        let turn_id = turn["turn"]["id"]
            .as_str()
            .expect("turn/start turn id")
            .to_string();

        let streamed = timeout(Duration::from_secs(120), async {
            let mut text = String::new();
            let mut saw_delta = false;
            loop {
                let event = match events.recv().await {
                    Ok(event) => event,
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(error) => panic!("Codex event stream closed: {error}"),
                };
                if event.params["threadId"].as_str() != Some(thread_id.as_str()) {
                    continue;
                }
                if event.method == "item/agentMessage/delta"
                    && event.params["turnId"].as_str() == Some(turn_id.as_str())
                {
                    saw_delta = true;
                    text.push_str(event.params["delta"].as_str().unwrap_or_default());
                }
                if event.method == "turn/completed"
                    && event.params["turn"]["id"].as_str() == Some(turn_id.as_str())
                {
                    return (saw_delta, text, event.params["turn"]["status"].clone());
                }
            }
        })
        .await
        .expect("Codex turn should complete within two minutes");

        manager
            .request("thread/archive", json!({ "threadId": thread_id }))
            .await
            .unwrap();
        manager.stop().await.unwrap();
        fs::remove_dir_all(workspace).unwrap();

        assert_eq!(streamed.2, "completed");
        assert!(
            streamed.0,
            "expected at least one streamed agent-message delta"
        );
        assert!(
            streamed.1.contains("CODE_ENGINE_SMOKE_OK"),
            "unexpected streamed response: {}",
            streamed.1
        );
    }
}
