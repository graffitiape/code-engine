use std::collections::HashMap;
use std::sync::Arc;

use ce_core::nvim::handler::NvimUiEvent;
use ce_core::nvim::process::NvimInstance;
use tokio::sync::{mpsc, Mutex};
use uuid::Uuid;

/// Application state shared across Tauri commands
pub struct AppState {
    /// Active Neovim instances keyed by pane_id
    pub instances: Arc<Mutex<HashMap<String, NvimInstance>>>,
    /// Channel for sending UI events from nvim handlers to the bridge
    pub event_tx: mpsc::UnboundedSender<NvimUiEvent>,
    /// Receiver end (consumed by the bridge event loop)
    pub event_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<NvimUiEvent>>>>,
    /// Currently opened workspace root (project folder).
    pub workspace_root: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        let (event_tx, event_rx) = mpsc::unbounded_channel();
        Self {
            instances: Arc::new(Mutex::new(HashMap::new())),
            event_tx,
            event_rx: Arc::new(Mutex::new(Some(event_rx))),
            workspace_root: Arc::new(Mutex::new(None)),
        }
    }

    /// Create a new pane with a Neovim instance
    pub async fn create_pane(
        &self,
        cols: u64,
        rows: u64,
        cwd: Option<&str>,
    ) -> Result<String, String> {
        let pane_id = Uuid::new_v4().to_string();

        let instance = NvimInstance::spawn(
            pane_id.clone(),
            cols,
            rows,
            cwd,
            self.event_tx.clone(),
        )
        .await
        .map_err(|e| format!("failed to spawn nvim: {}", e))?;

        self.instances.lock().await.insert(pane_id.clone(), instance);
        Ok(pane_id)
    }

    /// Close a pane and its Neovim instance
    pub async fn close_pane(&self, pane_id: &str) -> Result<(), String> {
        let mut instances = self.instances.lock().await;
        if let Some(instance) = instances.remove(pane_id) {
            instance.quit().await.map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    /// Send input to a specific pane's Neovim instance
    pub async fn send_input(&self, pane_id: &str, keys: &str) -> Result<(), String> {
        let instances = self.instances.lock().await;
        match instances.get(pane_id) {
            Some(instance) => instance
                .input(keys)
                .await
                .map_err(|e| e.to_string()),
            None => Err(format!("pane not found: {}", pane_id)),
        }
    }

    /// Resize a pane
    pub async fn resize_pane(
        &self,
        pane_id: &str,
        cols: u64,
        rows: u64,
    ) -> Result<(), String> {
        let instances = self.instances.lock().await;
        match instances.get(pane_id) {
            Some(instance) => instance
                .resize(cols, rows)
                .await
                .map_err(|e| e.to_string()),
            None => Err(format!("pane not found: {}", pane_id)),
        }
    }

    /// Execute command on a specific pane
    pub async fn send_command(&self, pane_id: &str, cmd: &str) -> Result<(), String> {
        let instances = self.instances.lock().await;
        match instances.get(pane_id) {
            Some(instance) => instance
                .command(cmd)
                .await
                .map_err(|e| e.to_string()),
            None => Err(format!("pane not found: {}", pane_id)),
        }
    }
}
