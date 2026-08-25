use anyhow::{bail, Context, Result};
use std::path::Path;
use std::process::Command;

use crate::config::{provider_for_selected_remote, selected_remote_name};
use crate::repository::open_repository;

/// Push the current branch through the user's configured Git credential setup.
/// The repository root is validated before invoking Git and no shell is used.
pub fn push<P: AsRef<Path>>(path: P) -> Result<String> {
    let root = canonical_root(path.as_ref())?;
    let repository = open_repository(&root)?;
    let branch = current_branch(&repository)?;
    let provider = provider_for_selected_remote(&repository)?;
    drop(repository);

    run_git(&root, &["push", "--porcelain"], "push", &provider)?;
    Ok(branch)
}

/// Publish the current branch to the selected remote and configure its upstream.
/// This mirrors the explicit "Publish Branch" action used by desktop editors.
pub fn publish_branch<P: AsRef<Path>>(path: P) -> Result<String> {
    let root = canonical_root(path.as_ref())?;
    let repository = open_repository(&root)?;
    let branch = current_branch(&repository)?;
    let remote = selected_remote_name(&repository)?
        .context("this repository has no Git remote; add a remote before publishing the branch")?;
    let provider = provider_for_selected_remote(&repository)?;
    drop(repository);

    run_git(
        &root,
        &["push", "--porcelain", "--set-upstream", &remote, &branch],
        "publish branch",
        &provider,
    )?;
    Ok(branch)
}

/// Ask the repository's configured Git transport and credential helper to
/// verify access. HTTPS helpers may open their normal secure browser flow;
/// SSH remotes continue to use the user's agent and keychain.
pub fn check_remote_access<P: AsRef<Path>>(path: P) -> Result<String> {
    let root = canonical_root(path.as_ref())?;
    let repository = open_repository(&root)?;
    let remote = selected_remote_name(&repository)?
        .context("this repository has no Git remote to connect")?;
    let provider = provider_for_selected_remote(&repository)?;
    drop(repository);

    run_git(
        &root,
        &["ls-remote", &remote, "HEAD"],
        "remote access check",
        &provider,
    )?;
    Ok(provider)
}

fn canonical_root(path: &Path) -> Result<std::path::PathBuf> {
    path.canonicalize()
        .with_context(|| format!("failed to resolve selected workspace {}", path.display()))
}

fn current_branch(repository: &git2::Repository) -> Result<String> {
    Ok(repository
        .head()
        .context("failed to resolve HEAD before push")?
        .shorthand()
        .context("cannot push a detached HEAD")?
        .to_string())
}

fn run_git(root: &Path, args: &[&str], action: &str, provider: &str) -> Result<()> {
    let output = Command::new("git")
        .current_dir(root)
        .env("GIT_TERMINAL_PROMPT", "0")
        .args(args)
        .output()
        .with_context(|| format!("failed to start Git {action}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = sanitize_git_output(if stderr.is_empty() { &stdout } else { &stderr });
    bail!("{}", friendly_remote_error(action, provider, &detail));
}

fn friendly_remote_error(action: &str, provider: &str, detail: &str) -> String {
    let lower = detail.to_ascii_lowercase();
    if lower.contains("no upstream branch") || lower.contains("has no upstream branch") {
        return "the current branch has no upstream; publish the branch before pushing".to_string();
    }
    if lower.contains("authentication failed")
        || lower.contains("could not read username")
        || lower.contains("terminal prompts disabled")
        || lower.contains("permission denied (publickey)")
        || lower.contains("repository not found")
        || lower.contains("access denied")
    {
        return format!(
            "{provider} authentication failed; sign in with your configured Git credential helper or verify your SSH key, then retry"
        );
    }
    format!(
        "Git {action} failed: {}",
        if detail.is_empty() {
            "unknown error"
        } else {
            detail
        }
    )
}

fn sanitize_git_output(value: &str) -> String {
    let mut output = value
        .chars()
        .filter(|character| !character.is_control() || matches!(character, '\n' | '\t'))
        .take(4_096)
        .collect::<String>();
    let mut cursor = 0;
    while let Some(relative_scheme) = output[cursor..].find("://") {
        let authority_start = cursor + relative_scheme + 3;
        let authority_end = output[authority_start..]
            .find(['/', ' ', '\n', '\t', '\'', '"'])
            .map(|offset| authority_start + offset)
            .unwrap_or(output.len());
        let Some(relative_at) = output[authority_start..authority_end].rfind('@') else {
            cursor = authority_end.min(output.len());
            if cursor >= output.len() {
                break;
            }
            continue;
        };
        let at = authority_start + relative_at;
        output.replace_range(authority_start..=at, "[redacted]@");
        cursor = authority_start + "[redacted]@".len();
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn remote_errors_are_actionable_without_echoing_credentials() {
        let raw =
            "fatal: Authentication failed for 'https://secret-token@github.com/acme/repo.git/'";
        let safe = sanitize_git_output(raw);
        assert!(!safe.contains("secret-token"));
        assert!(safe.contains("[redacted]@github.com"));
        assert_eq!(
            friendly_remote_error("push", "GitHub", &safe),
            "GitHub authentication failed; sign in with your configured Git credential helper or verify your SSH key, then retry"
        );
    }

    #[test]
    fn missing_upstream_gets_a_publish_branch_action() {
        assert_eq!(
            friendly_remote_error(
                "push",
                "GitHub",
                "fatal: The current branch feature has no upstream branch.",
            ),
            "the current branch has no upstream; publish the branch before pushing"
        );
    }
}
