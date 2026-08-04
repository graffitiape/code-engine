use crate::repository::{
    is_reserved_repo_path, normalize_repo_path, open_repository, repository_has_changes,
    status_for_repo, GitRepoStatus, CODE_ENGINE_TRASH_DIRECTORY,
};
use anyhow::{bail, Context, Result};
use git2::{IndexAddOption, ObjectType, ResetType, StashFlags};
use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::Path;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStashResult {
    pub id: String,
    pub message: String,
    pub status: GitRepoStatus,
}

/// Stage one repository-relative (or absolute in-repository) file path.
pub fn stage_file<P: AsRef<Path>, F: AsRef<Path>>(path: P, file_path: F) -> Result<GitRepoStatus> {
    let repo = open_repository(path.as_ref())?;
    let relative = normalize_repo_path(&repo, file_path.as_ref())?;
    let workdir = repo
        .workdir()
        .context("staging requires a non-bare repository")?;
    let absolute = workdir.join(&relative);
    let mut index = repo.index().context("failed to open git index")?;

    match absolute.symlink_metadata() {
        Ok(metadata) => {
            if metadata.is_dir() {
                bail!(
                    "stage_file expects a file path, got directory: {}",
                    relative.display()
                );
            }
            if index.get_path(&relative, 0).is_none()
                && repo
                    .status_should_ignore(&relative)
                    .context("failed to inspect ignore rules")?
            {
                bail!("file is ignored by git: {}", relative.display());
            }
            index
                .add_path(&relative)
                .with_context(|| format!("failed to stage {}", relative.display()))?;
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if index.get_path(&relative, 0).is_none() {
                bail!(
                    "file is not tracked and does not exist: {}",
                    relative.display()
                );
            }
            index
                .remove_path(&relative)
                .with_context(|| format!("failed to stage deletion of {}", relative.display()))?;
        }
        Err(error) => {
            return Err(error).with_context(|| format!("failed to inspect {}", absolute.display()));
        }
    }

    index.write().context("failed to write git index")?;
    status_for_repo(&repo)
}

/// Stage every tracked and untracked, non-ignored working-tree change.
pub fn stage_all<P: AsRef<Path>>(path: P) -> Result<GitRepoStatus> {
    let repo = open_repository(path.as_ref())?;
    let mut index = repo.index().context("failed to open git index")?;
    if index.has_conflicts() {
        bail!("cannot stage all while the index contains unresolved conflicts");
    }

    let mut skip_recovery_trash =
        |path: &Path, _matched_pathspec: &[u8]| i32::from(is_reserved_repo_path(path));
    index
        .update_all(["*"], Some(&mut skip_recovery_trash))
        .context("failed to update tracked files in git index")?;
    let mut skip_recovery_trash =
        |path: &Path, _matched_pathspec: &[u8]| i32::from(is_reserved_repo_path(path));
    index
        .add_all(
            ["*"],
            IndexAddOption::DEFAULT,
            Some(&mut skip_recovery_trash),
        )
        .context("failed to add working-tree files to git index")?;
    index.write().context("failed to write git index")?;
    status_for_repo(&repo)
}

/// Reset one file in the index to HEAD without modifying the working tree.
pub fn unstage_file<P: AsRef<Path>, F: AsRef<Path>>(
    path: P,
    file_path: F,
) -> Result<GitRepoStatus> {
    let repo = open_repository(path.as_ref())?;
    let relative = normalize_repo_path(&repo, file_path.as_ref())?;
    let head = head_object(&repo)?;
    repo.reset_default(head.as_ref(), [&relative])
        .with_context(|| format!("failed to unstage {}", relative.display()))?;
    status_for_repo(&repo)
}

/// Reset the complete index to HEAD without modifying the working tree.
pub fn unstage_all<P: AsRef<Path>>(path: P) -> Result<GitRepoStatus> {
    let repo = open_repository(path.as_ref())?;
    let head = head_object(&repo)?;
    if let Some(head) = head.as_ref() {
        repo.reset(head, ResetType::Mixed, None)
            .context("failed to reset the index to HEAD")?;
    } else {
        let mut index = repo.index().context("failed to open git index")?;
        index.clear().context("failed to clear the unborn index")?;
        index.write().context("failed to write git index")?;
    }
    status_for_repo(&repo)
}

/// Stash tracked and untracked changes using the repository's configured
/// user.name and user.email. Ignored files remain untouched.
pub fn stash<P: AsRef<Path>>(path: P, message: Option<&str>) -> Result<GitStashResult> {
    let mut repo = open_repository(path.as_ref())?;
    ensure_recovery_trash_is_git_ignored(&repo)?;
    if !repository_has_changes(&repo)? {
        bail!("working tree is clean; there is nothing to stash");
    }
    let signature = repo.signature().context(
        "git identity is not configured; set user.name and user.email before creating a stash",
    )?;
    let message = message
        .map(str::trim)
        .filter(|message| !message.is_empty())
        .unwrap_or("Code Engine stash")
        .to_string();
    let oid = repo
        .stash_save(&signature, &message, Some(StashFlags::INCLUDE_UNTRACKED))
        .context("failed to stash tracked and untracked changes")?;

    Ok(GitStashResult {
        id: oid.to_string(),
        message,
        status: status_for_repo(&repo)?,
    })
}

fn ensure_recovery_trash_is_git_ignored(repo: &git2::Repository) -> Result<()> {
    let exclude_path = repo.path().join("info").join("exclude");
    let existing = match std::fs::read_to_string(&exclude_path) {
        Ok(existing) => existing,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => {
            return Err(error).with_context(|| {
                format!("failed to read Git exclude file {}", exclude_path.display())
            });
        }
    };
    let pattern = format!("/{CODE_ENGINE_TRASH_DIRECTORY}/");
    if existing.lines().any(|line| line.trim() == pattern) {
        return Ok(());
    }

    if let Some(parent) = exclude_path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("failed to create Git info directory {}", parent.display()))?;
    }
    let mut exclude = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&exclude_path)
        .with_context(|| format!("failed to open Git exclude file {}", exclude_path.display()))?;
    if !existing.is_empty() && !existing.ends_with('\n') {
        exclude.write_all(b"\n")?;
    }
    writeln!(exclude, "# Code Engine recoverable trash")?;
    writeln!(exclude, "{pattern}")?;
    exclude
        .sync_all()
        .with_context(|| format!("failed to sync Git exclude file {}", exclude_path.display()))
}

fn head_object(repo: &git2::Repository) -> Result<Option<git2::Object<'_>>> {
    match repo.head() {
        Ok(head) => Ok(Some(
            head.peel(ObjectType::Commit)
                .context("failed to resolve HEAD commit")?,
        )),
        Err(error)
            if matches!(
                error.code(),
                git2::ErrorCode::UnbornBranch | git2::ErrorCode::NotFound
            ) =>
        {
            Ok(None)
        }
        Err(error) => Err(error).context("failed to resolve HEAD"),
    }
}
