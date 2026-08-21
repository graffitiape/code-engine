use ce_git::{
    GitBranchInfo, GitDiffKind, GitDiffResult, GitLogEntry, GitRepoStatus, GitStashResult,
};
use tauri::State;

use crate::commands::workspace::require_active_workspace_root;
use crate::state::AppState;

async fn with_active_repository<T, F>(
    state: &AppState,
    path: &str,
    operation: F,
) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(std::path::PathBuf) -> Result<T, String> + Send + 'static,
{
    let root = require_active_workspace_root(state, path).await?;
    tauri::async_runtime::spawn_blocking(move || operation(root))
        .await
        .map_err(|error| format!("Git task failed: {error}"))?
}

#[tauri::command]
pub async fn git_status(state: State<'_, AppState>, path: String) -> Result<GitRepoStatus, String> {
    with_active_repository(&state, &path, |root| {
        ce_git::status(root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_diff(
    state: State<'_, AppState>,
    path: String,
    file_path: Option<String>,
    kind: GitDiffKind,
    max_bytes: Option<usize>,
) -> Result<GitDiffResult, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::unified_diff(root, file_path.as_deref(), kind, max_bytes)
            .map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stage_file(
    state: State<'_, AppState>,
    path: String,
    file_path: String,
) -> Result<GitRepoStatus, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::stage_file(root, file_path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_unstage_file(
    state: State<'_, AppState>,
    path: String,
    file_path: String,
) -> Result<GitRepoStatus, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::unstage_file(root, file_path).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stage_all(
    state: State<'_, AppState>,
    path: String,
) -> Result<GitRepoStatus, String> {
    with_active_repository(&state, &path, |root| {
        ce_git::stage_all(root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_unstage_all(
    state: State<'_, AppState>,
    path: String,
) -> Result<GitRepoStatus, String> {
    with_active_repository(&state, &path, |root| {
        ce_git::unstage_all(root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_commit(
    state: State<'_, AppState>,
    path: String,
    message: String,
) -> Result<GitLogEntry, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::commit(root, &message).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_push(state: State<'_, AppState>, path: String) -> Result<String, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::push(root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_stash(
    state: State<'_, AppState>,
    path: String,
    message: Option<String>,
) -> Result<GitStashResult, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::stash(root, message.as_deref()).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_recent_log(
    state: State<'_, AppState>,
    path: String,
    limit: Option<usize>,
) -> Result<Vec<GitLogEntry>, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::recent_log(root, limit).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    path: String,
) -> Result<Vec<GitBranchInfo>, String> {
    with_active_repository(&state, &path, |root| {
        ce_git::branches(root).map_err(|error| error.to_string())
    })
    .await
}

#[tauri::command]
pub async fn git_checkout_branch(
    state: State<'_, AppState>,
    path: String,
    branch_name: String,
) -> Result<GitBranchInfo, String> {
    with_active_repository(&state, &path, move |root| {
        ce_git::checkout_branch(root, &branch_name).map_err(|error| error.to_string())
    })
    .await
}
