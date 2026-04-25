use ce_core::config::settings::AppSettings;

/// Get current app settings
#[tauri::command]
pub fn get_settings() -> Result<AppSettings, String> {
    AppSettings::load().map_err(|e| e.to_string())
}

/// Save app settings
#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    settings.save().map_err(|e| e.to_string())
}
