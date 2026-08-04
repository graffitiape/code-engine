use crate::repository::{
    log_entry, open_repository, repository_has_staged_recovery_trash, GitLogEntry,
};
use anyhow::{bail, Context, Result};
use git2::{Commit, ErrorCode, ObjectType};
use std::path::Path;

/// Commit the current index using the repository's configured user.name and
/// user.email. The supplied message is stored exactly as provided and no
/// authorship trailers are added.
pub fn commit<P: AsRef<Path>>(path: P, message: &str) -> Result<GitLogEntry> {
    if message.trim().is_empty() {
        bail!("commit message cannot be empty");
    }
    if message.lines().any(is_co_author_trailer) {
        bail!("Co-Authored-By trailers are not allowed in commit messages");
    }

    let repo = open_repository(path.as_ref())?;
    let signature = repo.signature().context(
        "git identity is not configured; set user.name and user.email before committing",
    )?;
    let mut index = repo.index().context("failed to open git index")?;
    if index.has_conflicts() {
        bail!("cannot commit while the index contains unresolved conflicts");
    }
    if repository_has_staged_recovery_trash(&repo)? {
        bail!(
            "cannot commit Code Engine recovery trash; unstage .code-engine-trash before committing"
        );
    }

    let tree_id = index
        .write_tree()
        .context("failed to write staged changes as a git tree")?;
    let tree = repo
        .find_tree(tree_id)
        .context("failed to load staged git tree")?;
    let parent = head_commit(&repo)?;
    if parent
        .as_ref()
        .is_some_and(|parent| parent.tree_id() == tree_id)
        || (parent.is_none() && index.is_empty())
    {
        bail!("there are no staged changes to commit");
    }
    let parents: Vec<&Commit<'_>> = parent.iter().collect();
    let commit_id = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &parents,
        )
        .context("failed to create git commit")?;
    let commit = repo
        .find_commit(commit_id)
        .context("failed to load newly created commit")?;
    Ok(log_entry(&commit))
}

fn head_commit(repo: &git2::Repository) -> Result<Option<Commit<'_>>> {
    match repo.head() {
        Ok(head) => Ok(Some(
            head.peel(ObjectType::Commit)
                .context("failed to resolve HEAD commit")?
                .into_commit()
                .map_err(|_| anyhow::anyhow!("HEAD does not resolve to a commit"))?,
        )),
        Err(error) if matches!(error.code(), ErrorCode::UnbornBranch | ErrorCode::NotFound) => {
            Ok(None)
        }
        Err(error) => Err(error).context("failed to resolve HEAD"),
    }
}

fn is_co_author_trailer(line: &str) -> bool {
    line.trim_start()
        .get(.."co-authored-by:".len())
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("co-authored-by:"))
}
