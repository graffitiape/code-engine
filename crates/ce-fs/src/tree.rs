use anyhow::{Context, Result};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tempfile::Builder as TempFileBuilder;

static NEXT_TRASH_ID: AtomicU64 = AtomicU64::new(1);

/// One filesystem node returned to the frontend.
#[derive(Debug, Clone, Serialize)]
pub struct FsNode {
    pub name: String,
    /// Absolute path on disk.
    pub path: String,
    /// "dir" or "file"
    pub kind: String,
    pub is_symlink: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashEntry {
    pub original_path: String,
    pub trashed_path: String,
}

/// Shallow directory listing of the given absolute path. Includes useful
/// dotfiles while skipping repository internals and generated dependency/build
/// directories.
/// Lazy: returns only direct children, no recursion. Sidebar requests deeper
/// levels via additional calls.
pub fn list_dir<P: AsRef<Path>>(root: P) -> Result<Vec<FsNode>> {
    let root = root.as_ref();
    let read = std::fs::read_dir(root)
        .with_context(|| format!("read_dir failed for {}", root.display()))?;

    let mut nodes: Vec<FsNode> = Vec::new();
    for entry in read.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if should_skip(&name) {
            continue;
        }

        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(_) => continue,
        };

        let is_symlink = file_type.is_symlink();
        let is_dir = if is_symlink {
            entry
                .metadata()
                .map(|metadata| metadata.is_dir())
                .unwrap_or(false)
        } else {
            file_type.is_dir()
        };

        nodes.push(FsNode {
            name,
            path: entry.path().to_string_lossy().to_string(),
            kind: (if is_dir { "dir" } else { "file" }).to_string(),
            is_symlink,
        });
    }

    // Dirs first, then alphabetical (case-insensitive).
    nodes.sort_by(|a, b| match (a.kind == "dir", b.kind == "dir") {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });

    Ok(nodes)
}

fn should_skip(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | "target" | "dist" | ".git" | ".next" | ".turbo" | ".code-engine-trash"
    )
}

/// Read a UTF-8 text file. Returns the path's contents or an error.
pub fn read_text<P: AsRef<Path>>(path: P) -> Result<String> {
    let path = path.as_ref();
    std::fs::read_to_string(path)
        .with_context(|| format!("read_to_string failed for {}", path.display()))
}

/// Atomically write a UTF-8 text file, creating parent directories if needed.
///
/// The temporary file is created beside the destination so persistence is a
/// same-filesystem atomic rename. Existing file permissions are retained.
pub fn write_text<P: AsRef<Path>>(path: P, contents: &str) -> Result<()> {
    atomic_write_text(path, contents)
}

pub fn atomic_write_text<P: AsRef<Path>>(path: P, contents: &str) -> Result<()> {
    atomic_write_text_if_unchanged(path, contents, None)
}

/// Atomically replace a text file after optionally checking that its current
/// contents still match the version the caller edited.
///
/// The comparison happens after the replacement file has been fully written
/// and synced, immediately before the atomic persist. This makes a stale editor
/// save fail instead of silently overwriting a newer on-disk version.
pub fn atomic_write_text_if_unchanged<P: AsRef<Path>>(
    path: P,
    contents: &str,
    expected_contents: Option<&str>,
) -> Result<()> {
    let path = path.as_ref();
    let parent = usable_parent(path);
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create parent directory for {}", path.display()))?;

    let mut temporary = TempFileBuilder::new()
        .prefix(".code-engine-")
        .suffix(".tmp")
        .tempfile_in(parent)
        .with_context(|| format!("failed to create temporary file for {}", path.display()))?;

    if let Ok(metadata) = std::fs::metadata(path) {
        temporary
            .as_file()
            .set_permissions(metadata.permissions())
            .with_context(|| format!("failed to preserve permissions for {}", path.display()))?;
    }

    temporary
        .write_all(contents.as_bytes())
        .with_context(|| format!("failed to write temporary file for {}", path.display()))?;
    temporary
        .as_file()
        .sync_all()
        .with_context(|| format!("failed to sync temporary file for {}", path.display()))?;

    if let Some(expected_contents) = expected_contents {
        let current_contents = std::fs::read_to_string(path).with_context(|| {
            format!(
                "file changed on disk before save; failed to read current contents of {}",
                path.display()
            )
        })?;
        if current_contents != expected_contents {
            anyhow::bail!(
                "file changed on disk before save; refusing to overwrite {}",
                path.display()
            );
        }
    }

    temporary
        .persist(path)
        .map_err(|error| error.error)
        .with_context(|| format!("failed to atomically replace {}", path.display()))?;

    #[cfg(unix)]
    std::fs::File::open(parent)
        .and_then(|directory| directory.sync_all())
        .with_context(|| format!("failed to sync parent directory for {}", path.display()))?;

    Ok(())
}

/// Create a new file without replacing an existing path.
pub fn create_file<P: AsRef<Path>>(path: P, contents: &str) -> Result<()> {
    let path = path.as_ref();
    let parent = usable_parent(path);
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create parent directory for {}", path.display()))?;
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .with_context(|| format!("failed to create file {}", path.display()))?;
    file.write_all(contents.as_bytes())
        .with_context(|| format!("failed to write new file {}", path.display()))?;
    file.sync_all()
        .with_context(|| format!("failed to sync new file {}", path.display()))?;
    Ok(())
}

/// Create one new directory. Parent directories are created as needed, while
/// an existing destination remains an error.
pub fn create_directory<P: AsRef<Path>>(path: P) -> Result<()> {
    let path = path.as_ref();
    let parent = usable_parent(path);
    std::fs::create_dir_all(parent)
        .with_context(|| format!("failed to create parent directory for {}", path.display()))?;
    std::fs::create_dir(path)
        .with_context(|| format!("failed to create directory {}", path.display()))
}

/// Rename a file or directory without overwriting the destination.
pub fn rename_path<P: AsRef<Path>, Q: AsRef<Path>>(source: P, destination: Q) -> Result<()> {
    let source = source.as_ref();
    let destination = destination.as_ref();
    if !path_entry_exists(source)
        .with_context(|| format!("failed to inspect source {}", source.display()))?
    {
        anyhow::bail!("source does not exist: {}", source.display());
    }
    if path_entry_exists(destination)
        .with_context(|| format!("failed to inspect destination {}", destination.display()))?
    {
        anyhow::bail!("destination already exists: {}", destination.display());
    }
    std::fs::create_dir_all(usable_parent(destination)).with_context(|| {
        format!(
            "failed to create destination parent for {}",
            destination.display()
        )
    })?;
    std::fs::rename(source, destination).with_context(|| {
        format!(
            "failed to rename {} to {}",
            source.display(),
            destination.display()
        )
    })
}

/// Move a path into an application-managed trash directory. The move is a
/// rename and therefore never falls back to copy-then-delete across filesystems.
/// A manifest is retained so the item remains recoverable across app restarts.
pub fn move_to_trash<P: AsRef<Path>, Q: AsRef<Path>>(path: P, trash_root: Q) -> Result<TrashEntry> {
    // Resolve only the parent. Resolving the full path would follow a symlink
    // and trash its target instead of the symlink itself.
    let original = absolute_entry_path(path.as_ref())?;
    if !path_entry_exists(&original)
        .with_context(|| format!("failed to inspect {}", original.display()))?
    {
        anyhow::bail!("path does not exist: {}", original.display());
    }
    let trash_root = trash_root.as_ref();
    std::fs::create_dir_all(trash_root)
        .with_context(|| format!("failed to create trash directory {}", trash_root.display()))?;
    let trash_root = trash_root
        .canonicalize()
        .with_context(|| format!("failed to resolve trash directory {}", trash_root.display()))?;
    if original.starts_with(&trash_root) {
        anyhow::bail!("cannot trash a path already inside the trash directory");
    }

    let entry_dir = unique_trash_entry_dir(&trash_root, &original);
    std::fs::create_dir(&entry_dir)
        .with_context(|| format!("failed to create trash entry {}", entry_dir.display()))?;
    let trashed_path = entry_dir.join("payload");
    let entry = TrashEntry {
        original_path: original.to_string_lossy().to_string(),
        trashed_path: trashed_path.to_string_lossy().to_string(),
    };
    let manifest = serde_json::to_string_pretty(&entry).context("failed to encode trash entry")?;
    atomic_write_text(entry_dir.join("entry.json"), &manifest)?;

    if let Err(error) = std::fs::rename(&original, &trashed_path) {
        let _ = std::fs::remove_dir_all(&entry_dir);
        return Err(error).with_context(|| {
            format!(
                "failed to move {} into recoverable trash {}",
                original.display(),
                trashed_path.display()
            )
        });
    }
    Ok(entry)
}

pub fn list_trash<P: AsRef<Path>>(trash_root: P) -> Result<Vec<TrashEntry>> {
    let trash_root = trash_root.as_ref();
    if !trash_root.exists() {
        return Ok(Vec::new());
    }

    let mut entries = Vec::new();
    for directory in std::fs::read_dir(trash_root)
        .with_context(|| format!("failed to read trash directory {}", trash_root.display()))?
    {
        let Ok(directory) = directory else {
            continue;
        };
        let manifest_path = directory.path().join("entry.json");
        let Ok(manifest) = std::fs::read_to_string(&manifest_path) else {
            continue;
        };
        let Ok(entry) = serde_json::from_str::<TrashEntry>(&manifest) else {
            continue;
        };
        if path_entry_exists(Path::new(&entry.trashed_path)).unwrap_or(false) {
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| a.original_path.cmp(&b.original_path));
    Ok(entries)
}

pub fn restore_from_trash(entry: &TrashEntry) -> Result<()> {
    let trashed_path = PathBuf::from(&entry.trashed_path);
    let original_path = PathBuf::from(&entry.original_path);
    let entry_dir = trashed_path
        .parent()
        .context("invalid trash entry: payload has no parent directory")?;
    if trashed_path.file_name().and_then(|name| name.to_str()) != Some("payload") {
        anyhow::bail!("invalid trash entry: expected a payload path");
    }
    let manifest_path = entry_dir.join("entry.json");
    let manifest: TrashEntry =
        serde_json::from_str(&std::fs::read_to_string(&manifest_path).with_context(|| {
            format!("failed to read trash manifest {}", manifest_path.display())
        })?)
        .with_context(|| format!("invalid trash manifest {}", manifest_path.display()))?;
    if manifest != *entry {
        anyhow::bail!("trash entry does not match its recovery manifest");
    }

    if !path_entry_exists(&trashed_path)
        .with_context(|| format!("failed to inspect {}", trashed_path.display()))?
    {
        anyhow::bail!("trashed item does not exist: {}", trashed_path.display());
    }
    if path_entry_exists(&original_path)
        .with_context(|| format!("failed to inspect {}", original_path.display()))?
    {
        anyhow::bail!(
            "cannot restore because the original path already exists: {}",
            original_path.display()
        );
    }
    std::fs::create_dir_all(usable_parent(&original_path)).with_context(|| {
        format!(
            "failed to create restore parent for {}",
            original_path.display()
        )
    })?;
    std::fs::rename(&trashed_path, &original_path).with_context(|| {
        format!(
            "failed to restore {} to {}",
            trashed_path.display(),
            original_path.display()
        )
    })?;
    std::fs::remove_dir_all(entry_dir).with_context(|| {
        format!(
            "failed to remove restored trash entry {}",
            entry_dir.display()
        )
    })?;
    Ok(())
}

/// Recursively walk the workspace honoring `.gitignore` etc., returning
/// absolute paths to every file (capped at `max`). Used by the command
/// palette and quick-open.
pub fn walk_workspace<P: AsRef<Path>>(root: P, max: usize) -> Result<Vec<String>> {
    if max == 0 {
        return Ok(Vec::new());
    }
    let root = root.as_ref();
    let mut out: Vec<String> = Vec::new();
    let walker = workspace_walk_builder(root).build();

    for entry in walker.flatten() {
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            out.push(entry.path().to_string_lossy().to_string());
            if out.len() >= max {
                break;
            }
        }
    }
    Ok(out)
}

pub(crate) fn workspace_walk_builder(root: &Path) -> WalkBuilder {
    let mut builder = WalkBuilder::new(root);
    builder
        .standard_filters(true)
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .follow_links(false)
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let is_dir = entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false);
            !is_dir || !should_skip(&entry.file_name().to_string_lossy())
        });
    builder
}

fn usable_parent(path: &Path) -> &Path {
    path.parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."))
}

fn path_entry_exists(path: &Path) -> std::io::Result<bool> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

fn absolute_entry_path(path: &Path) -> Result<PathBuf> {
    let file_name = path
        .file_name()
        .context("cannot move a filesystem root into trash")?;
    let parent = usable_parent(path)
        .canonicalize()
        .with_context(|| format!("failed to resolve parent of {}", path.display()))?;
    Ok(parent.join(file_name))
}

fn unique_trash_entry_dir(trash_root: &Path, original: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let id = NEXT_TRASH_ID.fetch_add(1, Ordering::Relaxed);
    let label = original
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("item")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .take(64)
        .collect::<String>();
    trash_root.join(format!("{timestamp}-{id}-{label}"))
}

#[cfg(test)]
pub(crate) struct TestDir {
    path: PathBuf,
}

#[cfg(test)]
impl TestDir {
    pub(crate) fn new(label: &str) -> Self {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT_ID: AtomicU64 = AtomicU64::new(1);

        let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "code-engine-ce-fs-{label}-{}-{id}",
            std::process::id()
        ));
        std::fs::create_dir_all(&path).expect("create temporary test directory");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }
}

#[cfg(test)]
impl Drop for TestDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn list_dir_includes_dotfiles_and_marks_symlinks() {
        let test_dir = TestDir::new("list-dir");
        std::fs::write(test_dir.path().join(".gitignore"), "target\n").unwrap();
        std::fs::create_dir(test_dir.path().join("target")).unwrap();
        std::fs::write(test_dir.path().join("visible.txt"), "visible").unwrap();

        #[cfg(unix)]
        std::os::unix::fs::symlink(
            test_dir.path().join("visible.txt"),
            test_dir.path().join("visible-link"),
        )
        .unwrap();

        let nodes = list_dir(test_dir.path()).unwrap();
        assert!(nodes.iter().any(|node| node.name == ".gitignore"));
        assert!(!nodes.iter().any(|node| node.name == "target"));
        #[cfg(unix)]
        assert!(nodes
            .iter()
            .any(|node| node.name == "visible-link" && node.is_symlink));
    }

    #[test]
    fn atomic_write_replaces_contents_without_leaving_temporary_files() {
        let test_dir = TestDir::new("atomic-write");
        let path = test_dir.path().join("nested").join("file.txt");
        write_text(&path, "before").unwrap();
        write_text(&path, "after").unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "after");
        let parent = path.parent().unwrap();
        assert!(std::fs::read_dir(parent).unwrap().all(|entry| !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".code-engine-")));
    }

    #[test]
    fn checked_atomic_write_rejects_stale_expected_contents() {
        let test_dir = TestDir::new("checked-atomic-write");
        let path = test_dir.path().join("file.txt");
        write_text(&path, "opened version").unwrap();

        atomic_write_text_if_unchanged(&path, "first save", Some("opened version")).unwrap();
        std::fs::write(&path, "external version").unwrap();

        let error =
            atomic_write_text_if_unchanged(&path, "stale save", Some("first save")).unwrap_err();
        assert!(error.to_string().contains("file changed on disk"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "external version");
    }

    #[test]
    fn create_rename_trash_and_restore_are_recoverable() {
        let test_dir = TestDir::new("file-operations");
        let directory = test_dir.path().join("project").join("nested");
        create_directory(&directory).unwrap();
        assert!(directory.is_dir());
        assert!(create_directory(&directory).is_err());

        let original = directory.join("draft.txt");
        create_file(&original, "draft").unwrap();
        assert!(create_file(&original, "overwrite").is_err());
        assert_eq!(std::fs::read_to_string(&original).unwrap(), "draft");

        let renamed = directory.join("ready.txt");
        rename_path(&original, &renamed).unwrap();
        assert!(!original.exists());
        assert_eq!(std::fs::read_to_string(&renamed).unwrap(), "draft");

        let trash_root = test_dir.path().join("trash");
        let entry = move_to_trash(&renamed, &trash_root).unwrap();
        assert!(!renamed.exists());
        assert!(Path::new(&entry.trashed_path).exists());
        assert_eq!(list_trash(&trash_root).unwrap(), vec![entry.clone()]);

        restore_from_trash(&entry).unwrap();
        assert_eq!(std::fs::read_to_string(&renamed).unwrap(), "draft");
        assert!(list_trash(&trash_root).unwrap().is_empty());
    }

    #[test]
    fn trash_restore_validates_manifest_and_preserves_symlinks() {
        let test_dir = TestDir::new("safe-trash");
        let trash_root = test_dir.path().join("trash");

        #[cfg(unix)]
        {
            let link = test_dir.path().join("dangling-link");
            std::os::unix::fs::symlink("missing-target", &link).unwrap();
            let entry = move_to_trash(&link, &trash_root).unwrap();
            assert!(std::fs::symlink_metadata(&entry.trashed_path)
                .unwrap()
                .file_type()
                .is_symlink());

            let mut tampered = entry.clone();
            tampered.original_path = test_dir.path().join("different").display().to_string();
            assert!(restore_from_trash(&tampered).is_err());
            assert!(std::fs::symlink_metadata(&entry.trashed_path).is_ok());

            restore_from_trash(&entry).unwrap();
            assert!(std::fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink());
        }
    }

    #[test]
    fn workspace_walk_respects_a_zero_result_cap() {
        let test_dir = TestDir::new("zero-walk");
        std::fs::write(test_dir.path().join("visible.txt"), "visible").unwrap();
        assert!(walk_workspace(test_dir.path(), 0).unwrap().is_empty());
    }

    #[test]
    fn workspace_walk_and_directory_listing_hide_recovery_trash() {
        let test_dir = TestDir::new("hidden-recovery-trash");
        let trash = test_dir.path().join(".code-engine-trash").join("entry");
        std::fs::create_dir_all(&trash).unwrap();
        std::fs::write(trash.join("payload"), "recover me").unwrap();
        std::fs::write(test_dir.path().join("visible.txt"), "visible").unwrap();

        let listed = list_dir(test_dir.path()).unwrap();
        assert!(!listed.iter().any(|node| node.name == ".code-engine-trash"));

        let walked = walk_workspace(test_dir.path(), 100).unwrap();
        assert_eq!(walked.len(), 1);
        assert!(walked[0].ends_with("visible.txt"));
    }
}
