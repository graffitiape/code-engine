use ce_git::{status, GitRepoStatus};

/// Read repo status starting from `path` (the workspace root). Returns branch,
/// ahead/behind counts, staged/unstaged/untracked file lists.
#[tauri::command]
pub fn git_status(path: String) -> Result<GitRepoStatus, String> {
    status(&path).map_err(|e| e.to_string())
}
