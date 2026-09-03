use std::collections::{HashMap, HashSet};
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStderr, ChildStdin, Command};
use tokio::sync::{Mutex, RwLock};
use tokio::time::{sleep, timeout};
use tracing::debug;
use url::Url;

const MAX_HEADER_BYTES: usize = 16 * 1024;
const MAX_BODY_BYTES: usize = 8 * 1024 * 1024;
const READ_CHUNK_BYTES: usize = 8 * 1024;
const MAX_BUFFER_BYTES: usize = MAX_HEADER_BYTES + MAX_BODY_BYTES + READ_CHUNK_BYTES;
const MAX_MESSAGES_PER_CHUNK: usize = 128;
const MAX_STDERR_LINE_BYTES: usize = 4 * 1024;
const MAX_STDERR_MESSAGES: usize = 128;
const MAX_STATUS_ERROR_CHARS: usize = 2_048;
const MAX_SEARCH_DIRECTORIES: usize = 256;
const STOP_TIMEOUT: Duration = Duration::from_secs(3);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(150);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LspState {
    Starting,
    Running,
    Stopping,
    Stopped,
    Failed,
    Missing,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LspStatus {
    pub server_id: String,
    pub label: String,
    pub generation: u64,
    pub root: String,
    pub state: LspState,
    pub executable: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct LspMessageEvent {
    server_id: String,
    label: String,
    generation: u64,
    root: String,
    message: Value,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct LspServerSpec {
    id: &'static str,
    label: &'static str,
    executable_names: &'static [&'static str],
    args: &'static [&'static str],
}

const SERVER_SPECS: &[LspServerSpec] = &[
    LspServerSpec {
        id: "typescript",
        label: "TypeScript",
        executable_names: &["typescript-language-server"],
        args: &["--stdio"],
    },
    LspServerSpec {
        id: "rust",
        label: "Rust Analyzer",
        executable_names: &["rust-analyzer"],
        args: &[],
    },
    LspServerSpec {
        id: "python",
        label: "Python",
        executable_names: &["basedpyright-langserver", "pyright-langserver"],
        args: &["--stdio"],
    },
    LspServerSpec {
        id: "json",
        label: "JSON",
        executable_names: &["vscode-json-language-server"],
        args: &["--stdio"],
    },
    LspServerSpec {
        id: "css",
        label: "CSS",
        executable_names: &["vscode-css-language-server"],
        args: &["--stdio"],
    },
    LspServerSpec {
        id: "html",
        label: "HTML",
        executable_names: &["vscode-html-language-server"],
        args: &["--stdio"],
    },
];

#[derive(Debug, Clone, PartialEq, Eq)]
struct SessionIdentity {
    generation: u64,
    root: PathBuf,
}

#[derive(Clone)]
struct ActiveSession {
    identity: SessionIdentity,
    spec: LspServerSpec,
    executable: PathBuf,
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    stopping: Arc<AtomicBool>,
    exit_requested: Arc<AtomicBool>,
    last_stderr: Arc<Mutex<Option<String>>>,
}

pub struct LspHost {
    app_handle: OnceLock<AppHandle>,
    lifecycle: Mutex<()>,
    sessions: Mutex<HashMap<String, ActiveSession>>,
    statuses: RwLock<HashMap<String, LspStatus>>,
    next_generation: AtomicU64,
}

impl LspHost {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            app_handle: OnceLock::new(),
            lifecycle: Mutex::new(()),
            sessions: Mutex::new(HashMap::new()),
            statuses: RwLock::new(HashMap::new()),
            next_generation: AtomicU64::new(1),
        })
    }

    pub fn attach_app(&self, app_handle: AppHandle) {
        let _ = self.app_handle.set(app_handle);
    }

    pub async fn start(
        self: &Arc<Self>,
        server_id: &str,
        root: PathBuf,
        configured_executable: Option<&str>,
    ) -> Result<LspStatus, String> {
        let spec = server_spec(server_id)
            .ok_or_else(|| format!("unsupported language server: {server_id}"))?;
        let root = root
            .canonicalize()
            .map_err(|error| format!("failed to resolve LSP workspace root: {error}"))?;
        if !root.is_dir() {
            return Err("LSP workspace root is not a directory".to_string());
        }
        let root_string = path_string(&root)?;
        let executable_result = resolve_lsp_executable(spec, configured_executable);

        let _lifecycle = self.lifecycle.lock().await;
        let existing = {
            let sessions = self.sessions.lock().await;
            sessions.get(spec.id).cloned()
        };
        if let Some(existing) = existing {
            let reusable = executable_result.as_ref().is_ok_and(|executable| {
                existing.identity.root == root && existing.executable == *executable
            });
            if reusable {
                if let Some(status) = self.status_for(spec.id).await {
                    if matches!(status.state, LspState::Starting | LspState::Running) {
                        return Ok(status);
                    }
                }
            }
            if let Err(error) = self.stop_locked(&existing).await {
                if self.is_current(&existing).await {
                    return Err(error);
                }
            }
        }

        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let executable = match executable_result {
            Ok(executable) => executable,
            Err(error) => {
                self.set_status(status_for(
                    spec,
                    generation,
                    &root_string,
                    LspState::Missing,
                    None,
                    Some(error.clone()),
                ))
                .await;
                return Err(error);
            }
        };
        let starting = status_for(
            spec,
            generation,
            &root_string,
            LspState::Starting,
            Some(&executable),
            None,
        );
        self.set_status(starting).await;

        let mut command = Command::new(&executable);
        command
            .args(spec.args)
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        if let Some(path) = lsp_process_path(&executable) {
            command.env("PATH", path);
        }

        #[cfg(windows)]
        {
            command.creation_flags(0x0800_0000);
        }

        let mut child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                let message = sanitize_message(&format!(
                    "failed to start {} language server: {error}",
                    spec.label
                ));
                self.set_status(status_for(
                    spec,
                    generation,
                    &root_string,
                    LspState::Failed,
                    Some(&executable),
                    Some(message.clone()),
                ))
                .await;
                return Err(message);
            }
        };

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| format!("{} language server stdin was not captured", spec.label))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| format!("{} language server stdout was not captured", spec.label))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| format!("{} language server stderr was not captured", spec.label))?;

        let session = ActiveSession {
            identity: SessionIdentity { generation, root },
            spec,
            executable: executable.clone(),
            stdin: Arc::new(Mutex::new(stdin)),
            child: Arc::new(Mutex::new(child)),
            stopping: Arc::new(AtomicBool::new(false)),
            exit_requested: Arc::new(AtomicBool::new(false)),
            last_stderr: Arc::new(Mutex::new(None)),
        };
        self.sessions
            .lock()
            .await
            .insert(spec.id.to_string(), session.clone());

        let running = status_for(
            spec,
            generation,
            &root_string,
            LspState::Running,
            Some(&executable),
            None,
        );
        self.set_status(running.clone()).await;
        self.spawn_stdout_reader(session.clone(), stdout);
        self.spawn_stderr_reader(session.clone(), stderr);
        self.spawn_process_monitor(session);
        Ok(running)
    }

    pub async fn send_json(
        &self,
        server_id: &str,
        generation: u64,
        root: &Path,
        message: &str,
    ) -> Result<(), String> {
        let message = parse_outbound_message(message, root)?;
        let frame = frame_message(&message)?;
        let session = self.require_session(server_id, generation, root).await?;
        self.write_frame(&session, &frame).await?;
        if message.get("method").and_then(Value::as_str) == Some("exit") {
            session.exit_requested.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub async fn stop(
        &self,
        server_id: &str,
        generation: u64,
        root: &Path,
    ) -> Result<LspStatus, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let session = match self.require_session(server_id, generation, root).await {
            Ok(session) => session,
            Err(error) => {
                if let Some(status) = self.status_for(server_id).await.filter(|status| {
                    status.generation == generation
                        && Path::new(&status.root) == root
                        && status.state == LspState::Stopped
                }) {
                    return Ok(status);
                }
                return Err(error);
            }
        };
        self.stop_locked(&session).await
    }

    pub async fn stop_all(&self) -> Result<Vec<LspStatus>, String> {
        let _lifecycle = self.lifecycle.lock().await;
        let sessions: Vec<_> = self.sessions.lock().await.values().cloned().collect();
        let mut statuses = Vec::with_capacity(sessions.len());
        for session in sessions {
            match self.stop_locked(&session).await {
                Ok(status) => statuses.push(status),
                Err(_) if !self.is_current(&session).await => {}
                Err(error) => return Err(error),
            }
        }
        Ok(statuses)
    }

    pub async fn statuses(&self, root: &Path) -> Vec<LspStatus> {
        let mut statuses: Vec<_> = self
            .statuses
            .read()
            .await
            .values()
            .filter(|status| Path::new(&status.root) == root)
            .cloned()
            .collect();
        statuses.sort_by(|left, right| left.server_id.cmp(&right.server_id));
        statuses
    }

    async fn stop_locked(&self, session: &ActiveSession) -> Result<LspStatus, String> {
        if !self.is_current(session).await {
            return Err("language server generation is no longer active".to_string());
        }

        session.stopping.store(true, Ordering::Release);
        let root = path_string(&session.identity.root)?;
        self.set_status(status_for(
            session.spec,
            session.identity.generation,
            &root,
            LspState::Stopping,
            Some(&session.executable),
            None,
        ))
        .await;

        {
            let mut stdin = session.stdin.lock().await;
            let _ = stdin.shutdown().await;
        }

        let stop_result = timeout(STOP_TIMEOUT, async {
            let mut child = session.child.lock().await;
            match child
                .try_wait()
                .map_err(|error| sanitize_message(&error.to_string()))?
            {
                Some(_) => Ok(()),
                None => match child.kill().await {
                    Ok(()) => Ok(()),
                    Err(_) if child.try_wait().ok().flatten().is_some() => Ok(()),
                    Err(error) => Err(sanitize_message(&error.to_string())),
                },
            }
        })
        .await;

        match stop_result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => {
                session.stopping.store(false, Ordering::Release);
                return Err(format!(
                    "failed to stop {} language server: {error}",
                    session.spec.label
                ));
            }
            Err(_) => {
                session.stopping.store(false, Ordering::Release);
                return Err(format!(
                    "timed out stopping {} language server",
                    session.spec.label
                ));
            }
        }

        self.remove_if_current(session).await;
        let stopped = status_for(
            session.spec,
            session.identity.generation,
            &root,
            LspState::Stopped,
            Some(&session.executable),
            None,
        );
        self.set_status(stopped.clone()).await;
        Ok(stopped)
    }

    async fn require_session(
        &self,
        server_id: &str,
        generation: u64,
        root: &Path,
    ) -> Result<ActiveSession, String> {
        let sessions = self.sessions.lock().await;
        let session = sessions
            .get(server_id)
            .ok_or_else(|| format!("{server_id} language server is not running"))?;
        if !identity_matches(&session.identity, generation, root) {
            return Err("language server generation or workspace does not match".to_string());
        }
        Ok(session.clone())
    }

    async fn is_current(&self, session: &ActiveSession) -> bool {
        self.sessions
            .lock()
            .await
            .get(session.spec.id)
            .is_some_and(|current| current.identity == session.identity)
    }

    async fn remove_if_current(&self, session: &ActiveSession) -> bool {
        let mut sessions = self.sessions.lock().await;
        if sessions
            .get(session.spec.id)
            .is_some_and(|current| current.identity == session.identity)
        {
            sessions.remove(session.spec.id);
            true
        } else {
            false
        }
    }

    async fn write_frame(&self, session: &ActiveSession, frame: &[u8]) -> Result<(), String> {
        if !self.is_current(session).await {
            return Err("language server generation is no longer active".to_string());
        }
        let mut stdin = session.stdin.lock().await;
        if !self.is_current(session).await {
            return Err("language server generation is no longer active".to_string());
        }
        stdin
            .write_all(frame)
            .await
            .map_err(|error| sanitize_message(&format!("failed to write LSP message: {error}")))?;
        stdin
            .flush()
            .await
            .map_err(|error| sanitize_message(&format!("failed to flush LSP message: {error}")))
    }

    fn spawn_stdout_reader(
        self: &Arc<Self>,
        session: ActiveSession,
        stdout: tokio::process::ChildStdout,
    ) {
        let host = self.clone();
        tokio::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut decoder = LspFrameDecoder::default();
            let mut chunk = [0_u8; READ_CHUNK_BYTES];

            loop {
                let read = match reader.read(&mut chunk).await {
                    Ok(0) => break,
                    Ok(read) => read,
                    Err(error) => {
                        host.fail_generation(
                            &session,
                            format!("failed to read language server output: {error}"),
                        )
                        .await;
                        return;
                    }
                };

                let messages = match decoder.push(&chunk[..read]) {
                    Ok(messages) => messages,
                    Err(error) => {
                        host.fail_generation(&session, error).await;
                        return;
                    }
                };
                for message in messages {
                    if !host.is_current(&session).await {
                        return;
                    }
                    if let Some(response) =
                        server_request_response(&message, &session.identity.root)
                    {
                        let frame = match frame_message(&response) {
                            Ok(frame) => frame,
                            Err(error) => {
                                host.fail_generation(&session, error).await;
                                return;
                            }
                        };
                        if let Err(error) = host.write_frame(&session, &frame).await {
                            host.fail_generation(&session, error).await;
                            return;
                        }
                        continue;
                    }
                    host.emit_message(&session, message).await;
                }
            }

            if host.is_current(&session).await
                && !session.stopping.load(Ordering::Acquire)
                && !session.exit_requested.load(Ordering::Acquire)
            {
                host.fail_generation(
                    &session,
                    "language server closed its output stream unexpectedly".to_string(),
                )
                .await;
            }
        });
    }

    fn spawn_stderr_reader(self: &Arc<Self>, session: ActiveSession, stderr: ChildStderr) {
        tokio::spawn(async move {
            drain_stderr(stderr, session.spec, session.last_stderr).await;
        });
    }

    fn spawn_process_monitor(self: &Arc<Self>, session: ActiveSession) {
        let host = self.clone();
        tokio::spawn(async move {
            loop {
                sleep(PROCESS_POLL_INTERVAL).await;
                let result = {
                    let mut child = session.child.lock().await;
                    child.try_wait()
                };
                match result {
                    Ok(Some(exit)) => {
                        host.handle_process_exit(&session, exit.to_string()).await;
                        return;
                    }
                    Ok(None) => {
                        if !host.is_current(&session).await {
                            return;
                        }
                    }
                    Err(error) => {
                        host.fail_generation(
                            &session,
                            format!("failed to inspect language server process: {error}"),
                        )
                        .await;
                        return;
                    }
                }
            }
        });
    }

    async fn handle_process_exit(&self, session: &ActiveSession, exit: String) {
        if !self.remove_if_current(session).await {
            return;
        }
        let Ok(root) = path_string(&session.identity.root) else {
            return;
        };
        if session.stopping.load(Ordering::Acquire)
            || session.exit_requested.load(Ordering::Acquire)
        {
            self.set_status(status_for(
                session.spec,
                session.identity.generation,
                &root,
                LspState::Stopped,
                Some(&session.executable),
                None,
            ))
            .await;
            return;
        }

        if let Some(existing) = self.status_for(session.spec.id).await.filter(|status| {
            status.generation == session.identity.generation && status.state == LspState::Failed
        }) {
            self.set_status(existing).await;
            return;
        }

        let stderr = session.last_stderr.lock().await.clone();
        let detail = stderr
            .filter(|message| !message.is_empty())
            .map(|message| format!(" ({message})"))
            .unwrap_or_default();
        let error = sanitize_message(&format!(
            "{} language server exited unexpectedly: {exit}{detail}",
            session.spec.label
        ));
        self.set_status(status_for(
            session.spec,
            session.identity.generation,
            &root,
            LspState::Failed,
            Some(&session.executable),
            Some(error),
        ))
        .await;
    }

    async fn fail_generation(&self, session: &ActiveSession, error: String) {
        if !self.is_current(session).await {
            return;
        }
        let Ok(root) = path_string(&session.identity.root) else {
            return;
        };
        let error = sanitize_message(&error);
        self.set_status(status_for(
            session.spec,
            session.identity.generation,
            &root,
            LspState::Failed,
            Some(&session.executable),
            Some(error),
        ))
        .await;
        let mut child = session.child.lock().await;
        if child.try_wait().ok().flatten().is_none() {
            let _ = child.start_kill();
        }
    }

    async fn emit_message(&self, session: &ActiveSession, message: Value) {
        if !self.is_current(session).await {
            return;
        }
        let Ok(root) = path_string(&session.identity.root) else {
            return;
        };
        self.emit(
            "lsp:message",
            &LspMessageEvent {
                server_id: session.spec.id.to_string(),
                label: session.spec.label.to_string(),
                generation: session.identity.generation,
                root,
                message,
            },
        );
    }

    async fn status_for(&self, server_id: &str) -> Option<LspStatus> {
        self.statuses.read().await.get(server_id).cloned()
    }

    async fn set_status(&self, status: LspStatus) {
        self.statuses
            .write()
            .await
            .insert(status.server_id.clone(), status.clone());
        self.emit("lsp:status", &status);
    }

    fn emit<T: Serialize + Clone>(&self, event: &str, payload: &T) {
        if let Some(app_handle) = self.app_handle.get() {
            if let Err(error) = app_handle.emit(event, payload) {
                debug!(
                    event,
                    error = %sanitize_message(&error.to_string()),
                    "failed to emit LSP Tauri event"
                );
            }
        }
    }
}

fn status_for(
    spec: LspServerSpec,
    generation: u64,
    root: &str,
    state: LspState,
    executable: Option<&Path>,
    error: Option<String>,
) -> LspStatus {
    LspStatus {
        server_id: spec.id.to_string(),
        label: spec.label.to_string(),
        generation,
        root: root.to_string(),
        state,
        executable: executable.and_then(|path| path.to_str().map(str::to_owned)),
        error,
    }
}

fn identity_matches(identity: &SessionIdentity, generation: u64, root: &Path) -> bool {
    identity.generation == generation && identity.root == root
}

fn server_spec(server_id: &str) -> Option<LspServerSpec> {
    SERVER_SPECS
        .iter()
        .find(|spec| spec.id == server_id)
        .copied()
}

#[derive(Default)]
struct LspFrameDecoder {
    buffer: Vec<u8>,
}

impl LspFrameDecoder {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<Value>, String> {
        if self.buffer.len().saturating_add(chunk.len()) > MAX_BUFFER_BYTES {
            return Err("language server message buffer exceeded its limit".to_string());
        }
        self.buffer.extend_from_slice(chunk);
        let mut messages = Vec::new();

        loop {
            let Some((header_end, delimiter_length)) = find_header_end(&self.buffer) else {
                if self.buffer.len() > MAX_HEADER_BYTES {
                    return Err("language server message headers exceeded their limit".to_string());
                }
                break;
            };
            if header_end > MAX_HEADER_BYTES {
                return Err("language server message headers exceeded their limit".to_string());
            }
            let content_length = parse_content_length(&self.buffer[..header_end])?;
            if content_length > MAX_BODY_BYTES {
                return Err("language server message body exceeded its limit".to_string());
            }
            let body_start = header_end + delimiter_length;
            let body_end = body_start
                .checked_add(content_length)
                .ok_or_else(|| "language server content length overflowed".to_string())?;
            if self.buffer.len() < body_end {
                break;
            }

            let message: Value = serde_json::from_slice(&self.buffer[body_start..body_end])
                .map_err(|error| sanitize_message(&format!("invalid LSP JSON message: {error}")))?;
            if !message.is_object() {
                return Err("language server sent a non-object JSON-RPC message".to_string());
            }
            self.buffer.drain(..body_end);
            messages.push(message);
            if messages.len() > MAX_MESSAGES_PER_CHUNK {
                return Err("language server sent too many messages at once".to_string());
            }
        }

        Ok(messages)
    }
}

fn find_header_end(buffer: &[u8]) -> Option<(usize, usize)> {
    buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| (index, 4))
        .or_else(|| {
            buffer
                .windows(2)
                .position(|window| window == b"\n\n")
                .map(|index| (index, 2))
        })
}

fn parse_content_length(headers: &[u8]) -> Result<usize, String> {
    let headers = std::str::from_utf8(headers)
        .map_err(|_| "language server sent non-UTF-8 headers".to_string())?;
    let mut content_length = None;
    for line in headers.lines() {
        let line = line.trim_end_matches('\r');
        let (name, value) = line
            .split_once(':')
            .ok_or_else(|| "language server sent a malformed header".to_string())?;
        if name.trim().eq_ignore_ascii_case("content-length") {
            if content_length.is_some() {
                return Err("language server sent duplicate Content-Length headers".to_string());
            }
            let length = value
                .trim()
                .parse::<usize>()
                .map_err(|_| "language server sent an invalid Content-Length".to_string())?;
            content_length = Some(length);
        }
    }
    content_length.ok_or_else(|| "language server message is missing Content-Length".to_string())
}

fn frame_message(message: &Value) -> Result<Vec<u8>, String> {
    if !message.is_object() {
        return Err("LSP message must be a JSON object".to_string());
    }
    let body = serde_json::to_vec(message)
        .map_err(|error| sanitize_message(&format!("failed to encode LSP message: {error}")))?;
    if body.len() > MAX_BODY_BYTES {
        return Err("LSP message body exceeded its limit".to_string());
    }
    let header = format!("Content-Length: {}\r\n\r\n", body.len());
    let mut frame = Vec::with_capacity(header.len() + body.len());
    frame.extend_from_slice(header.as_bytes());
    frame.extend_from_slice(&body);
    Ok(frame)
}

fn parse_outbound_message(message: &str, root: &Path) -> Result<Value, String> {
    if message.len() > MAX_BODY_BYTES {
        return Err("LSP message body exceeded its limit".to_string());
    }
    let message: Value = serde_json::from_str(message)
        .map_err(|error| sanitize_message(&format!("invalid outbound LSP JSON: {error}")))?;
    validate_outbound_message(&message, root)?;
    Ok(message)
}

fn validate_outbound_message(message: &Value, root: &Path) -> Result<(), String> {
    let object = message
        .as_object()
        .ok_or_else(|| "outbound LSP message must be a JSON object".to_string())?;
    if object.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Err("outbound LSP message must use JSON-RPC 2.0".to_string());
    }
    if let Some(id) = object.get("id") {
        if !(id.is_null() || id.is_string() || id.is_number()) {
            return Err("outbound LSP request id must be a string or number".to_string());
        }
    }
    let method = object
        .get("method")
        .and_then(Value::as_str)
        .ok_or_else(|| "outbound LSP message must include a method".to_string())?;
    if !allowed_client_method(method) {
        return Err(format!("outbound LSP method is not allowed: {method}"));
    }
    let params = object.get("params").unwrap_or(&Value::Null);

    if method == "initialize" {
        let params = params
            .as_object()
            .ok_or_else(|| "initialize params must be a JSON object".to_string())?;
        if let Some(root_uri) = params.get("rootUri").filter(|value| !value.is_null()) {
            let root_uri = root_uri
                .as_str()
                .ok_or_else(|| "initialize rootUri must be a string or null".to_string())?;
            validate_file_uri(root_uri, root, true, false)?;
        }
        if let Some(root_path) = params.get("rootPath").filter(|value| !value.is_null()) {
            let root_path = root_path
                .as_str()
                .ok_or_else(|| "initialize rootPath must be a string or null".to_string())?;
            let canonical = Path::new(root_path)
                .canonicalize()
                .map_err(|_| "initialize rootPath does not exist".to_string())?;
            if canonical != root {
                return Err("initialize rootPath is not the active workspace".to_string());
            }
        }
        if let Some(folders) = params
            .get("workspaceFolders")
            .filter(|value| !value.is_null())
        {
            validate_workspace_folders(folders, root)?;
        }
    }

    if method.starts_with("textDocument/") {
        let uri = params
            .get("textDocument")
            .and_then(|document| document.get("uri"))
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{method} requires a textDocument file URI"))?;
        validate_file_uri(uri, root, false, true)?;
    }

    validate_embedded_file_uris(message, root)
}

fn allowed_client_method(method: &str) -> bool {
    matches!(
        method,
        "initialize"
            | "initialized"
            | "shutdown"
            | "exit"
            | "$/cancelRequest"
            | "workspace/didChangeConfiguration"
            | "workspace/symbol"
            | "textDocument/didOpen"
            | "textDocument/didChange"
            | "textDocument/didClose"
            | "textDocument/didSave"
            | "textDocument/willSave"
            | "textDocument/willSaveWaitUntil"
            | "textDocument/completion"
            | "textDocument/hover"
            | "textDocument/signatureHelp"
            | "textDocument/declaration"
            | "textDocument/definition"
            | "textDocument/typeDefinition"
            | "textDocument/implementation"
            | "textDocument/references"
            | "textDocument/documentHighlight"
            | "textDocument/documentSymbol"
            | "textDocument/codeAction"
            | "textDocument/codeLens"
            | "textDocument/formatting"
            | "textDocument/rangeFormatting"
            | "textDocument/onTypeFormatting"
            | "textDocument/rename"
            | "textDocument/prepareRename"
            | "textDocument/foldingRange"
            | "textDocument/selectionRange"
            | "textDocument/semanticTokens/full"
            | "textDocument/semanticTokens/full/delta"
            | "textDocument/semanticTokens/range"
            | "textDocument/diagnostic"
            | "textDocument/inlayHint"
    )
}

fn validate_workspace_folders(folders: &Value, root: &Path) -> Result<(), String> {
    let folders = folders
        .as_array()
        .ok_or_else(|| "workspaceFolders must be an array or null".to_string())?;
    if folders.len() != 1 {
        return Err("language servers may access only the active workspace folder".to_string());
    }
    let uri = folders[0]
        .get("uri")
        .and_then(Value::as_str)
        .ok_or_else(|| "workspace folder is missing a file URI".to_string())?;
    validate_file_uri(uri, root, true, false)
}

fn validate_embedded_file_uris(value: &Value, root: &Path) -> Result<(), String> {
    match value {
        Value::Array(values) => {
            for value in values {
                validate_embedded_file_uris(value, root)?;
            }
        }
        Value::Object(object) => {
            for (key, value) in object {
                if matches!(
                    key.as_str(),
                    "uri" | "rootUri" | "targetUri" | "oldUri" | "newUri"
                ) {
                    if let Some(uri) = value.as_str() {
                        if Url::parse(uri)
                            .ok()
                            .is_some_and(|parsed| parsed.scheme() == "file")
                        {
                            validate_file_uri(uri, root, false, false)?;
                        }
                    }
                }
                validate_embedded_file_uris(value, root)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_file_uri(
    uri: &str,
    root: &Path,
    exact_root: bool,
    require_file: bool,
) -> Result<(), String> {
    let uri = Url::parse(uri).map_err(|_| "language server URI is invalid".to_string())?;
    if uri.scheme() != "file" {
        return Err("language server document URI must use the file scheme".to_string());
    }
    let path = uri
        .to_file_path()
        .map_err(|_| "language server file URI could not be resolved".to_string())?;
    let path_exists = path.exists();
    let path = canonicalize_for_scope(&path)?;
    let in_scope = if exact_root {
        path == root
    } else {
        path.starts_with(root)
    };
    if !in_scope || is_recovery_trash_path(root, &path) {
        return Err("language server file URI is outside the active workspace".to_string());
    }
    if require_file && path_exists && !path.is_file() {
        return Err("language server text document URI is not a file".to_string());
    }
    Ok(())
}

fn canonicalize_for_scope(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|_| "language server file URI could not be resolved".to_string());
    }

    let mut ancestor = path;
    while !ancestor.exists() {
        ancestor = ancestor
            .parent()
            .ok_or_else(|| "language server file URI has no existing parent".to_string())?;
    }
    let suffix = path
        .strip_prefix(ancestor)
        .map_err(|_| "language server file URI could not be scoped".to_string())?;
    if suffix.components().any(|component| {
        matches!(
            component,
            std::path::Component::ParentDir
                | std::path::Component::RootDir
                | std::path::Component::Prefix(_)
        )
    }) {
        return Err("language server file URI contains unsafe path components".to_string());
    }
    let ancestor = ancestor
        .canonicalize()
        .map_err(|_| "language server file URI parent could not be resolved".to_string())?;
    Ok(ancestor.join(suffix))
}

fn is_recovery_trash_path(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .ok()
        .and_then(|relative| relative.components().next())
        .is_some_and(|component| component.as_os_str() == ".code-engine-trash")
}

fn server_request_response(message: &Value, root: &Path) -> Option<Value> {
    let object = message.as_object()?;
    let method = object.get("method")?.as_str()?;
    let id = object.get("id").filter(|id| !id.is_null())?.clone();
    let result = match method {
        "workspace/configuration" => {
            let item_count = object
                .get("params")
                .and_then(|params| params.get("items"))
                .and_then(Value::as_array)
                .map_or(0, Vec::len);
            if item_count > 256 {
                Err(json!({
                    "code": -32602,
                    "message": "workspace/configuration requested too many items"
                }))
            } else {
                Ok(Value::Array(vec![Value::Null; item_count]))
            }
        }
        "client/registerCapability"
        | "client/unregisterCapability"
        | "window/workDoneProgress/create"
        | "workspace/semanticTokens/refresh"
        | "workspace/inlayHint/refresh"
        | "workspace/codeLens/refresh"
        | "workspace/diagnostic/refresh" => Ok(Value::Null),
        "workspace/workspaceFolders" => {
            let folder = Url::from_directory_path(root).ok().map(|uri| {
                json!({
                    "uri": uri.to_string(),
                    "name": root
                        .file_name()
                        .and_then(OsStr::to_str)
                        .unwrap_or("workspace")
                })
            });
            Ok(folder.map_or(Value::Null, |folder| Value::Array(vec![folder])))
        }
        "window/showMessageRequest" => Ok(Value::Null),
        "workspace/applyEdit" => Ok(json!({
            "applied": false,
            "failureReason": "Code Engine does not apply server-initiated workspace edits"
        })),
        "window/showDocument" => Ok(json!({ "success": false })),
        _ => Err(json!({
            "code": -32601,
            "message": "Code Engine does not support this server request"
        })),
    };

    Some(match result {
        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
        Err(error) => json!({ "jsonrpc": "2.0", "id": id, "error": error }),
    })
}

async fn drain_stderr(
    stderr: ChildStderr,
    spec: LspServerSpec,
    last_stderr: Arc<Mutex<Option<String>>>,
) {
    let mut reader = BufReader::new(stderr);
    let mut chunk = [0_u8; 1_024];
    let mut line = Vec::new();
    let mut truncated = false;
    let mut reported = 0_usize;

    loop {
        let read = match reader.read(&mut chunk).await {
            Ok(0) => {
                if !line.is_empty() && reported < MAX_STDERR_MESSAGES {
                    record_stderr_line(spec, &line, truncated, &last_stderr).await;
                }
                return;
            }
            Ok(read) => read,
            Err(error) => {
                debug!(server_id = spec.id, error = %sanitize_message(&error.to_string()), "failed to drain language server stderr");
                return;
            }
        };

        for byte in &chunk[..read] {
            if *byte == b'\n' {
                if reported < MAX_STDERR_MESSAGES {
                    record_stderr_line(spec, &line, truncated, &last_stderr).await;
                    reported += 1;
                }
                line.clear();
                truncated = false;
            } else if line.len() < MAX_STDERR_LINE_BYTES {
                line.push(*byte);
            } else {
                truncated = true;
            }
        }
    }
}

async fn record_stderr_line(
    spec: LspServerSpec,
    bytes: &[u8],
    truncated: bool,
    last_stderr: &Mutex<Option<String>>,
) {
    let raw = String::from_utf8_lossy(bytes);
    let raw = raw.trim_end_matches('\r').trim();
    if raw.is_empty() {
        return;
    }
    let mut message = sanitize_message(raw);
    if truncated {
        message.push('…');
    }
    *last_stderr.lock().await = Some(message.clone());
    debug!(server_id = spec.id, stderr = %message, "language server stderr");
}

fn resolve_lsp_executable(
    spec: LspServerSpec,
    configured: Option<&str>,
) -> Result<PathBuf, String> {
    let user_home = std::env::var_os("HOME").map(PathBuf::from);
    if let Some(configured) = configured.map(str::trim).filter(|value| !value.is_empty()) {
        let configured_path = expand_home(configured, user_home.as_deref());
        if (configured.contains('/') || configured.contains('\\')) && !configured_path.is_absolute()
        {
            return Err(format!(
                "{} executable override must be an absolute path or command name",
                spec.label
            ));
        }
    }
    let path_env = std::env::var_os("PATH");
    let current_exe = std::env::current_exe().ok();
    let common_directories =
        common_binary_directories(user_home.as_deref(), current_exe.as_deref());
    let candidates = executable_candidates(
        spec,
        configured,
        path_env.as_deref(),
        user_home.as_deref(),
        &common_directories,
    );

    for candidate in candidates {
        if is_executable_file(&candidate) {
            return normalize_executable_candidate(&candidate);
        }
    }

    let expected = configured
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| spec.executable_names.join(" or "));
    Err(format!(
        "{} language server was not found ({expected})",
        spec.label
    ))
}

/// Resolve the executable's containing directory without resolving the final
/// symlink. Package-manager shims and rustup proxies dispatch from argv[0], so
/// replacing `rust-analyzer -> rustup` with the canonical target breaks them.
fn normalize_executable_candidate(candidate: &Path) -> Result<PathBuf, String> {
    let file_name = candidate
        .file_name()
        .ok_or_else(|| "language server executable has no file name".to_string())?;
    let parent = candidate.parent().unwrap_or_else(|| Path::new("."));
    let parent = parent.canonicalize().map_err(|error| {
        sanitize_message(&format!(
            "failed to resolve language server directory {}: {error}",
            parent.display()
        ))
    })?;
    Ok(parent.join(file_name))
}

fn executable_candidates(
    spec: LspServerSpec,
    configured: Option<&str>,
    path_env: Option<&OsStr>,
    user_home: Option<&Path>,
    common_directories: &[PathBuf],
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let configured = configured.map(str::trim).filter(|value| !value.is_empty());

    if let Some(configured) = configured {
        let configured_path = expand_home(configured, user_home);
        if configured_path.is_absolute() || configured.contains('/') || configured.contains('\\') {
            candidates.push(configured_path);
        } else {
            append_named_candidates(&mut candidates, configured, path_env, common_directories);
        }
    } else {
        for executable_name in spec.executable_names {
            append_named_candidates(
                &mut candidates,
                executable_name,
                path_env,
                common_directories,
            );
        }
    }

    let mut seen = HashSet::<OsString>::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.as_os_str().to_os_string()))
        .collect()
}

fn append_named_candidates(
    candidates: &mut Vec<PathBuf>,
    executable_name: &str,
    path_env: Option<&OsStr>,
    common_directories: &[PathBuf],
) {
    let names = platform_executable_names(executable_name);
    if let Some(path_env) = path_env {
        for directory in std::env::split_paths(path_env).take(MAX_SEARCH_DIRECTORIES) {
            for name in &names {
                candidates.push(directory.join(name));
            }
        }
    }
    for directory in common_directories {
        for name in &names {
            candidates.push(directory.join(name));
        }
    }
}

fn platform_executable_names(name: &str) -> Vec<String> {
    if cfg!(windows) && Path::new(name).extension().is_none() {
        vec![
            format!("{name}.exe"),
            format!("{name}.cmd"),
            name.to_string(),
        ]
    } else {
        vec![name.to_string()]
    }
}

fn common_binary_directories(user_home: Option<&Path>, current_exe: Option<&Path>) -> Vec<PathBuf> {
    let mut directories = Vec::new();
    if let Some(parent) = current_exe.and_then(Path::parent) {
        directories.push(parent.to_path_buf());
    }
    if cfg!(target_os = "macos") {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
    } else if cfg!(unix) {
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
    }

    for variable in ["NVM_BIN", "PNPM_HOME"] {
        if let Some(directory) = std::env::var_os(variable).map(PathBuf::from) {
            directories.push(directory);
        }
    }
    if let Some(volta_home) = std::env::var_os("VOLTA_HOME").map(PathBuf::from) {
        directories.push(volta_home.join("bin"));
    }
    if let Some(bun_home) = std::env::var_os("BUN_INSTALL").map(PathBuf::from) {
        directories.push(bun_home.join("bin"));
    }

    if let Some(home) = user_home {
        directories.push(home.join(".local/bin"));
        directories.push(home.join(".cargo/bin"));
        directories.push(home.join(".volta/bin"));
        directories.push(home.join(".asdf/shims"));
        directories.push(home.join(".local/share/mise/shims"));
        append_versioned_directories(&mut directories, &home.join(".nvm/versions/node"), "bin");
        append_versioned_directories(
            &mut directories,
            &home.join(".local/share/fnm/node-versions"),
            "installation/bin",
        );
    }

    let mut seen = HashSet::<OsString>::new();
    directories.retain(|directory| seen.insert(directory.as_os_str().to_os_string()));
    directories
}

fn append_versioned_directories(directories: &mut Vec<PathBuf>, root: &Path, suffix: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut versions: Vec<_> = entries
        .filter_map(Result::ok)
        .take(64)
        .map(|entry| entry.path().join(suffix))
        .collect();
    versions.sort();
    versions.reverse();
    directories.extend(versions);
}

fn lsp_process_path(executable: &Path) -> Option<OsString> {
    let user_home = std::env::var_os("HOME").map(PathBuf::from);
    let current_exe = std::env::current_exe().ok();
    let mut directories = Vec::new();
    if let Some(parent) = executable.parent() {
        directories.push(parent.to_path_buf());
    }
    if let Some(path_env) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path_env).take(MAX_SEARCH_DIRECTORIES));
    }
    directories.extend(common_binary_directories(
        user_home.as_deref(),
        current_exe.as_deref(),
    ));
    let mut seen = HashSet::<OsString>::new();
    directories.retain(|directory| seen.insert(directory.as_os_str().to_os_string()));
    std::env::join_paths(directories).ok()
}

fn expand_home(path: &str, user_home: Option<&Path>) -> PathBuf {
    if path == "~" {
        return user_home.unwrap_or_else(|| Path::new("~")).to_path_buf();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(user_home) = user_home {
            return user_home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

fn path_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| "language server path is not valid UTF-8".to_string())
}

fn sanitize_message(message: &str) -> String {
    let lowercase = message.to_ascii_lowercase();
    if [
        "authorization:",
        "bearer ",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "password=",
        "secret=",
    ]
    .iter()
    .any(|marker| lowercase.contains(marker))
    {
        return "[redacted sensitive language server message]".to_string();
    }
    let mut sanitized: String = message.chars().take(MAX_STATUS_ERROR_CHARS).collect();
    if message.chars().count() > MAX_STATUS_ERROR_CHARS {
        sanitized.push('…');
    }
    sanitized
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_server_specs_have_expected_commands() {
        assert_eq!(SERVER_SPECS.len(), 6);
        assert_eq!(server_spec("typescript").unwrap().args, &["--stdio"]);
        assert_eq!(server_spec("rust").unwrap().args, &[] as &[&str]);
        assert_eq!(
            server_spec("python").unwrap().executable_names,
            &["basedpyright-langserver", "pyright-langserver"]
        );
        assert_eq!(
            server_spec("json").unwrap().executable_names,
            &["vscode-json-language-server"]
        );
        assert!(server_spec("unknown").is_none());
    }

    #[test]
    fn decoder_accepts_split_and_combined_content_length_frames() {
        let first = frame_message(&json!({ "jsonrpc": "2.0", "id": 1, "result": null })).unwrap();
        let second = frame_message(&json!({
            "jsonrpc": "2.0",
            "method": "textDocument/publishDiagnostics",
            "params": { "diagnostics": [] }
        }))
        .unwrap();
        let split = first.len() / 2;
        let mut decoder = LspFrameDecoder::default();
        assert!(decoder.push(&first[..split]).unwrap().is_empty());
        let mut remainder = first[split..].to_vec();
        remainder.extend_from_slice(&second);
        let messages = decoder.push(&remainder).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["id"], 1);
        assert_eq!(messages[1]["method"], "textDocument/publishDiagnostics");
    }

    #[test]
    fn decoder_rejects_missing_duplicate_and_oversized_lengths() {
        let mut missing = LspFrameDecoder::default();
        assert!(missing
            .push(b"Content-Type: application/json\r\n\r\n{}")
            .is_err());

        let mut duplicate = LspFrameDecoder::default();
        assert!(duplicate
            .push(b"Content-Length: 2\r\ncontent-length: 2\r\n\r\n{}")
            .is_err());

        let mut oversized = LspFrameDecoder::default();
        let frame = format!("Content-Length: {}\r\n\r\n", MAX_BODY_BYTES + 1);
        assert!(oversized.push(frame.as_bytes()).is_err());
    }

    #[test]
    fn executable_candidates_prioritize_a_configured_override() {
        let spec = server_spec("rust").unwrap();
        let path_env = std::env::join_paths([Path::new("/path/one"), Path::new("/path/two")])
            .expect("valid test PATH");
        let candidates = executable_candidates(
            spec,
            Some("~/tools/custom-rust-analyzer"),
            Some(path_env.as_os_str()),
            Some(Path::new("/users/tester")),
            &[PathBuf::from("/common/bin")],
        );
        assert_eq!(
            candidates,
            vec![PathBuf::from("/users/tester/tools/custom-rust-analyzer")]
        );

        let detected = executable_candidates(
            spec,
            None,
            Some(path_env.as_os_str()),
            None,
            &[PathBuf::from("/common/bin")],
        );
        assert!(detected.contains(&PathBuf::from("/path/one/rust-analyzer")));
        assert!(detected.contains(&PathBuf::from("/common/bin/rust-analyzer")));
    }

    #[cfg(unix)]
    #[test]
    fn executable_resolution_preserves_proxy_symlink_names() {
        use std::os::unix::fs::symlink;

        let directory = std::env::temp_dir().join(format!(
            "code-engine-lsp-symlink-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir(&directory).unwrap();
        let proxy = directory.join("rust-analyzer");
        symlink(std::env::current_exe().unwrap(), &proxy).unwrap();

        let normalized = normalize_executable_candidate(&proxy).unwrap();
        assert_eq!(
            normalized,
            directory.canonicalize().unwrap().join("rust-analyzer")
        );

        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn generation_guards_require_the_exact_workspace() {
        let identity = SessionIdentity {
            generation: 7,
            root: PathBuf::from("/workspace/current"),
        };
        assert!(identity_matches(
            &identity,
            7,
            Path::new("/workspace/current")
        ));
        assert!(!identity_matches(
            &identity,
            8,
            Path::new("/workspace/current")
        ));
        assert!(!identity_matches(
            &identity,
            7,
            Path::new("/workspace/other")
        ));
    }

    #[test]
    fn status_states_use_the_frontend_contract_names() {
        assert_eq!(serde_json::to_value(LspState::Running).unwrap(), "running");
        assert_eq!(serde_json::to_value(LspState::Failed).unwrap(), "failed");
        assert_eq!(serde_json::to_value(LspState::Missing).unwrap(), "missing");
    }

    #[test]
    fn outbound_messages_are_allowlisted_and_workspace_scoped() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        let root_uri = Url::from_directory_path(&root).unwrap().to_string();
        let document_uri = Url::from_file_path(root.join("Cargo.toml"))
            .unwrap()
            .to_string();

        parse_outbound_message(
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "rootUri": root_uri.clone(),
                    "rootPath": root.to_string_lossy(),
                    "workspaceFolders": [{ "uri": root_uri, "name": "ce-tauri" }]
                }
            })
            .to_string(),
            &root,
        )
        .unwrap();
        parse_outbound_message(
            &json!({
                "jsonrpc": "2.0",
                "method": "textDocument/didOpen",
                "params": {
                    "textDocument": { "uri": document_uri, "languageId": "toml", "version": 1, "text": "" }
                }
            })
            .to_string(),
            &root,
        )
        .unwrap();

        let outside_uri = Url::from_file_path(root.join("../ce-core/Cargo.toml"))
            .unwrap()
            .to_string();
        assert!(parse_outbound_message(
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "textDocument/hover",
                "params": { "textDocument": { "uri": outside_uri }, "position": { "line": 0, "character": 0 } }
            })
            .to_string(),
            &root,
        )
        .is_err());
        assert!(parse_outbound_message(
            &json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "workspace/executeCommand",
                "params": { "command": "run-anything" }
            })
            .to_string(),
            &root,
        )
        .is_err());
    }

    #[test]
    fn server_requests_are_answered_without_forwarding_workspace_edits() {
        let root = Path::new("/workspace/current");
        let configuration = server_request_response(
            &json!({
                "jsonrpc": "2.0",
                "id": 2,
                "method": "workspace/configuration",
                "params": { "items": [{ "section": "typescript" }, { "section": "editor" }] }
            }),
            root,
        )
        .unwrap();
        assert_eq!(configuration["result"], json!([null, null]));

        let apply_edit = server_request_response(
            &json!({
                "jsonrpc": "2.0",
                "id": "edit-1",
                "method": "workspace/applyEdit",
                "params": { "edit": { "changes": {} } }
            }),
            root,
        )
        .unwrap();
        assert_eq!(apply_edit["result"]["applied"], false);
    }

    #[tokio::test]
    #[ignore = "requires a locally installed rust-analyzer"]
    async fn live_installed_rust_analyzer_transport_smoke_test() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../..")
            .canonicalize()
            .unwrap();
        let root_uri = Url::from_directory_path(&root).unwrap().to_string();
        let host = LspHost::new();
        let status = host.start("rust", root.clone(), None).await.unwrap();
        host.send_json(
            "rust",
            status.generation,
            &root,
            &json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "processId": null,
                    "rootUri": root_uri,
                    "capabilities": {}
                }
            })
            .to_string(),
        )
        .await
        .unwrap();
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(
            host.status_for("rust").await.unwrap().state,
            LspState::Running
        );
        host.stop("rust", status.generation, &root).await.unwrap();
    }
}
