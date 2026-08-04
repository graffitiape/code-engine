use std::ffi::OsString;
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};

use ce_fs::{FsNode, TrashEntry};
use tauri::State;

use crate::state::AppState;

const WORKSPACE_TRASH_DIRECTORY: &str = ".code-engine-trash";
const DEFAULT_FILE_LIST_LIMIT: usize = 20_000;

/// Set the active workspace root after resolving symlinks and verifying that
/// the selected path is a directory. The canonical path is returned so the UI
/// and every subsequent command share one security boundary.
#[tauri::command]
pub async fn set_workspace_root(
    state: State<'_, AppState>,
    path: String,
) -> Result<String, String> {
    let canonical = blocking_io(move || canonical_workspace_root(Path::new(&path))).await?;
    let canonical = path_to_string(&canonical)?;
    *state.workspace_root.lock().await = Some(canonical.clone());
    Ok(canonical)
}

/// Return the canonical active workspace root, if one is selected.
#[tauri::command]
pub async fn get_workspace_root(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let Some(stored) = state.workspace_root.lock().await.clone() else {
        return Ok(None);
    };
    let canonical = blocking_io(move || canonical_workspace_root(Path::new(&stored))).await?;
    Ok(Some(path_to_string(&canonical)?))
}

/// Shallow read of a directory inside the active workspace.
#[tauri::command]
pub async fn read_dir(state: State<'_, AppState>, path: String) -> Result<Vec<FsNode>, String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || read_dir_scoped(&root, &path)).await
}

/// Read a UTF-8 text file inside the active workspace.
#[tauri::command]
pub async fn read_file_text(state: State<'_, AppState>, path: String) -> Result<String, String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || read_file_text_scoped(&root, &path)).await
}

/// Atomically write a UTF-8 text file inside the active workspace.
#[tauri::command]
pub async fn write_file_text(
    state: State<'_, AppState>,
    path: String,
    contents: String,
    expected_contents: Option<String>,
) -> Result<(), String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || {
        write_file_text_scoped(&root, &path, &contents, expected_contents.as_deref())
    })
    .await
}

/// Recursively list non-ignored files below a path inside the active workspace.
#[tauri::command]
pub async fn list_workspace_files(
    state: State<'_, AppState>,
    path: String,
    max: Option<usize>,
) -> Result<Vec<String>, String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || {
        list_workspace_files_scoped(&root, &path, max.unwrap_or(DEFAULT_FILE_LIST_LIMIT))
    })
    .await
}

/// Create a new file without replacing an existing path.
#[tauri::command]
pub async fn create_file(
    state: State<'_, AppState>,
    path: String,
    contents: Option<String>,
) -> Result<(), String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || create_file_scoped(&root, &path, contents.as_deref().unwrap_or_default()))
        .await
}

/// Create a new directory, including missing parents inside the workspace.
#[tauri::command]
pub async fn create_directory(state: State<'_, AppState>, path: String) -> Result<(), String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || create_directory_scoped(&root, &path)).await
}

/// Rename a file, directory, or symlink without replacing the destination.
#[tauri::command]
pub async fn rename_path(
    state: State<'_, AppState>,
    source: String,
    destination: String,
) -> Result<(), String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || rename_path_scoped(&root, &source, &destination)).await
}

/// Move a workspace entry into recoverable, application-managed trash.
#[tauri::command]
pub async fn trash_path(state: State<'_, AppState>, path: String) -> Result<TrashEntry, String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || trash_path_scoped(&root, &path)).await
}

/// List recoverable trash entries belonging to the active workspace.
#[tauri::command]
pub async fn list_trash(state: State<'_, AppState>) -> Result<Vec<TrashEntry>, String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || list_trash_scoped(&root)).await
}

/// Restore an entry only when it matches the on-disk recovery manifest and its
/// original destination is still inside the active workspace.
#[tauri::command]
pub async fn restore_from_trash(
    state: State<'_, AppState>,
    entry: TrashEntry,
) -> Result<(), String> {
    let root = active_workspace_root(&state).await?;
    blocking_io(move || restore_from_trash_scoped(&root, &entry)).await
}

pub(crate) async fn active_workspace_root(state: &AppState) -> Result<PathBuf, String> {
    let stored = state
        .workspace_root
        .lock()
        .await
        .clone()
        .ok_or_else(|| "no active workspace root is selected".to_string())?;
    blocking_io(move || canonical_workspace_root(Path::new(&stored))).await
}

/// Resolve a caller-provided project root and require it to be exactly the
/// active workspace. Search and Git commands use this to avoid accepting an
/// arbitrary filesystem root from webview input.
pub(crate) async fn require_active_workspace_root(
    state: &AppState,
    requested: &str,
) -> Result<PathBuf, String> {
    let active = active_workspace_root(state).await?;
    let requested = PathBuf::from(requested);
    let canonical = blocking_io(move || canonical_workspace_root(&requested)).await?;
    if canonical != active {
        return Err("requested project is not the active workspace".to_string());
    }
    Ok(active)
}

async fn blocking_io<T, F>(operation: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|error| format!("workspace task failed: {error}"))?
}

fn canonical_workspace_root(path: &Path) -> Result<PathBuf, String> {
    let canonical = path
        .canonicalize()
        .map_err(|error| format!("failed to resolve workspace {}: {error}", path.display()))?;
    if !canonical.is_dir() {
        return Err(format!(
            "workspace root is not a directory: {}",
            canonical.display()
        ));
    }
    path_to_string(&canonical)?;
    Ok(canonical)
}

fn read_dir_scoped(root: &Path, path: &str) -> Result<Vec<FsNode>, String> {
    let directory = resolve_user_path(root, path, true, true)?;
    let mut nodes = ce_fs::list_dir(&directory).map_err(|error| error.to_string())?;
    nodes.retain(|node| resolve_user_path(root, &node.path, true, true).is_ok());
    Ok(nodes)
}

fn read_file_text_scoped(root: &Path, path: &str) -> Result<String, String> {
    let path = resolve_user_path(root, path, true, true)?;
    ce_fs::tree::read_text(path).map_err(|error| error.to_string())
}

fn write_file_text_scoped(
    root: &Path,
    path: &str,
    contents: &str,
    expected_contents: Option<&str>,
) -> Result<(), String> {
    let path = resolve_user_path(root, path, true, false)?;
    ce_fs::atomic_write_text_if_unchanged(path, contents, expected_contents)
        .map_err(|error| error.to_string())
}

fn list_workspace_files_scoped(root: &Path, path: &str, max: usize) -> Result<Vec<String>, String> {
    let path = resolve_user_path(root, path, true, true)?;
    let trash_root = workspace_trash_path(root);
    let mut files = ce_fs::walk_workspace(path, max).map_err(|error| error.to_string())?;
    files.retain(|file| {
        let path = Path::new(file);
        path.starts_with(root) && !path.starts_with(&trash_root)
    });
    Ok(files)
}

fn create_file_scoped(root: &Path, path: &str, contents: &str) -> Result<(), String> {
    let path = resolve_user_path(root, path, true, false)?;
    ce_fs::create_file(path, contents).map_err(|error| error.to_string())
}

fn create_directory_scoped(root: &Path, path: &str) -> Result<(), String> {
    let path = resolve_user_path(root, path, true, false)?;
    ce_fs::create_directory(path).map_err(|error| error.to_string())
}

fn rename_path_scoped(root: &Path, source: &str, destination: &str) -> Result<(), String> {
    let source = resolve_user_path(root, source, false, false)?;
    require_existing_entry(&source)?;
    let destination = resolve_user_path(root, destination, false, false)?;
    ce_fs::rename_path(source, destination).map_err(|error| error.to_string())
}

fn trash_path_scoped(root: &Path, path: &str) -> Result<TrashEntry, String> {
    let path = resolve_user_path(root, path, false, false)?;
    require_existing_entry(&path)?;
    let trash_root = writable_trash_root(root)?;
    ce_fs::move_to_trash(path, trash_root).map_err(|error| error.to_string())
}

fn list_trash_scoped(root: &Path) -> Result<Vec<TrashEntry>, String> {
    let Some(trash_root) = existing_trash_root(root)? else {
        return Ok(Vec::new());
    };
    let entries = ce_fs::list_trash(&trash_root).map_err(|error| error.to_string())?;
    Ok(entries
        .into_iter()
        .filter(|entry| validate_trash_entry(root, &trash_root, entry).is_ok())
        .collect())
}

fn restore_from_trash_scoped(root: &Path, entry: &TrashEntry) -> Result<(), String> {
    let trash_root = existing_trash_root(root)?
        .ok_or_else(|| "the active workspace has no recoverable trash".to_string())?;
    validate_trash_entry(root, &trash_root, entry)?;
    ce_fs::restore_from_trash(entry).map_err(|error| error.to_string())
}

fn resolve_user_path(
    root: &Path,
    input: &str,
    follow_final_symlink: bool,
    allow_root: bool,
) -> Result<PathBuf, String> {
    let resolved = resolve_path_within(root, Path::new(input), follow_final_symlink)?;
    if !allow_root && resolved == root {
        return Err("the workspace root itself cannot be modified".to_string());
    }
    if resolved.starts_with(workspace_trash_path(root)) {
        return Err("the workspace trash is reserved for recovery operations".to_string());
    }
    Ok(resolved)
}

fn resolve_path_within(
    root: &Path,
    input: &Path,
    follow_final_symlink: bool,
) -> Result<PathBuf, String> {
    let candidate = if input.is_absolute() {
        normalize_absolute(input)?
    } else {
        normalize_absolute(&root.join(input))?
    };

    let resolved = if follow_final_symlink {
        resolve_from_existing_ancestor(&candidate)?
    } else {
        let name = candidate
            .file_name()
            .ok_or_else(|| format!("path has no workspace entry name: {}", candidate.display()))?;
        let parent = candidate
            .parent()
            .ok_or_else(|| format!("path has no parent: {}", candidate.display()))?;
        resolve_from_existing_ancestor(parent)?.join(name)
    };

    if !resolved.starts_with(root) {
        return Err(format!(
            "path escapes the active workspace: {}",
            input.display()
        ));
    }
    Ok(resolved)
}

fn normalize_absolute(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err(format!("path is not absolute: {}", path.display()));
    }

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(_) | Component::RootDir | Component::Normal(_) => {
                normalized.push(component.as_os_str());
            }
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(format!(
                        "path escapes the filesystem root: {}",
                        path.display()
                    ));
                }
            }
        }
    }
    Ok(normalized)
}

fn resolve_from_existing_ancestor(path: &Path) -> Result<PathBuf, String> {
    let mut existing = path.to_path_buf();
    let mut missing: Vec<OsString> = Vec::new();

    loop {
        match std::fs::symlink_metadata(&existing) {
            Ok(_) => {
                let mut resolved = existing.canonicalize().map_err(|error| {
                    format!("failed to resolve path {}: {error}", existing.display())
                })?;
                for component in missing.iter().rev() {
                    resolved.push(component);
                }
                return Ok(resolved);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                let name = existing
                    .file_name()
                    .ok_or_else(|| format!("path has no existing ancestor: {}", path.display()))?;
                missing.push(name.to_os_string());
                if !existing.pop() {
                    return Err(format!("path has no existing ancestor: {}", path.display()));
                }
            }
            Err(error) => {
                return Err(format!(
                    "failed to inspect path {}: {error}",
                    existing.display()
                ));
            }
        }
    }
}

fn require_existing_entry(path: &Path) -> Result<(), String> {
    std::fs::symlink_metadata(path)
        .map(|_| ())
        .map_err(|error| {
            format!(
                "workspace entry does not exist at {}: {error}",
                path.display()
            )
        })
}

fn workspace_trash_path(root: &Path) -> PathBuf {
    root.join(WORKSPACE_TRASH_DIRECTORY)
}

fn writable_trash_root(root: &Path) -> Result<PathBuf, String> {
    let trash_root = workspace_trash_path(root);
    match std::fs::symlink_metadata(&trash_root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => Ok(trash_root),
        Ok(_) => Err("workspace trash path is not a private directory".to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(trash_root),
        Err(error) => Err(format!("failed to inspect workspace trash: {error}")),
    }
}

fn existing_trash_root(root: &Path) -> Result<Option<PathBuf>, String> {
    let trash_root = workspace_trash_path(root);
    match std::fs::symlink_metadata(&trash_root) {
        Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {
            let canonical = trash_root
                .canonicalize()
                .map_err(|error| format!("failed to resolve workspace trash: {error}"))?;
            if canonical.starts_with(root) {
                Ok(Some(canonical))
            } else {
                Err("workspace trash escapes the active workspace".to_string())
            }
        }
        Ok(_) => Err("workspace trash path is not a private directory".to_string()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("failed to inspect workspace trash: {error}")),
    }
}

fn validate_trash_entry(root: &Path, trash_root: &Path, entry: &TrashEntry) -> Result<(), String> {
    let original_input = Path::new(&entry.original_path);
    let trashed_input = Path::new(&entry.trashed_path);
    if !original_input.is_absolute() || !trashed_input.is_absolute() {
        return Err("trash recovery paths must be absolute".to_string());
    }

    let original = resolve_path_within(root, original_input, false)?;
    if original == root || original.starts_with(workspace_trash_path(root)) {
        return Err("trash entry has an invalid original workspace path".to_string());
    }
    if normalize_absolute(original_input)? != original {
        return Err("trash entry original path is not canonical".to_string());
    }

    let payload = resolve_path_within(trash_root, trashed_input, false)?;
    if normalize_absolute(trashed_input)? != payload
        || payload.file_name().and_then(|name| name.to_str()) != Some("payload")
        || payload
            .parent()
            .and_then(Path::parent)
            .is_none_or(|parent| parent != trash_root)
    {
        return Err("trash entry payload path is invalid".to_string());
    }
    Ok(())
}

fn path_to_string(path: &Path) -> Result<String, String> {
    path.to_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("path is not valid UTF-8: {}", path.display()))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};

    use ce_fs::TrashEntry;
    use uuid::Uuid;

    use super::{
        canonical_workspace_root, create_directory_scoped, create_file_scoped, list_trash_scoped,
        read_dir_scoped, read_file_text_scoped, rename_path_scoped, restore_from_trash_scoped,
        trash_path_scoped, write_file_text_scoped, WORKSPACE_TRASH_DIRECTORY,
    };

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("code-engine-workspace-test-{}", Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }

        fn path(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn canonical_root_requires_an_existing_directory() {
        let test_dir = TestDir::new();
        let root = test_dir.path().join("root");
        fs::create_dir(&root).unwrap();
        assert_eq!(
            canonical_workspace_root(&root).unwrap(),
            root.canonicalize().unwrap()
        );

        let file = test_dir.path().join("file.txt");
        fs::write(&file, "content").unwrap();
        assert!(canonical_workspace_root(&file).is_err());
        assert!(canonical_workspace_root(&test_dir.path().join("missing")).is_err());
    }

    #[test]
    fn scoped_crud_trash_and_restore_are_recoverable() {
        let test_dir = TestDir::new();
        let root = canonical_workspace_root(test_dir.path()).unwrap();

        create_file_scoped(&root, "src/main.rs", "fn main() {}").unwrap();
        create_directory_scoped(&root, "notes").unwrap();
        write_file_text_scoped(&root, "notes/todo.md", "ship it", None).unwrap();
        rename_path_scoped(&root, "notes/todo.md", "notes/done.md").unwrap();
        assert_eq!(
            read_file_text_scoped(&root, "notes/done.md").unwrap(),
            "ship it"
        );

        let entry = trash_path_scoped(&root, "notes/done.md").unwrap();
        assert_eq!(list_trash_scoped(&root).unwrap(), vec![entry.clone()]);
        assert!(!root.join("notes/done.md").exists());

        restore_from_trash_scoped(&root, &entry).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("notes/done.md")).unwrap(),
            "ship it"
        );
        assert!(list_trash_scoped(&root).unwrap().is_empty());
    }

    #[test]
    fn checked_write_rejects_an_external_change() {
        let test_dir = TestDir::new();
        let root = canonical_workspace_root(test_dir.path()).unwrap();
        create_file_scoped(&root, "draft.txt", "opened version").unwrap();

        write_file_text_scoped(&root, "draft.txt", "first save", Some("opened version")).unwrap();
        fs::write(root.join("draft.txt"), "external version").unwrap();

        let error = write_file_text_scoped(&root, "draft.txt", "stale save", Some("first save"))
            .unwrap_err();
        assert!(error.contains("file changed on disk"));
        assert_eq!(
            fs::read_to_string(root.join("draft.txt")).unwrap(),
            "external version"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_traversal_and_symlink_escapes() {
        use std::os::unix::fs::symlink;

        let root_dir = TestDir::new();
        let outside_dir = TestDir::new();
        let root = canonical_workspace_root(root_dir.path()).unwrap();
        fs::write(outside_dir.path().join("secret.txt"), "secret").unwrap();
        symlink(outside_dir.path(), root.join("escape")).unwrap();

        assert!(read_file_text_scoped(&root, "escape/secret.txt").is_err());
        assert!(write_file_text_scoped(&root, "escape/secret.txt", "changed", None).is_err());
        assert!(create_file_scoped(&root, "escape/new.txt", "bad").is_err());
        assert!(rename_path_scoped(&root, "escape/secret.txt", "stolen.txt").is_err());
        assert!(create_directory_scoped(&root, "../outside").is_err());
        assert_eq!(
            fs::read_to_string(outside_dir.path().join("secret.txt")).unwrap(),
            "secret"
        );

        let nodes = read_dir_scoped(&root, root.to_str().unwrap()).unwrap();
        assert!(!nodes.iter().any(|node| node.name == "escape"));
    }

    #[test]
    fn reserves_trash_and_rejects_forged_recovery_entries() {
        let root_dir = TestDir::new();
        let outside_dir = TestDir::new();
        let root = canonical_workspace_root(root_dir.path()).unwrap();
        create_file_scoped(&root, "draft.txt", "draft").unwrap();
        let entry = trash_path_scoped(&root, "draft.txt").unwrap();

        assert!(read_dir_scoped(
            &root,
            root.join(WORKSPACE_TRASH_DIRECTORY).to_str().unwrap()
        )
        .is_err());

        let forged = TrashEntry {
            original_path: outside_dir
                .path()
                .join("draft.txt")
                .to_string_lossy()
                .to_string(),
            trashed_path: entry.trashed_path,
        };
        assert!(restore_from_trash_scoped(&root, &forged).is_err());
    }
}
