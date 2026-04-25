use ce_fs::{list_dir, FsNode};
use tauri::State;

use crate::state::AppState;

/// Set the active workspace root. The frontend calls this after the user picks
/// a folder. Subsequent file-tree reads default to this root.
#[tauri::command]
pub async fn set_workspace_root(
    state: State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    let mut guard = state.workspace_root.lock().await;
    *guard = Some(path);
    Ok(())
}

/// Return the currently active workspace root, if any.
#[tauri::command]
pub async fn get_workspace_root(
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let guard = state.workspace_root.lock().await;
    Ok(guard.clone())
}

/// Shallow read of a directory. The frontend uses this to lazily expand the
/// sidebar tree.
#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<FsNode>, String> {
    list_dir(&path).map_err(|e| e.to_string())
}

/// Read a UTF-8 text file.
#[tauri::command]
pub fn read_file_text(path: String) -> Result<String, String> {
    ce_fs::tree::read_text(&path).map_err(|e| e.to_string())
}

/// Write a UTF-8 text file.
#[tauri::command]
pub fn write_file_text(path: String, contents: String) -> Result<(), String> {
    ce_fs::tree::write_text(&path, &contents).map_err(|e| e.to_string())
}

/// Recursively list every non-ignored file under `path`, capped at `max`
/// (default 20_000). Used to feed the command palette / quick-open.
#[tauri::command]
pub fn list_workspace_files(path: String, max: Option<usize>) -> Result<Vec<String>, String> {
    ce_fs::walk_workspace(&path, max.unwrap_or(20_000)).map_err(|e| e.to_string())
}
