use anyhow::{Context, Result};
use ignore::WalkBuilder;
use serde::Serialize;
use std::path::Path;

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

/// Shallow directory listing of the given absolute path. Skips hidden entries
/// (names starting with ".") and the noisy `node_modules`/`target` directories.
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

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let is_dir = metadata.is_dir();
        let is_symlink = metadata.file_type().is_symlink();

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
    if name.starts_with('.') && name != ".env" {
        return true;
    }
    matches!(
        name,
        "node_modules" | "target" | "dist" | ".git" | ".next" | ".turbo"
    )
}

/// Read a UTF-8 text file. Returns the path's contents or an error.
pub fn read_text<P: AsRef<Path>>(path: P) -> Result<String> {
    let path = path.as_ref();
    std::fs::read_to_string(path)
        .with_context(|| format!("read_to_string failed for {}", path.display()))
}

/// Write a UTF-8 text file, creating parent directories if needed.
pub fn write_text<P: AsRef<Path>>(path: P, contents: &str) -> Result<()> {
    let path = path.as_ref();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(path, contents)
        .with_context(|| format!("write failed for {}", path.display()))
}

/// Recursively walk the workspace honoring `.gitignore` etc., returning
/// absolute paths to every file (capped at `max`). Used by the command
/// palette and quick-open.
pub fn walk_workspace<P: AsRef<Path>>(root: P, max: usize) -> Result<Vec<String>> {
    let root = root.as_ref();
    let mut out: Vec<String> = Vec::new();
    let walker = WalkBuilder::new(root)
        .hidden(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false)
        .standard_filters(true)
        .build();

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
