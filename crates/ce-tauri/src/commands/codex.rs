use serde_json::{json, Value};
use tauri::State;

use crate::codex::{CodexServerStatus, PendingServerRequest};
use crate::commands::workspace::active_workspace_root;
use crate::state::AppState;

#[tauri::command]
pub async fn codex_server_status(state: State<'_, AppState>) -> Result<CodexServerStatus, String> {
    Ok(state.codex.status().await)
}

#[tauri::command]
pub async fn codex_server_start(state: State<'_, AppState>) -> Result<CodexServerStatus, String> {
    state.codex.start().await
}

#[tauri::command]
pub async fn codex_server_restart(state: State<'_, AppState>) -> Result<CodexServerStatus, String> {
    state.codex.restart().await
}

#[tauri::command]
pub async fn codex_server_stop(state: State<'_, AppState>) -> Result<CodexServerStatus, String> {
    state.codex.stop().await
}

#[tauri::command]
pub async fn codex_account_read(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .codex
        .request("account/read", json!({ "refreshToken": false }))
        .await
}

#[tauri::command]
pub async fn codex_login_chatgpt(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .codex
        .request(
            "account/login/start",
            json!({
                "type": "chatgpt",
                "useHostedLoginSuccessPage": true,
                "appBrand": "chatgpt"
            }),
        )
        .await
}

#[tauri::command]
pub async fn codex_login_device_code(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .codex
        .request(
            "account/login/start",
            json!({ "type": "chatgptDeviceCode" }),
        )
        .await
}

#[tauri::command]
pub async fn codex_login_cancel(
    state: State<'_, AppState>,
    login_id: String,
) -> Result<Value, String> {
    require_non_empty("loginId", &login_id)?;
    state
        .codex
        .request("account/login/cancel", json!({ "loginId": login_id }))
        .await
}

#[tauri::command]
pub async fn codex_logout(state: State<'_, AppState>) -> Result<Value, String> {
    state.codex.request_no_params("account/logout").await
}

#[tauri::command]
pub async fn codex_rate_limits(state: State<'_, AppState>) -> Result<Value, String> {
    state
        .codex
        .request_no_params("account/rateLimits/read")
        .await
}

#[tauri::command]
pub async fn codex_model_list(
    state: State<'_, AppState>,
    params: Option<Value>,
) -> Result<Value, String> {
    state
        .codex
        .request(
            "model/list",
            params.unwrap_or_else(|| json!({ "limit": 50, "includeHidden": false })),
        )
        .await
}

#[tauri::command]
pub async fn codex_thread_list(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    let (params, cwd) =
        bind_params_to_active_workspace(state.inner(), "thread/list", params, true).await?;
    let response = request_with_object_params(state.inner(), "thread/list", params).await?;
    validate_thread_list_response(&response, &cwd)?;
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_read(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    let thread_id = require_thread_id("thread/read", &params)?.to_string();
    let response = request_with_object_params(state.inner(), "thread/read", params).await?;
    validate_thread_response("thread/read", &response, Some(&thread_id), &cwd)?;
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_start(
    state: State<'_, AppState>,
    params: Value,
) -> Result<Value, String> {
    let (params, cwd) =
        bind_params_to_active_workspace(state.inner(), "thread/start", params, false).await?;
    let response = request_with_object_params(state.inner(), "thread/start", params).await?;
    validate_thread_response("thread/start", &response, None, &cwd)?;
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_resume(
    state: State<'_, AppState>,
    params: Value,
) -> Result<Value, String> {
    let (params, cwd) =
        bind_params_to_active_workspace(state.inner(), "thread/resume", params, false).await?;
    let thread_id =
        require_thread_in_workspace(state.inner(), "thread/resume", &params, &cwd).await?;
    let response = request_with_object_params(state.inner(), "thread/resume", params).await?;
    validate_thread_response("thread/resume", &response, Some(&thread_id), &cwd)?;
    Ok(response)
}

#[tauri::command]
pub async fn codex_thread_archive(
    state: State<'_, AppState>,
    params: Value,
) -> Result<Value, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    require_thread_in_workspace(state.inner(), "thread/archive", &params, &cwd).await?;
    request_with_object_params(state.inner(), "thread/archive", params).await
}

#[tauri::command]
pub async fn codex_thread_name_set(
    state: State<'_, AppState>,
    params: Value,
) -> Result<Value, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    require_thread_in_workspace(state.inner(), "thread/name/set", &params, &cwd).await?;
    request_with_object_params(state.inner(), "thread/name/set", params).await
}

#[tauri::command]
pub async fn codex_turn_start(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    let (params, cwd) =
        bind_params_to_active_workspace(state.inner(), "turn/start", params, false).await?;
    require_thread_in_workspace(state.inner(), "turn/start", &params, &cwd).await?;
    request_with_object_params(state.inner(), "turn/start", params).await
}

#[tauri::command]
pub async fn codex_turn_steer(state: State<'_, AppState>, params: Value) -> Result<Value, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    require_thread_in_workspace(state.inner(), "turn/steer", &params, &cwd).await?;
    request_with_object_params(state.inner(), "turn/steer", params).await
}

#[tauri::command]
pub async fn codex_turn_interrupt(
    state: State<'_, AppState>,
    params: Value,
) -> Result<Value, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    require_thread_in_workspace(state.inner(), "turn/interrupt", &params, &cwd).await?;
    request_with_object_params(state.inner(), "turn/interrupt", params).await
}

#[tauri::command]
pub async fn codex_pending_server_requests(
    state: State<'_, AppState>,
) -> Result<Vec<PendingServerRequest>, String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    let mut visible = Vec::new();
    for request in state.codex.pending_server_requests().await {
        let Some(thread_id) = server_request_thread_id(&request) else {
            // Every interactive request currently surfaced by the process
            // manager is thread-bound. Account-global requests are handled
            // internally and must never appear as project approvals.
            continue;
        };
        if thread_belongs_to_workspace(state.inner(), &thread_id, &cwd)
            .await
            .is_ok()
        {
            visible.push(request);
        }
    }
    Ok(visible)
}

#[tauri::command]
pub async fn codex_respond_to_server_request(
    state: State<'_, AppState>,
    request_id: Value,
    response: Value,
) -> Result<(), String> {
    let cwd = active_workspace_cwd(state.inner()).await?;
    let pending = state
        .codex
        .pending_server_requests()
        .await
        .into_iter()
        .find(|request| request.id == request_id)
        .ok_or_else(|| "server request is no longer pending".to_string())?;
    let thread_id = server_request_thread_id(&pending)
        .ok_or_else(|| "server request is not bound to a workspace thread".to_string())?;
    thread_belongs_to_workspace(state.inner(), &thread_id, &cwd).await?;
    state
        .codex
        .respond_to_server_request(request_id, response)
        .await
}

async fn request_with_object_params(
    state: &AppState,
    method: &'static str,
    params: Value,
) -> Result<Value, String> {
    if !params.is_object() {
        return Err(format!("{method} params must be a JSON object"));
    }
    state.codex.request(method, params).await
}

async fn active_workspace_cwd(state: &AppState) -> Result<String, String> {
    active_workspace_root(state)
        .await?
        .to_str()
        .map(str::to_owned)
        .ok_or_else(|| "active workspace path is not valid UTF-8".to_string())
}

async fn bind_params_to_active_workspace(
    state: &AppState,
    method: &'static str,
    params: Value,
    allow_cwd_array: bool,
) -> Result<(Value, String), String> {
    let cwd = active_workspace_cwd(state).await?;
    let params = bind_active_cwd(method, params, &cwd, allow_cwd_array)?;
    validate_workspace_access_params(method, &params, &cwd)?;
    Ok((params, cwd))
}

fn bind_active_cwd(
    method: &str,
    mut params: Value,
    active_cwd: &str,
    allow_cwd_array: bool,
) -> Result<Value, String> {
    let object = params
        .as_object_mut()
        .ok_or_else(|| format!("{method} params must be a JSON object"))?;

    if let Some(requested) = object.get("cwd").filter(|value| !value.is_null()) {
        let matches_active = requested.as_str() == Some(active_cwd)
            || (allow_cwd_array
                && requested.as_array().is_some_and(|paths| {
                    paths.len() == 1 && paths[0].as_str() == Some(active_cwd)
                }));
        if !matches_active {
            return Err(format!("{method} cwd is not the active workspace"));
        }
    }

    object.insert("cwd".to_string(), Value::String(active_cwd.to_string()));
    Ok(params)
}

fn validate_workspace_access_params(
    method: &str,
    params: &Value,
    active_cwd: &str,
) -> Result<(), String> {
    let object = params
        .as_object()
        .ok_or_else(|| format!("{method} params must be a JSON object"))?;

    if let Some(roots) = object
        .get("runtimeWorkspaceRoots")
        .filter(|value| !value.is_null())
    {
        validate_workspace_roots(method, "runtimeWorkspaceRoots", roots, active_cwd)?;
    }

    if let Some(policy) = object.get("sandboxPolicy").and_then(Value::as_object) {
        if policy.get("type").and_then(Value::as_str) == Some("workspaceWrite") {
            let roots = policy.get("writableRoots").ok_or_else(|| {
                format!("{method} workspace-write sandbox is missing writableRoots")
            })?;
            validate_workspace_roots(method, "sandboxPolicy.writableRoots", roots, active_cwd)?;
        }
    }
    Ok(())
}

fn validate_workspace_roots(
    method: &str,
    field: &str,
    roots: &Value,
    active_cwd: &str,
) -> Result<(), String> {
    let roots = roots
        .as_array()
        .ok_or_else(|| format!("{method} {field} must be an array"))?;
    if roots.iter().any(|root| root.as_str() != Some(active_cwd)) {
        return Err(format!(
            "{method} {field} contains a path outside the active workspace"
        ));
    }
    Ok(())
}

fn require_thread_id<'a>(method: &str, params: &'a Value) -> Result<&'a str, String> {
    params
        .as_object()
        .ok_or_else(|| format!("{method} params must be a JSON object"))?
        .get("threadId")
        .and_then(Value::as_str)
        .filter(|thread_id| !thread_id.trim().is_empty())
        .ok_or_else(|| format!("{method} requires a non-empty threadId"))
}

async fn require_thread_in_workspace(
    state: &AppState,
    method: &str,
    params: &Value,
    cwd: &str,
) -> Result<String, String> {
    let thread_id = require_thread_id(method, params)?.to_string();
    thread_belongs_to_workspace(state, &thread_id, cwd).await?;
    Ok(thread_id)
}

async fn thread_belongs_to_workspace(
    state: &AppState,
    thread_id: &str,
    cwd: &str,
) -> Result<(), String> {
    let response = state
        .codex
        .request(
            "thread/read",
            json!({ "threadId": thread_id, "includeTurns": false }),
        )
        .await?;
    validate_thread_response("thread/read", &response, Some(thread_id), cwd)
}

fn validate_thread_response(
    method: &str,
    response: &Value,
    expected_thread_id: Option<&str>,
    active_cwd: &str,
) -> Result<(), String> {
    let thread = response
        .get("thread")
        .and_then(Value::as_object)
        .ok_or_else(|| format!("{method} response is missing thread metadata"))?;
    if thread.get("cwd").and_then(Value::as_str) != Some(active_cwd) {
        return Err(format!("{method} thread is not in the active workspace"));
    }
    if let Some(expected_thread_id) = expected_thread_id {
        if thread.get("id").and_then(Value::as_str) != Some(expected_thread_id) {
            return Err(format!("{method} returned unexpected thread metadata"));
        }
    }
    Ok(())
}

fn validate_thread_list_response(response: &Value, active_cwd: &str) -> Result<(), String> {
    let threads = response
        .get("data")
        .and_then(Value::as_array)
        .ok_or_else(|| "thread/list response is missing data".to_string())?;
    if threads
        .iter()
        .any(|thread| thread.get("cwd").and_then(Value::as_str) != Some(active_cwd))
    {
        return Err("thread/list returned a thread outside the active workspace".to_string());
    }
    Ok(())
}

fn server_request_thread_id(request: &PendingServerRequest) -> Option<String> {
    let params = request.params.as_object()?;
    params
        .get("threadId")
        .or_else(|| params.get("conversationId"))
        .and_then(Value::as_str)
        .filter(|thread_id| !thread_id.trim().is_empty())
        .map(str::to_owned)
}

fn require_non_empty(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        Err(format!("{field} must not be empty"))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ACTIVE: &str = "/workspace/current";

    #[test]
    fn binds_missing_or_matching_cwd_to_active_workspace() {
        assert_eq!(
            bind_active_cwd("thread/start", json!({ "model": "codex" }), ACTIVE, false).unwrap()
                ["cwd"],
            ACTIVE
        );
        assert_eq!(
            bind_active_cwd("thread/list", json!({ "cwd": [ACTIVE] }), ACTIVE, true,).unwrap()
                ["cwd"],
            ACTIVE
        );
    }

    #[test]
    fn rejects_cwd_or_workspace_roots_outside_active_workspace() {
        assert!(bind_active_cwd(
            "turn/start",
            json!({ "cwd": "/workspace/other" }),
            ACTIVE,
            false,
        )
        .is_err());
        assert!(validate_workspace_access_params(
            "turn/start",
            &json!({
                "runtimeWorkspaceRoots": [ACTIVE, "/workspace/other"]
            }),
            ACTIVE,
        )
        .is_err());
        assert!(validate_workspace_access_params(
            "turn/start",
            &json!({
                "sandboxPolicy": {
                    "type": "workspaceWrite",
                    "writableRoots": ["/workspace/other"]
                }
            }),
            ACTIVE,
        )
        .is_err());
    }

    #[test]
    fn validates_thread_responses_and_lists_against_active_workspace() {
        let response = json!({
            "thread": { "id": "thread-1", "cwd": ACTIVE }
        });
        validate_thread_response("thread/read", &response, Some("thread-1"), ACTIVE).unwrap();
        assert!(
            validate_thread_response("thread/read", &response, Some("thread-2"), ACTIVE,).is_err()
        );
        assert!(validate_thread_list_response(
            &json!({ "data": [{ "id": "thread-1", "cwd": "/workspace/other" }] }),
            ACTIVE,
        )
        .is_err());
    }

    #[test]
    fn extracts_modern_and_legacy_server_request_thread_ids() {
        let request = |params| PendingServerRequest {
            generation: 1,
            id: json!(1),
            method: "item/tool/requestUserInput".to_string(),
            params,
            received_at_ms: 0,
        };
        assert_eq!(
            server_request_thread_id(&request(json!({ "threadId": "thread-1" }))).as_deref(),
            Some("thread-1")
        );
        assert_eq!(
            server_request_thread_id(&request(json!({ "conversationId": "legacy-1" }))).as_deref(),
            Some("legacy-1")
        );
        assert!(server_request_thread_id(&request(json!({ "accountId": "global" }))).is_none());
    }
}
