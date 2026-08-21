use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

use crate::repository::open_repository;

/// Push the current branch through the user's configured Git credential setup.
/// The repository root is validated before invoking Git and no shell is used.
pub fn push<P: AsRef<Path>>(path: P) -> Result<String> {
    let root = path.as_ref().canonicalize().with_context(|| {
        format!(
            "failed to resolve selected workspace {}",
            path.as_ref().display()
        )
    })?;
    let repository = open_repository(&root)?;
    let branch = repository
        .head()
        .context("failed to resolve HEAD before push")?
        .shorthand()
        .context("cannot push a detached HEAD")?
        .to_string();
    drop(repository);

    let output = Command::new("git")
        .current_dir(&root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(["push", "--porcelain"])
        .output()
        .context("failed to start git push")?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if stderr.is_empty() { stdout } else { stderr };
        bail!(
            "git push failed: {}",
            if detail.is_empty() {
                "unknown error"
            } else {
                &detail
            }
        );
    }
    Ok(branch)
}
