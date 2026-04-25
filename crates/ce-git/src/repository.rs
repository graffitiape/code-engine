use anyhow::{Context, Result};
use git2::{Repository, Status, StatusOptions};
use serde::Serialize;
use std::path::Path;

/// One file in `git status` output.
#[derive(Debug, Clone, Serialize)]
pub struct GitFileStatus {
    pub path: String,
    /// "staged" | "unstaged" | "untracked" | "conflicted"
    pub state: String,
    /// e.g. "modified", "new", "deleted", "renamed"
    pub kind: String,
}

/// Aggregate repo status for the GitPanel.
#[derive(Debug, Clone, Serialize)]
pub struct GitRepoStatus {
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<GitFileStatus>,
}

/// Open a repository discovering up from `path` and produce a status snapshot.
pub fn status<P: AsRef<Path>>(path: P) -> Result<GitRepoStatus> {
    let repo = Repository::discover(path.as_ref())
        .with_context(|| format!("no git repo for {}", path.as_ref().display()))?;

    let branch = current_branch(&repo).unwrap_or_else(|| "HEAD".to_string());
    let (ahead, behind) = ahead_behind(&repo).unwrap_or((0, 0));

    let mut opts = StatusOptions::new();
    opts.include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true);

    let statuses = repo
        .statuses(Some(&mut opts))
        .context("failed to read git statuses")?;

    let mut staged: Vec<GitFileStatus> = Vec::new();
    let mut unstaged: Vec<GitFileStatus> = Vec::new();
    let mut untracked: Vec<GitFileStatus> = Vec::new();

    for entry in statuses.iter() {
        let path = match entry.path() {
            Some(p) => p.to_string(),
            None => continue,
        };
        let s = entry.status();

        // Conflict files.
        if s.contains(Status::CONFLICTED) {
            unstaged.push(GitFileStatus {
                path,
                state: "conflicted".into(),
                kind: "conflict".into(),
            });
            continue;
        }

        // Staged (index_*) flags
        let staged_kind = if s.contains(Status::INDEX_NEW) {
            Some("new")
        } else if s.contains(Status::INDEX_MODIFIED) {
            Some("modified")
        } else if s.contains(Status::INDEX_DELETED) {
            Some("deleted")
        } else if s.contains(Status::INDEX_RENAMED) {
            Some("renamed")
        } else if s.contains(Status::INDEX_TYPECHANGE) {
            Some("typechange")
        } else {
            None
        };

        if let Some(kind) = staged_kind {
            staged.push(GitFileStatus {
                path: path.clone(),
                state: "staged".into(),
                kind: kind.into(),
            });
        }

        // Working tree (wt_*) flags
        let wt_kind = if s.contains(Status::WT_NEW) {
            Some(("untracked", "new"))
        } else if s.contains(Status::WT_MODIFIED) {
            Some(("unstaged", "modified"))
        } else if s.contains(Status::WT_DELETED) {
            Some(("unstaged", "deleted"))
        } else if s.contains(Status::WT_RENAMED) {
            Some(("unstaged", "renamed"))
        } else if s.contains(Status::WT_TYPECHANGE) {
            Some(("unstaged", "typechange"))
        } else {
            None
        };

        if let Some((bucket, kind)) = wt_kind {
            let entry = GitFileStatus {
                path,
                state: bucket.into(),
                kind: kind.into(),
            };
            match bucket {
                "untracked" => untracked.push(entry),
                _ => unstaged.push(entry),
            }
        }
    }

    Ok(GitRepoStatus {
        branch,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
    })
}

fn current_branch(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    if head.is_branch() {
        head.shorthand().map(|s| s.to_string())
    } else {
        head.shorthand().map(|s| s.to_string())
    }
}

fn ahead_behind(repo: &Repository) -> Result<(usize, usize)> {
    let head = repo.head()?;
    let local_oid = head.target().context("HEAD has no target")?;
    let upstream = repo
        .branch_upstream_name(head.name().unwrap_or(""))
        .ok();
    let upstream = match upstream {
        Some(u) => u,
        None => return Ok((0, 0)),
    };
    let upstream_str = upstream.as_str().unwrap_or("");
    let upstream_ref = match repo.find_reference(upstream_str) {
        Ok(r) => r,
        Err(_) => return Ok((0, 0)),
    };
    let upstream_oid = match upstream_ref.target() {
        Some(o) => o,
        None => return Ok((0, 0)),
    };
    Ok(repo.graph_ahead_behind(local_oid, upstream_oid)?)
}
