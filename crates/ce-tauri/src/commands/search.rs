use ce_fs::{ReplaceRequest, ReplaceResult, SearchRequest, SearchResult};
use tauri::State;

use crate::commands::workspace::require_active_workspace_root;
use crate::state::AppState;

/// Search UTF-8, non-binary workspace files while honoring repository ignore
/// rules. Result and file-size caps are enforced by ce-fs.
#[tauri::command]
pub async fn search_workspace(
    state: State<'_, AppState>,
    path: String,
    request: SearchRequest,
) -> Result<SearchResult, String> {
    let root = require_active_workspace_root(&state, &path).await?;
    tauri::async_runtime::spawn_blocking(move || {
        ce_fs::search_workspace(root, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("workspace search task failed: {error}"))?
}

/// Explicitly confirmed, preflighted replace-all. Files are written using the
/// ce-fs atomic writer only after every replacement has passed validation.
#[tauri::command]
pub async fn replace_all_workspace(
    state: State<'_, AppState>,
    path: String,
    request: ReplaceRequest,
) -> Result<ReplaceResult, String> {
    let root = require_active_workspace_root(&state, &path).await?;
    tauri::async_runtime::spawn_blocking(move || {
        ce_fs::replace_all(root, &request).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| format!("workspace replace task failed: {error}"))?
}
