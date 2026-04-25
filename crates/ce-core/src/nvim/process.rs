use anyhow::{Context, Result};
use nvim_rs::create::tokio as nvim_tokio;
use nvim_rs::Neovim;
use tokio::process::Command;
use tokio::sync::mpsc;
use tracing::info;

use super::handler::{NvimHandler, NvimUiEvent};

type NvimWriter = nvim_rs::compat::tokio::Compat<tokio::process::ChildStdin>;

/// A running Neovim instance attached to a pane
pub struct NvimInstance {
    pub pane_id: String,
    pub neovim: Neovim<NvimWriter>,
    join_handle: tokio::task::JoinHandle<()>,
    _child: tokio::process::Child,
}

impl NvimInstance {
    /// Spawn a new embedded Neovim process
    pub async fn spawn(
        pane_id: String,
        cols: u64,
        rows: u64,
        cwd: Option<&str>,
        event_tx: mpsc::UnboundedSender<NvimUiEvent>,
    ) -> Result<Self> {
        let handler = NvimHandler::new(pane_id.clone(), event_tx);

        // Resolve nvim binary: explicit setting wins, otherwise rely on PATH.
        let settings = crate::config::settings::AppSettings::load().unwrap_or_default();
        let nvim_bin = settings
            .nvim_path
            .as_deref()
            .filter(|p| !p.is_empty())
            .unwrap_or("nvim");
        let mut cmd = Command::new(nvim_bin);
        cmd.arg("--embed");

        // Set environment for terminal compatibility
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("CODEENGINE", "1");

        // Inherit interactive shell PATH so plugin managers (Mason, lazy.nvim)
        // can spawn node, ripgrep, fd, etc. that live in user shells.
        if let Some(home) = std::env::var_os("HOME") {
            cmd.env("HOME", home);
        }

        if let Some(dir) = cwd {
            cmd.current_dir(dir);
        }

        eprintln!("[CE] spawning nvim --embed...");

        let (neovim, io_handle, child) = nvim_tokio::new_child_cmd(&mut cmd, handler)
            .await
            .context("failed to spawn nvim --embed")?;

        eprintln!("[CE] nvim process spawned, starting IO loop...");

        // Spawn IO handler in background
        let join_handle = tokio::spawn(async move {
            match io_handle.await {
                Err(e) => eprintln!("[CE] nvim IO task panic: {:?}", e),
                Ok(Err(e)) => eprintln!("[CE] nvim IO error: {:?}", e),
                Ok(Ok(())) => eprintln!("[CE] nvim IO loop ended cleanly"),
            }
        });

        // Attach UI
        let mut ui_opts = nvim_rs::UiAttachOptions::new();
        ui_opts.set_linegrid_external(true);
        ui_opts.set_rgb(true);

        eprintln!("[CE] calling ui_attach({}, {})...", cols, rows);

        neovim
            .ui_attach(cols as i64, rows as i64, &ui_opts)
            .await
            .context("failed to ui_attach")?;

        eprintln!("[CE] ui_attach done, setting g:codeengine...");

        // Set vim.g.codeengine for plugin detection
        neovim
            .command("let g:codeengine = 1")
            .await
            .ok();

        eprintln!("[CE] nvim instance fully ready");
        info!(pane_id = %pane_id, cols = cols, rows = rows, "nvim instance spawned and attached");

        Ok(Self {
            pane_id,
            neovim,
            join_handle,
            _child: child,
        })
    }

    /// Send input keys to this Neovim instance
    pub async fn input(&self, keys: &str) -> Result<()> {
        self.neovim
            .input(keys)
            .await
            .context("failed to send input")?;
        Ok(())
    }

    /// Execute a Neovim command
    pub async fn command(&self, cmd: &str) -> Result<()> {
        self.neovim
            .command(cmd)
            .await
            .context("failed to execute command")?;
        Ok(())
    }

    /// Resize the UI
    pub async fn resize(&self, cols: u64, rows: u64) -> Result<()> {
        self.neovim
            .ui_try_resize(cols as i64, rows as i64)
            .await
            .context("failed to resize")?;
        Ok(())
    }

    /// Get the current buffer name (file path)
    pub async fn get_current_buf_name(&self) -> Result<String> {
        let buf = self.neovim.get_current_buf().await?;
        let name = buf.get_name().await?;
        Ok(name)
    }

    /// Gracefully quit this Neovim instance
    pub async fn quit(&self) -> Result<()> {
        // Try graceful quit first
        let _ = self.neovim.command("qa!").await;
        Ok(())
    }

    /// Abort the IO handler (called on drop or force close)
    pub fn abort(&self) {
        self.join_handle.abort();
    }
}

impl Drop for NvimInstance {
    fn drop(&mut self) {
        self.join_handle.abort();
    }
}
