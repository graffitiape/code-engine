use std::collections::HashSet;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub fn resolve_codex_binary(configured: Option<&str>) -> Result<PathBuf, String> {
    let path_env = std::env::var_os("PATH");
    let user_home = std::env::var_os("HOME").map(PathBuf::from);
    let current_exe = std::env::current_exe().ok();
    let candidates = binary_candidates(
        configured,
        path_env.as_deref(),
        user_home.as_deref(),
        current_exe.as_deref(),
    );

    for candidate in candidates {
        if is_executable_file(&candidate) {
            return candidate.canonicalize().map_err(|error| {
                format!(
                    "failed to canonicalize Codex binary {}: {error}",
                    candidate.display()
                )
            });
        }
    }

    Err(
        "Codex CLI was not found. Install Codex or configure its absolute path in settings."
            .to_string(),
    )
}

/// Build a predictable child PATH for GUI launches, which often omit package
/// manager locations even when Code Engine can resolve Codex by an absolute path.
pub fn codex_process_path(binary: &Path) -> Option<OsString> {
    let mut directories = Vec::<PathBuf>::new();
    if let Some(parent) = binary.parent() {
        directories.push(parent.to_path_buf());
    }
    if let Some(path_env) = std::env::var_os("PATH") {
        directories.extend(std::env::split_paths(&path_env));
    }
    if cfg!(target_os = "macos") {
        directories.push(PathBuf::from("/opt/homebrew/bin"));
        directories.push(PathBuf::from("/usr/local/bin"));
    } else if cfg!(unix) {
        directories.push(PathBuf::from("/usr/local/bin"));
        directories.push(PathBuf::from("/usr/bin"));
    }
    if let Some(user_home) = std::env::var_os("HOME").map(PathBuf::from) {
        directories.push(user_home.join(".local/bin"));
        directories.push(user_home.join(".cargo/bin"));
    }

    let mut seen = HashSet::<OsString>::new();
    directories.retain(|directory| seen.insert(directory.as_os_str().to_os_string()));
    std::env::join_paths(directories).ok()
}

fn binary_candidates(
    configured: Option<&str>,
    path_env: Option<&OsStr>,
    user_home: Option<&Path>,
    current_exe: Option<&Path>,
) -> Vec<PathBuf> {
    let executable_name = if cfg!(windows) { "codex.exe" } else { "codex" };
    let mut candidates = Vec::new();

    if let Some(configured) = configured.map(str::trim).filter(|path| !path.is_empty()) {
        candidates.push(expand_home(configured, user_home));
    }

    if let Some(path_env) = path_env {
        candidates.extend(
            std::env::split_paths(path_env).map(|directory| directory.join(executable_name)),
        );
    }

    if let Some(current_exe) = current_exe.and_then(Path::parent) {
        candidates.push(current_exe.join(executable_name));
    }

    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from("/opt/homebrew/bin/codex"));
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
    } else if cfg!(unix) {
        candidates.push(PathBuf::from("/usr/local/bin/codex"));
        candidates.push(PathBuf::from("/usr/bin/codex"));
    }

    if let Some(user_home) = user_home {
        candidates.push(user_home.join(".local/bin").join(executable_name));
        candidates.push(user_home.join(".cargo/bin").join(executable_name));
    }

    let mut seen = HashSet::<OsString>::new();
    candidates
        .into_iter()
        .filter(|candidate| seen.insert(candidate.as_os_str().to_os_string()))
        .collect()
}

fn expand_home(path: &str, user_home: Option<&Path>) -> PathBuf {
    if path == "~" {
        return user_home.unwrap_or_else(|| Path::new("~")).to_path_buf();
    }
    if let Some(rest) = path.strip_prefix("~/") {
        if let Some(user_home) = user_home {
            return user_home.join(rest);
        }
    }
    PathBuf::from(path)
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }

    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;
    use std::path::{Path, PathBuf};

    use super::{binary_candidates, codex_process_path, expand_home, resolve_codex_binary};

    #[test]
    fn configured_path_precedes_path_and_common_candidates() {
        let path_env = std::env::join_paths([Path::new("/path/one"), Path::new("/path/two")])
            .expect("valid test PATH");
        let candidates = binary_candidates(
            Some("~/bin/custom-codex"),
            Some(path_env.as_os_str()),
            Some(Path::new("/users/tester")),
            Some(Path::new("/Applications/Code Engine/code-engine")),
        );

        assert_eq!(
            candidates.first(),
            Some(&PathBuf::from("/users/tester/bin/custom-codex"))
        );
        assert!(candidates.contains(&PathBuf::from("/path/one/codex")));
        assert!(candidates.contains(&PathBuf::from("/Applications/Code Engine/codex")));
    }

    #[test]
    fn expands_home_without_changing_non_home_paths() {
        assert_eq!(
            expand_home("~/tools/codex", Some(Path::new("/home/tester"))),
            PathBuf::from("/home/tester/tools/codex")
        );
        assert_eq!(
            expand_home("/opt/codex", Some(Path::new("/home/tester"))),
            PathBuf::from("/opt/codex")
        );
    }

    #[test]
    fn resolves_an_explicit_executable() {
        let executable = std::env::current_exe().expect("current test executable");
        let resolved =
            resolve_codex_binary(executable.to_str()).expect("resolve current executable");
        assert_eq!(resolved, executable.canonicalize().unwrap());
    }

    #[test]
    fn deduplicates_candidate_paths() {
        let path = OsString::from("/opt/homebrew/bin:/opt/homebrew/bin");
        let candidates = binary_candidates(None, Some(&path), None, None);
        let count = candidates
            .iter()
            .filter(|candidate| *candidate == Path::new("/opt/homebrew/bin/codex"))
            .count();
        assert_eq!(count, 1);
    }

    #[test]
    fn process_path_starts_with_codex_binary_directory() {
        let path = codex_process_path(Path::new("/custom/tools/codex")).unwrap();
        assert_eq!(
            std::env::split_paths(&path).next(),
            Some(PathBuf::from("/custom/tools"))
        );
    }
}
