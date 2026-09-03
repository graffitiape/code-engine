use ce_core::config::settings::AppSettings;
use tauri::State;

use crate::commands::workspace::require_active_workspace_root;
use crate::lsp::LspStatus;
use crate::state::AppState;

#[tauri::command]
pub async fn lsp_start(
    state: State<'_, AppState>,
    path: String,
    server_id: String,
) -> Result<LspStatus, String> {
    let root = require_active_workspace_root(state.inner(), &path).await?;
    let settings = AppSettings::load().map_err(|error| error.to_string())?;
    if !settings.lsp_enabled {
        return Err("language server support is disabled in settings".to_string());
    }
    let server = settings
        .lsp_servers
        .iter()
        .find(|server| server.id == server_id)
        .ok_or_else(|| format!("unsupported language server: {server_id}"))?;
    if !server.enabled {
        return Err(format!(
            "{server_id} language server is disabled in settings"
        ));
    }

    let status = state
        .lsp
        .start(&server_id, root.clone(), server.executable.as_deref())
        .await?;

    // A project switch can race process startup. Revalidate after spawning and
    // tear down the stale generation instead of leaving it attached to a root
    // that is no longer active.
    if require_active_workspace_root(state.inner(), &path)
        .await
        .is_err()
    {
        let _ = state.lsp.stop(&server_id, status.generation, &root).await;
        return Err("active workspace changed while starting the language server".to_string());
    }
    Ok(status)
}

#[tauri::command]
pub async fn lsp_send(
    state: State<'_, AppState>,
    path: String,
    server_id: String,
    generation: u64,
    message: String,
) -> Result<(), String> {
    let root = require_active_workspace_root(state.inner(), &path).await?;
    state
        .lsp
        .send_json(&server_id, generation, &root, &message)
        .await
}

#[tauri::command]
pub async fn lsp_stop(
    state: State<'_, AppState>,
    path: String,
    server_id: String,
    generation: u64,
) -> Result<LspStatus, String> {
    let root = require_active_workspace_root(state.inner(), &path).await?;
    state.lsp.stop(&server_id, generation, &root).await
}

#[tauri::command]
pub async fn lsp_statuses(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<LspStatus>, String> {
    let root = require_active_workspace_root(state.inner(), &path).await?;
    Ok(state.lsp.statuses(&root).await)
}

#[tauri::command]
pub async fn lsp_stop_all(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<LspStatus>, String> {
    require_active_workspace_root(state.inner(), &path).await?;
    state.lsp.stop_all().await
}
