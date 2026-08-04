mod codex;
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
    let codex = app_state.codex.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            commands::codex::codex_server_status,
            commands::codex::codex_server_start,
            commands::codex::codex_server_restart,
            commands::codex::codex_server_stop,
            commands::codex::codex_account_read,
            commands::codex::codex_login_chatgpt,
            commands::codex::codex_login_device_code,
            commands::codex::codex_login_cancel,
            commands::codex::codex_logout,
            commands::codex::codex_rate_limits,
            commands::codex::codex_model_list,
            commands::codex::codex_thread_list,
            commands::codex::codex_thread_read,
            commands::codex::codex_thread_start,
            commands::codex::codex_thread_resume,
            commands::codex::codex_thread_archive,
            commands::codex::codex_thread_name_set,
            commands::codex::codex_turn_start,
            commands::codex::codex_turn_steer,
            commands::codex::codex_turn_interrupt,
            commands::codex::codex_pending_server_requests,
            commands::codex::codex_respond_to_server_request,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::workspace::set_workspace_root,
            commands::workspace::get_workspace_root,
            commands::workspace::read_dir,
            commands::workspace::read_file_text,
            commands::workspace::write_file_text,
            commands::workspace::list_workspace_files,
            commands::workspace::create_file,
            commands::workspace::create_directory,
            commands::workspace::rename_path,
            commands::workspace::trash_path,
            commands::workspace::list_trash,
            commands::workspace::restore_from_trash,
            commands::external::open_external_url,
            commands::search::search_workspace,
            commands::search::replace_all_workspace,
            commands::git::git_status,
            commands::git::git_diff,
            commands::git::git_stage_file,
            commands::git::git_unstage_file,
            commands::git::git_stage_all,
            commands::git::git_unstage_all,
            commands::git::git_commit,
            commands::git::git_stash,
            commands::git::git_recent_log,
            commands::git::git_branches,
            commands::git::git_checkout_branch,
            commands::window::titlebar_double_click,
        ])
        .setup(move |app| {
            let app_handle = app.handle().clone();
            codex.attach_app(app_handle);

            Ok(())
        })
        .run(tauri::generate_context!("tauri.conf.json"))
        .expect("error while running CodeEngine");
}
