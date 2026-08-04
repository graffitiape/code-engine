use anyhow::{bail, Context, Result};
use git2::build::CheckoutBuilder;
use git2::{
    BranchType, Delta, Diff, DiffFormat, DiffOptions, ErrorCode, ObjectType, Repository, Sort,
    Status, StatusOptions,
};
use serde::{Deserialize, Serialize};
use std::ffi::OsStr;
use std::path::{Component, Path, PathBuf};

const DEFAULT_DIFF_BYTES: usize = 1024 * 1024;
const HARD_MAX_DIFF_BYTES: usize = 4 * 1024 * 1024;
const DEFAULT_LOG_LIMIT: usize = 50;
const HARD_MAX_LOG_LIMIT: usize = 200;
pub(crate) const CODE_ENGINE_TRASH_DIRECTORY: &str = ".code-engine-trash";

/// One file in `git status` output. Paths are always relative to the selected
/// workspace, which must exactly match the repository root.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    pub path: String,
    /// "staged" | "unstaged" | "untracked" | "conflicted"
    pub state: String,
    /// "modified" | "new" | "deleted" | "renamed" | "conflict"
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitRepoStatus {
    pub repo_root: String,
    pub branch: String,
    pub ahead: usize,
    pub behind: usize,
    pub staged: Vec<GitFileStatus>,
    pub unstaged: Vec<GitFileStatus>,
    pub untracked: Vec<GitFileStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GitDiffKind {
    Staged,
    Unstaged,
    Untracked,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitDiffResult {
    pub repo_root: String,
    pub path: Option<String>,
    pub kind: GitDiffKind,
    pub patch: String,
    pub binary: bool,
    pub truncated: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLogEntry {
    pub id: String,
    pub short_id: String,
    pub summary: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub timezone_offset_minutes: i32,
    pub parent_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitBranchInfo {
    pub name: String,
    pub kind: String,
    pub current: bool,
    pub upstream: Option<String>,
    pub target: Option<String>,
}

/// Open the repository rooted exactly at `path` and produce a status snapshot.
pub fn status<P: AsRef<Path>>(path: P) -> Result<GitRepoStatus> {
    let repo = open_repository(path.as_ref())?;
    status_for_repo(&repo)
}

pub fn unified_diff<P: AsRef<Path>>(
    path: P,
    file_path: Option<&str>,
    kind: GitDiffKind,
    max_bytes: Option<usize>,
) -> Result<GitDiffResult> {
    let repo = open_repository(path.as_ref())?;
    let relative_path = file_path
        .map(|file_path| normalize_repo_path(&repo, Path::new(file_path)))
        .transpose()?;
    let mut options = DiffOptions::new();
    options
        .context_lines(3)
        .interhunk_lines(0)
        .max_size(16_i64 * 1024 * 1024);
    if let Some(relative_path) = &relative_path {
        options.pathspec(relative_path);
    }

    let diff = match kind {
        GitDiffKind::Staged => {
            let head_tree = repo.head().ok().and_then(|head| head.peel_to_tree().ok());
            repo.diff_tree_to_index(head_tree.as_ref(), None, Some(&mut options))
                .context("failed to build staged diff")?
        }
        GitDiffKind::Unstaged => repo
            .diff_index_to_workdir(None, Some(&mut options))
            .context("failed to build unstaged diff")?,
        GitDiffKind::Untracked => {
            options
                .include_untracked(true)
                .recurse_untracked_dirs(true)
                .show_untracked_content(true);
            repo.diff_index_to_workdir(None, Some(&mut options))
                .context("failed to build untracked diff")?
        }
    };

    let max_bytes = max_bytes
        .unwrap_or(DEFAULT_DIFF_BYTES)
        .clamp(1, HARD_MAX_DIFF_BYTES);
    let delta_filter = (kind == GitDiffKind::Untracked).then_some(Delta::Untracked);
    let (patch, truncated) = render_patch(&diff, max_bytes, delta_filter)?;
    let binary = diff
        .deltas()
        .filter(|delta| delta_filter.is_none_or(|expected| delta.status() == expected))
        .filter(|delta| !delta_is_reserved(delta))
        .any(|delta| {
            delta.flags().is_binary()
                || delta.old_file().is_binary()
                || delta.new_file().is_binary()
        });

    Ok(GitDiffResult {
        repo_root: repo_root_string(&repo)?,
        path: relative_path.map(|path| repo_path_string(&path)),
        kind,
        patch,
        binary,
        truncated,
    })
}

pub fn recent_log<P: AsRef<Path>>(path: P, limit: Option<usize>) -> Result<Vec<GitLogEntry>> {
    let repo = open_repository(path.as_ref())?;
    let limit = limit
        .unwrap_or(DEFAULT_LOG_LIMIT)
        .clamp(1, HARD_MAX_LOG_LIMIT);
    let mut walk = repo.revwalk().context("failed to create revision walk")?;
    if let Err(error) = walk.push_head() {
        if matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) {
            return Ok(Vec::new());
        }
        return Err(error).context("failed to start revision walk at HEAD");
    }
    walk.set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .context("failed to configure revision walk")?;

    let mut entries = Vec::new();
    for oid in walk.take(limit) {
        let oid = oid.context("failed to read revision")?;
        let commit = repo.find_commit(oid).context("failed to load commit")?;
        entries.push(log_entry(&commit));
    }
    Ok(entries)
}

pub fn branches<P: AsRef<Path>>(path: P) -> Result<Vec<GitBranchInfo>> {
    let repo = open_repository(path.as_ref())?;
    let mut result = Vec::new();
    for branch in repo.branches(None).context("failed to list branches")? {
        let (branch, branch_type) = branch.context("failed to read branch")?;
        let name = branch
            .name()
            .context("failed to read branch name")?
            .map(str::to_owned)
            .unwrap_or_else(|| "<non-utf8>".to_string());
        let kind = match branch_type {
            BranchType::Local => "local",
            BranchType::Remote => "remote",
        }
        .to_string();
        let upstream = if branch_type == BranchType::Local {
            branch
                .upstream()
                .ok()
                .and_then(|upstream| upstream.name().ok().flatten().map(str::to_owned))
        } else {
            None
        };
        result.push(GitBranchInfo {
            name,
            kind,
            current: branch.is_head(),
            upstream,
            target: branch.get().target().map(|oid| oid.to_string()),
        });
    }

    result.sort_by(|left, right| {
        right
            .current
            .cmp(&left.current)
            .then_with(|| left.kind.cmp(&right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });
    Ok(result)
}

pub fn checkout_branch<P: AsRef<Path>>(path: P, branch_name: &str) -> Result<GitBranchInfo> {
    if branch_name.trim().is_empty() {
        bail!("branch name cannot be empty");
    }
    let repo = open_repository(path.as_ref())?;
    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .with_context(|| format!("local branch not found: {branch_name}"))?;
    if branch.is_head() {
        return branch_info(&branch, BranchType::Local);
    }
    if repository_has_changes(&repo)? {
        bail!("working tree has uncommitted changes; commit or stash before switching branches");
    }

    let reference_name = branch
        .get()
        .name()
        .context("branch reference is not valid UTF-8")?
        .to_string();
    let target = branch
        .get()
        .peel(ObjectType::Commit)
        .with_context(|| format!("failed to resolve branch {branch_name}"))?;
    let mut checkout = CheckoutBuilder::new();
    checkout.safe();
    repo.checkout_tree(&target, Some(&mut checkout))
        .with_context(|| format!("safe checkout failed for branch {branch_name}"))?;
    repo.set_head(&reference_name)
        .with_context(|| format!("failed to set HEAD to branch {branch_name}"))?;

    let branch = repo
        .find_branch(branch_name, BranchType::Local)
        .with_context(|| format!("failed to reload branch {branch_name}"))?;
    branch_info(&branch, BranchType::Local)
}

pub(crate) fn open_repository(path: &Path) -> Result<Repository> {
    let selected = path
        .canonicalize()
        .with_context(|| format!("failed to resolve selected workspace {}", path.display()))?;
    if !selected.is_dir() {
        bail!(
            "selected workspace is not a directory: {}",
            selected.display()
        );
    }

    let repo = Repository::open(&selected).with_context(|| {
        format!(
            "selected workspace must be a Git repository root: {}",
            selected.display()
        )
    })?;
    let workdir = repo
        .workdir()
        .context("selected workspace must be a non-bare Git repository root")?
        .canonicalize()
        .context("failed to resolve Git repository worktree")?;
    if workdir != selected {
        bail!(
            "selected workspace must exactly match the Git repository root: selected {}, repository {}",
            selected.display(),
            workdir.display()
        );
    }
    Ok(repo)
}

pub(crate) fn status_for_repo(repo: &Repository) -> Result<GitRepoStatus> {
    let branch = current_branch(repo).unwrap_or_else(|| "HEAD".to_string());
    let (ahead, behind) = ahead_behind(repo).unwrap_or((0, 0));
    let mut options = status_options();
    let statuses = repo
        .statuses(Some(&mut options))
        .context("failed to read git statuses")?;
    let mut staged = Vec::new();
    let mut unstaged = Vec::new();
    let mut untracked = Vec::new();

    for entry in statuses.iter() {
        let Some(path) = entry.path().map(str::to_owned) else {
            continue;
        };
        if is_reserved_repo_path(Path::new(&path)) {
            continue;
        }
        let state = entry.status();
        if state.contains(Status::CONFLICTED) {
            unstaged.push(GitFileStatus {
                path,
                state: "conflicted".into(),
                kind: "conflict".into(),
            });
            continue;
        }

        if let Some(kind) = staged_kind(state) {
            staged.push(GitFileStatus {
                path: path.clone(),
                state: "staged".into(),
                kind: kind.into(),
            });
        }
        if let Some((bucket, kind)) = worktree_kind(state) {
            let item = GitFileStatus {
                path,
                state: bucket.into(),
                kind: kind.into(),
            };
            if bucket == "untracked" {
                untracked.push(item);
            } else {
                unstaged.push(item);
            }
        }
    }

    staged.sort_by(|left, right| left.path.cmp(&right.path));
    unstaged.sort_by(|left, right| left.path.cmp(&right.path));
    untracked.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(GitRepoStatus {
        repo_root: repo_root_string(repo)?,
        branch,
        ahead,
        behind,
        staged,
        unstaged,
        untracked,
    })
}

pub(crate) fn normalize_repo_path(repo: &Repository, path: &Path) -> Result<PathBuf> {
    let workdir = repo
        .workdir()
        .context("operation requires a non-bare repository")?;
    let relative = if path.is_absolute() {
        path.strip_prefix(workdir).with_context(|| {
            format!(
                "path {} is outside repository root {}",
                path.display(),
                workdir.display()
            )
        })?
    } else {
        path
    };

    let mut normalized = PathBuf::new();
    for component in relative.components() {
        match component {
            Component::Normal(segment) => normalized.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("path must stay inside the repository: {}", path.display())
            }
        }
    }
    if normalized.as_os_str().is_empty() {
        bail!("file path cannot be empty");
    }
    if is_reserved_repo_path(&normalized) {
        bail!("Code Engine recovery trash is reserved and cannot be used by Git operations");
    }
    if normalized
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == ".git")
    {
        bail!("operations on repository metadata are not allowed");
    }
    Ok(normalized)
}

pub(crate) fn repository_has_changes(repo: &Repository) -> Result<bool> {
    let mut options = status_options();
    Ok(repo
        .statuses(Some(&mut options))
        .context("failed to inspect working tree")?
        .iter()
        .any(|entry| {
            entry
                .path()
                .is_some_and(|path| !is_reserved_repo_path(Path::new(path)))
        }))
}

pub(crate) fn repository_has_staged_recovery_trash(repo: &Repository) -> Result<bool> {
    let mut options = status_options();
    Ok(repo
        .statuses(Some(&mut options))
        .context("failed to inspect staged changes")?
        .iter()
        .any(|entry| {
            entry.path().is_some_and(|path| {
                is_reserved_repo_path(Path::new(path)) && staged_kind(entry.status()).is_some()
            })
        }))
}

pub(crate) fn is_reserved_repo_path(path: &Path) -> bool {
    path.components().next().is_some_and(|component| {
        matches!(component, Component::Normal(segment) if segment == OsStr::new(CODE_ENGINE_TRASH_DIRECTORY))
    })
}

pub(crate) fn log_entry(commit: &git2::Commit<'_>) -> GitLogEntry {
    let id = commit.id().to_string();
    let author = commit.author();
    GitLogEntry {
        short_id: id.chars().take(8).collect(),
        id,
        summary: commit.summary().unwrap_or_default().to_string(),
        message: commit.message().unwrap_or_default().to_string(),
        author_name: author.name().unwrap_or_default().to_string(),
        author_email: author.email().unwrap_or_default().to_string(),
        timestamp: commit.time().seconds(),
        timezone_offset_minutes: commit.time().offset_minutes(),
        parent_ids: commit.parent_ids().map(|oid| oid.to_string()).collect(),
    }
}

pub(crate) fn status_options() -> StatusOptions {
    let mut options = StatusOptions::new();
    options
        .include_untracked(true)
        .include_ignored(false)
        .recurse_untracked_dirs(true)
        .renames_head_to_index(true)
        .renames_index_to_workdir(true);
    options
}

fn staged_kind(state: Status) -> Option<&'static str> {
    if state.contains(Status::INDEX_NEW) {
        Some("new")
    } else if state.contains(Status::INDEX_MODIFIED) {
        Some("modified")
    } else if state.contains(Status::INDEX_DELETED) {
        Some("deleted")
    } else if state.contains(Status::INDEX_RENAMED) {
        Some("renamed")
    } else if state.contains(Status::INDEX_TYPECHANGE) {
        Some("typechange")
    } else {
        None
    }
}

fn worktree_kind(state: Status) -> Option<(&'static str, &'static str)> {
    if state.contains(Status::WT_NEW) {
        Some(("untracked", "new"))
    } else if state.contains(Status::WT_MODIFIED) {
        Some(("unstaged", "modified"))
    } else if state.contains(Status::WT_DELETED) {
        Some(("unstaged", "deleted"))
    } else if state.contains(Status::WT_RENAMED) {
        Some(("unstaged", "renamed"))
    } else if state.contains(Status::WT_TYPECHANGE) {
        Some(("unstaged", "typechange"))
    } else {
        None
    }
}

fn current_branch(repo: &Repository) -> Option<String> {
    repo.head()
        .ok()
        .and_then(|head| head.shorthand().map(str::to_owned))
        .or_else(|| {
            repo.find_reference("HEAD")
                .ok()?
                .symbolic_target()?
                .strip_prefix("refs/heads/")
                .map(str::to_owned)
        })
}

fn ahead_behind(repo: &Repository) -> Result<(usize, usize)> {
    let head = repo.head()?;
    let local_oid = head.target().context("HEAD has no target")?;
    let Some(upstream_name) = repo.branch_upstream_name(head.name().unwrap_or("")).ok() else {
        return Ok((0, 0));
    };
    let Some(upstream_name) = upstream_name.as_str() else {
        return Ok((0, 0));
    };
    let Ok(upstream) = repo.find_reference(upstream_name) else {
        return Ok((0, 0));
    };
    let Some(upstream_oid) = upstream.target() else {
        return Ok((0, 0));
    };
    Ok(repo.graph_ahead_behind(local_oid, upstream_oid)?)
}

fn render_patch(
    diff: &Diff<'_>,
    max_bytes: usize,
    delta_filter: Option<Delta>,
) -> Result<(String, bool)> {
    let mut bytes = Vec::new();
    let mut truncated = false;
    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        if delta_filter.is_some_and(|expected| delta.status() != expected)
            || delta_is_reserved(&delta)
        {
            return true;
        }
        if bytes.len() >= max_bytes {
            truncated = true;
            return true;
        }
        let content = line.content();
        let remaining = max_bytes - bytes.len();
        if content.len() > remaining {
            bytes.extend_from_slice(&content[..remaining]);
            truncated = true;
        } else {
            bytes.extend_from_slice(content);
        }
        true
    })
    .context("failed to render unified diff")?;
    Ok((String::from_utf8_lossy(&bytes).into_owned(), truncated))
}

fn delta_is_reserved(delta: &git2::DiffDelta<'_>) -> bool {
    delta.old_file().path().is_some_and(is_reserved_repo_path)
        || delta.new_file().path().is_some_and(is_reserved_repo_path)
}

fn repo_root_string(repo: &Repository) -> Result<String> {
    let root = repo
        .workdir()
        .context("operation requires a non-bare repository")?;
    Ok(root
        .canonicalize()
        .unwrap_or_else(|_| root.to_path_buf())
        .to_string_lossy()
        .into_owned())
}

fn repo_path_string(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn branch_info(branch: &git2::Branch<'_>, branch_type: BranchType) -> Result<GitBranchInfo> {
    let name = branch
        .name()
        .context("failed to read branch name")?
        .context("branch name is not valid UTF-8")?
        .to_string();
    let upstream = if branch_type == BranchType::Local {
        branch
            .upstream()
            .ok()
            .and_then(|upstream| upstream.name().ok().flatten().map(str::to_owned))
    } else {
        None
    };
    Ok(GitBranchInfo {
        name,
        kind: match branch_type {
            BranchType::Local => "local",
            BranchType::Remote => "remote",
        }
        .to_string(),
        current: branch.is_head(),
        upstream,
        target: branch.get().target().map(|oid| oid.to_string()),
    })
}
