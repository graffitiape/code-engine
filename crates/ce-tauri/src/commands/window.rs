use tauri::{Manager, Window};

/// Dispatch the macOS double-click-on-titlebar action. Reads the user's
/// preference (`AppleActionOnDoubleClick`) so we mirror what every other
/// macOS app does. Defaults to zoom (toggle maximize) on non-mac or when
/// the preference is missing.
#[tauri::command]
pub async fn titlebar_double_click(window: Window) -> Result<(), String> {
    let action = read_double_click_action();
    match action.as_str() {
        "Minimize" => window.minimize().map_err(|e| e.to_string()),
        "None" => Ok(()),
        // "Maximize" or anything else → toggle zoom.
        _ => toggle_maximize(&window),
    }
}

#[cfg(target_os = "macos")]
fn read_double_click_action() -> String {
    use std::process::Command;
    let out = Command::new("defaults")
        .args(["read", "-g", "AppleActionOnDoubleClick"])
        .output();
    match out {
        Ok(o) if o.status.success() => {
            String::from_utf8_lossy(&o.stdout).trim().to_string()
        }
        _ => "Maximize".to_string(),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_double_click_action() -> String {
    "Maximize".to_string()
}

fn toggle_maximize(window: &Window) -> Result<(), String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}

// Touch the unused import warning silencer
#[allow(dead_code)]
fn _keep_manager(_: &impl Manager<tauri::Wry>) {}
