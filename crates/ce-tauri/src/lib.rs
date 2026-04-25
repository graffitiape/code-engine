mod bridge;
mod commands;
mod state;

use state::AppState;
use tracing_subscriber::EnvFilter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("ce_core=debug,ce_tauri=debug")),
        )
        .init();

    let app_state = AppState::new();
    let event_rx = app_state.event_rx.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::nvim::create_pane,
            commands::nvim::close_pane,
            commands::nvim::nvim_input,
            commands::nvim::nvim_resize,
            commands::nvim::nvim_command,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::workspace::set_workspace_root,
            commands::workspace::get_workspace_root,
            commands::workspace::read_dir,
            commands::workspace::read_file_text,
            commands::workspace::write_file_text,
            commands::workspace::list_workspace_files,
            commands::git::git_status,
            commands::window::titlebar_double_click,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                bridge::start_event_bridge(app_handle, event_rx).await;
            });

            Ok(())
        })
        .run(tauri::generate_context!(
            "tauri.conf.json"
        ))
        .expect("error while running CodeEngine");
}
