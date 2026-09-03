use std::sync::Arc;

use tokio::sync::Mutex;

use crate::codex::CodexAppServer;
use crate::lsp::LspHost;

/// Application state shared across Tauri commands.
pub struct AppState {
    /// One shared Codex app-server process for authentication, threads, and turns.
    pub codex: Arc<CodexAppServer>,
    /// Workspace-scoped language server processes and bounded stdio transport.
    pub lsp: Arc<LspHost>,
    /// Canonical active project folder used as the native security boundary.
    pub workspace_root: Arc<Mutex<Option<String>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            codex: CodexAppServer::new(),
            lsp: LspHost::new(),
            workspace_root: Arc::new(Mutex::new(None)),
        }
    }
}
