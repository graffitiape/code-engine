use ce_git::{
    branches, checkout_branch, commit as create_commit, recent_log, stage_all, stage_file, stash,
    status, unified_diff, unstage_all, unstage_file, GitDiffKind,
};
use git2::{BranchType, Repository};
use std::fs;
use std::path::{Path, PathBuf};
use tempfile::TempDir;

struct TestRepo {
    root: TempDir,
}

impl TestRepo {
    fn new() -> Self {
        let root = tempfile::tempdir().expect("temp repository");
        let repo = Repository::init(root.path()).expect("initialize repository");
        repo.set_head("refs/heads/main")
            .expect("select main branch");
        let mut config = repo.config().expect("repository config");
        config
            .set_str("user.name", "Code Engine Test")
            .expect("configure name");
        config
            .set_str("user.email", "code-engine@example.test")
            .expect("configure email");
        drop(config);
        drop(repo);
        Self { root }
    }

    fn path(&self) -> &Path {
        self.root.path()
    }

    fn repo(&self) -> Repository {
        Repository::open(self.path()).expect("open repository")
    }

    fn write(&self, path: &str, contents: impl AsRef<[u8]>) {
        let path = self.path().join(path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create file parent");
        }
        fs::write(path, contents).expect("write repository file");
    }

    fn initial_commit(&self) {
        self.write("src/main.rs", "fn main() {}\n");
        stage_all(self.path()).expect("stage initial files");
        create_commit(self.path(), "Initial commit").expect("initial commit");
    }
}

fn paths(items: &[ce_git::GitFileStatus]) -> Vec<&str> {
    items.iter().map(|item| item.path.as_str()).collect()
}

#[test]
fn git_operations_require_the_selected_workspace_to_be_the_repo_root() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    let error = status(fixture.path().join("src")).unwrap_err();
    assert!(error.to_string().contains("repository root"));
}

#[test]
fn diffs_and_staging_cover_tracked_untracked_hidden_and_deleted_files() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    fixture.write("src/main.rs", "fn main() { println!(\"changed\"); }\n");
    fixture.write("notes.txt", "untracked content\n");

    let unstaged =
        unified_diff(fixture.path(), None, GitDiffKind::Unstaged, None).expect("unstaged diff");
    assert!(unstaged.patch.contains("src/main.rs"));
    assert!(!unstaged.patch.contains("notes.txt"));
    let untracked =
        unified_diff(fixture.path(), None, GitDiffKind::Untracked, None).expect("untracked diff");
    assert!(untracked.patch.contains("notes.txt"));
    assert!(!untracked.patch.contains("src/main.rs"));

    let snapshot = stage_file(fixture.path(), "src/main.rs").expect("stage tracked file");
    assert_eq!(paths(&snapshot.staged), ["src/main.rs"]);
    let staged = unified_diff(
        fixture.path(),
        Some("src/main.rs"),
        GitDiffKind::Staged,
        None,
    )
    .expect("staged diff");
    assert!(staged.patch.contains("changed"));

    let snapshot = unstage_file(fixture.path(), "src/main.rs").expect("unstage tracked file");
    assert!(snapshot.staged.is_empty());
    assert_eq!(paths(&snapshot.unstaged), ["src/main.rs"]);

    fixture.write(".env.example", "KEY=value\n");
    fs::remove_file(fixture.path().join("src/main.rs")).expect("delete tracked file");
    let snapshot = stage_all(fixture.path()).expect("stage every change");
    assert!(paths(&snapshot.staged).contains(&".env.example"));
    assert!(snapshot
        .staged
        .iter()
        .any(|item| item.path == "src/main.rs" && item.kind == "deleted"));

    let snapshot = unstage_all(fixture.path()).expect("unstage every change");
    assert!(snapshot.staged.is_empty());
    assert!(paths(&snapshot.untracked).contains(&".env.example"));
    assert!(paths(&snapshot.untracked).contains(&"notes.txt"));
}

#[test]
fn commit_uses_configured_identity_preserves_message_and_never_adds_coauthor() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    fixture.write("README.md", "# Test\n");
    stage_file(fixture.path(), "README.md").expect("stage readme");
    let message = "Add documentation\n\nDescribe the project.";
    let entry = create_commit(fixture.path(), message).expect("create commit");

    assert_eq!(entry.message, message);
    assert_eq!(entry.author_name, "Code Engine Test");
    assert_eq!(entry.author_email, "code-engine@example.test");
    assert!(!entry
        .message
        .to_ascii_lowercase()
        .contains("co-authored-by:"));
    assert_eq!(recent_log(fixture.path(), Some(1)).unwrap(), [entry]);

    fixture.write("README.md", "# Changed\n");
    stage_file(fixture.path(), "README.md").unwrap();
    let error = create_commit(
        fixture.path(),
        "Bad message\n\nCo-Authored-By: Someone <person@example.test>",
    )
    .unwrap_err();
    assert!(error.to_string().contains("Co-Authored-By"));
}

#[test]
fn branch_checkout_is_safe_and_rejects_a_dirty_worktree() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    let repo = fixture.repo();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    repo.branch("feature", &head, false).expect("create branch");
    drop(head);
    drop(repo);

    let selected = checkout_branch(fixture.path(), "feature").expect("checkout feature");
    assert!(selected.current);
    assert_eq!(selected.name, "feature");
    let listed = branches(fixture.path()).expect("list branches");
    assert!(listed.iter().any(|branch| branch.name == "main"));
    assert!(listed
        .iter()
        .any(|branch| branch.name == "feature" && branch.current));

    fixture.write("src/main.rs", "dirty\n");
    let error = checkout_branch(fixture.path(), "main").unwrap_err();
    assert!(error.to_string().contains("uncommitted changes"));
    assert!(fixture
        .repo()
        .find_branch("feature", BranchType::Local)
        .unwrap()
        .is_head());
}

#[test]
fn stash_includes_untracked_files_and_path_escape_is_rejected() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    fixture.write("src/main.rs", "changed\n");
    fixture.write("scratch.txt", "temporary\n");

    let result = stash(fixture.path(), Some("Work in progress")).expect("stash changes");
    assert_eq!(result.message, "Work in progress");
    assert!(result.status.staged.is_empty());
    assert!(result.status.unstaged.is_empty());
    assert!(result.status.untracked.is_empty());
    assert!(!fixture.path().join("scratch.txt").exists());
    assert_eq!(
        fs::read_to_string(fixture.path().join("src/main.rs")).unwrap(),
        "fn main() {}\n"
    );
    assert!(fixture
        .repo()
        .find_commit(result.id.parse().unwrap())
        .is_ok());

    let outside = PathBuf::from("..").join("outside.txt");
    let error = stage_file(fixture.path(), outside).unwrap_err();
    assert!(error.to_string().contains("inside the repository"));
}

#[test]
fn recovery_trash_is_hidden_never_staged_or_stashed_and_cannot_be_committed() {
    let fixture = TestRepo::new();
    fixture.initial_commit();
    fixture.write(
        ".code-engine-trash/recovery-1/payload",
        "recoverable contents\n",
    );
    fixture.write("scratch.txt", "temporary\n");

    let snapshot = status(fixture.path()).expect("status hides recovery trash");
    assert_eq!(paths(&snapshot.untracked), ["scratch.txt"]);
    let diff = unified_diff(fixture.path(), None, GitDiffKind::Untracked, None)
        .expect("diff hides recovery trash");
    assert!(!diff.patch.contains(".code-engine-trash"));

    stage_all(fixture.path()).expect("stage normal changes only");
    let repo = fixture.repo();
    let index = repo.index().unwrap();
    assert!(index.get_path(Path::new("scratch.txt"), 0).is_some());
    assert!(index
        .get_path(Path::new(".code-engine-trash/recovery-1/payload"), 0)
        .is_none());
    drop(index);
    drop(repo);

    unstage_all(fixture.path()).expect("unstage normal changes");
    stash(fixture.path(), Some("Keep recovery data local")).expect("stash normal changes");
    assert!(!fixture.path().join("scratch.txt").exists());
    assert_eq!(
        fs::read_to_string(fixture.path().join(".code-engine-trash/recovery-1/payload")).unwrap(),
        "recoverable contents\n"
    );

    let repo = fixture.repo();
    let mut index = repo.index().unwrap();
    index
        .add_path(Path::new(".code-engine-trash/recovery-1/payload"))
        .unwrap();
    index.write().unwrap();
    drop(index);
    drop(repo);
    let error = create_commit(fixture.path(), "Do not commit recovery payload").unwrap_err();
    assert!(error.to_string().contains("recovery trash"));
}
