use tauri::Window;

/// Dispatch the macOS double-click-on-titlebar action. Reads the user's
/// preference (`AppleActionOnDoubleClick`) so we mirror what every other
/// macOS app does. Defaults to zoom when the preference is missing.
#[tauri::command]
pub async fn titlebar_double_click(window: Window) -> Result<(), String> {
    let action = read_double_click_action();
    match action.as_str() {
        "Minimize" => window.minimize().map_err(|e| e.to_string()),
        "None" => Ok(()),
        // "Maximize" or anything else -> perform the titlebar zoom behavior.
        _ => zoom_window(&window),
    }
}

#[cfg(target_os = "macos")]
fn read_double_click_action() -> String {
    use std::process::Command;
    let out = Command::new("defaults")
        .args(["read", "-g", "AppleActionOnDoubleClick"])
        .output();
    match out {
        Ok(o) if o.status.success() => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        _ => "Maximize".to_string(),
    }
}

#[cfg(not(target_os = "macos"))]
fn read_double_click_action() -> String {
    "Maximize".to_string()
}

#[cfg(target_os = "macos")]
fn zoom_window(window: &Window) -> Result<(), String> {
    use objc2_app_kit::NSWindow;
    use objc2_foundation::{NSPoint, NSRect, NSSize};
    use std::{
        collections::{HashMap, HashSet},
        sync::{mpsc, Mutex, OnceLock},
        thread,
        time::Duration,
    };

    const ANIMATION_FRAMES: usize = 13;
    const FRAME_DELAY: Duration = Duration::from_millis(12);

    #[derive(Clone, Copy)]
    struct StoredFrame {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    }

    impl StoredFrame {
        fn from_rect(rect: NSRect) -> Self {
            Self {
                x: rect.origin.x,
                y: rect.origin.y,
                width: rect.size.width,
                height: rect.size.height,
            }
        }

        fn apply_to(self, mut rect: NSRect) -> NSRect {
            rect.origin.x = self.x;
            rect.origin.y = self.y;
            rect.size.width = self.width;
            rect.size.height = self.height;
            rect
        }

        fn to_rect(self) -> NSRect {
            NSRect::new(
                NSPoint::new(self.x, self.y),
                NSSize::new(self.width, self.height),
            )
        }

        fn interpolate(self, target: Self, amount: f64) -> Self {
            Self {
                x: self.x + (target.x - self.x) * amount,
                y: self.y + (target.y - self.y) * amount,
                width: self.width + (target.width - self.width) * amount,
                height: self.height + (target.height - self.height) * amount,
            }
        }

        fn nearly_matches(self, other: Self) -> bool {
            const TOLERANCE: f64 = 2.0;
            (self.x - other.x).abs() <= TOLERANCE
                && (self.y - other.y).abs() <= TOLERANCE
                && (self.width - other.width).abs() <= TOLERANCE
                && (self.height - other.height).abs() <= TOLERANCE
        }
    }

    static RESTORE_FRAMES: OnceLock<Mutex<HashMap<String, StoredFrame>>> = OnceLock::new();
    static ANIMATING_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

    if !window.is_resizable().unwrap_or(true) {
        return Ok(());
    }

    let label = window.label().to_string();
    let animating_windows = ANIMATING_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()));
    if !animating_windows
        .lock()
        .map_err(|e| e.to_string())?
        .insert(label.clone())
    {
        return Ok(());
    }

    let result = (|| {
        let ns_window = window.ns_window().map_err(|e| e.to_string())? as usize;
        let (tx, rx) = mpsc::channel();
        let target_label = label.clone();

        window
            .run_on_main_thread(move || {
                let result = (|| {
                    let ns_window = ns_window as *mut std::ffi::c_void;
                    if ns_window.is_null() {
                        return None;
                    }

                    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
                    let current_rect = ns_window.frame();
                    let restore_frames = RESTORE_FRAMES.get_or_init(|| Mutex::new(HashMap::new()));
                    let Ok(mut restore_frames) = restore_frames.lock() else {
                        return None;
                    };

                    let target_rect = if let Some(saved_frame) =
                        restore_frames.remove(&target_label)
                    {
                        saved_frame.apply_to(current_rect)
                    } else {
                        let Some(screen) = ns_window.screen() else {
                            return None;
                        };
                        let target_rect = screen.visibleFrame();
                        if StoredFrame::from_rect(current_rect)
                            .nearly_matches(StoredFrame::from_rect(target_rect))
                        {
                            return None;
                        }

                        restore_frames.insert(target_label, StoredFrame::from_rect(current_rect));
                        target_rect
                    };

                    Some((
                        StoredFrame::from_rect(current_rect),
                        StoredFrame::from_rect(target_rect),
                    ))
                })();

                let _ = tx.send(result);
            })
            .map_err(|e| e.to_string())?;

        let Some((start_frame, target_frame)) = rx.recv().map_err(|e| e.to_string())? else {
            return Ok(());
        };

        for frame_index in 1..=ANIMATION_FRAMES {
            let progress = frame_index as f64 / ANIMATION_FRAMES as f64;
            let eased = 1.0 - (1.0 - progress).powi(3);
            let frame = start_frame.interpolate(target_frame, eased);
            let is_last_frame = frame_index == ANIMATION_FRAMES;
            let ns_window = ns_window;
            let (tx, rx) = mpsc::channel();

            window
                .run_on_main_thread(move || {
                    let ns_window = ns_window as *mut std::ffi::c_void;
                    if ns_window.is_null() {
                        let _ = tx.send(());
                        return;
                    }

                    let ns_window: &NSWindow = unsafe { &*ns_window.cast() };
                    ns_window.setFrame_display(frame.to_rect(), true);
                    if is_last_frame {
                        ns_window.displayIfNeeded();
                    }

                    let _ = tx.send(());
                })
                .map_err(|e| e.to_string())?;

            rx.recv().map_err(|e| e.to_string())?;
            if !is_last_frame {
                thread::sleep(FRAME_DELAY);
            }
        }

        Ok(())
    })();

    if let Ok(mut animating_windows) = animating_windows.lock() {
        animating_windows.remove(&label);
    }

    result
}

#[cfg(not(target_os = "macos"))]
fn zoom_window(window: &Window) -> Result<(), String> {
    let is_max = window.is_maximized().unwrap_or(false);
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())
    } else {
        window.maximize().map_err(|e| e.to_string())
    }
}
