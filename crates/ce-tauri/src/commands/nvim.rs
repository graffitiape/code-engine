use tauri::State;

use crate::state::AppState;

/// Create a new pane with an embedded Neovim instance
#[tauri::command]
pub async fn create_pane(
    state: State<'_, AppState>,
    cols: u64,
    rows: u64,
    cwd: Option<String>,
) -> Result<String, String> {
    eprintln!("[CE] create_pane command called: cols={}, rows={}, cwd={:?}", cols, rows, cwd);
    let result = state
        .create_pane(cols, rows, cwd.as_deref())
        .await;
    eprintln!("[CE] create_pane result: {:?}", result.as_ref().map(|s| s.as_str()));
    result
}

/// Close a pane and its Neovim instance
#[tauri::command]
pub async fn close_pane(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<(), String> {
    state.close_pane(&pane_id).await
}

/// Send keyboard input to a specific pane
#[tauri::command]
pub async fn nvim_input(
    state: State<'_, AppState>,
    pane_id: String,
    keys: String,
) -> Result<(), String> {
    state.send_input(&pane_id, &keys).await
}

/// Resize a pane's Neovim instance
#[tauri::command]
pub async fn nvim_resize(
    state: State<'_, AppState>,
    pane_id: String,
    cols: u64,
    rows: u64,
) -> Result<(), String> {
    state.resize_pane(&pane_id, cols, rows).await
}

/// Execute a Neovim command on a specific pane
#[tauri::command]
pub async fn nvim_command(
    state: State<'_, AppState>,
    pane_id: String,
    command: String,
) -> Result<(), String> {
    state.send_command(&pane_id, &command).await
}
