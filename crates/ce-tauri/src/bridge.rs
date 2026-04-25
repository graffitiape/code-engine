use ce_core::nvim::handler::NvimUiEvent;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, Mutex};
use tracing::{debug, error};
use std::sync::Arc;

/// Start the bridge event loop that routes Neovim UI events to the frontend
pub async fn start_event_bridge(
    app: AppHandle,
    event_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<NvimUiEvent>>>>,
) {
    let mut rx = match event_rx.lock().await.take() {
        Some(rx) => rx,
        None => {
            error!("event_rx already taken — bridge can only start once");
            return;
        }
    };

    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let event_name = match &event {
                NvimUiEvent::Flush { pane_id, .. } => {
                    format!("nvim:flush:{}", pane_id)
                }
                NvimUiEvent::ModeChange { pane_id, .. } => {
                    format!("nvim:mode:{}", pane_id)
                }
                NvimUiEvent::DefaultColorsChanged { pane_id, .. } => {
                    format!("nvim:colors:{}", pane_id)
                }
                NvimUiEvent::TitleChanged { pane_id, .. } => {
                    format!("nvim:title:{}", pane_id)
                }
            };

            if let Err(e) = app.emit(&event_name, &event) {
                debug!("failed to emit event {}: {}", event_name, e);
            }

            // Also emit on the generic channel for the frontend to route
            if let Err(e) = app.emit("nvim:event", &event) {
                debug!("failed to emit nvim:event: {}", e);
            }
        }
    });
}
