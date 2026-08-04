use anyhow::{bail, Context, Result};
use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

use crate::tree::{atomic_write_text, workspace_walk_builder};

const DEFAULT_MAX_RESULTS: usize = 2_000;
const HARD_MAX_RESULTS: usize = 20_000;
const DEFAULT_MAX_FILE_SIZE_BYTES: u64 = 2 * 1024 * 1024;
const HARD_MAX_FILE_SIZE_BYTES: u64 = 16 * 1024 * 1024;
const DEFAULT_MAX_REPLACEMENTS: usize = 100_000;
const HARD_MAX_REPLACEMENTS: usize = 1_000_000;
const MAX_QUERY_BYTES: usize = 4_096;
const PREVIEW_CHAR_LIMIT: usize = 240;
const MATCH_TEXT_CHAR_LIMIT: usize = 240;

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    pub regex: bool,
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub max_results: Option<usize>,
    pub max_file_size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ReplaceRequest {
    pub search: SearchRequest,
    pub replacement: String,
    /// Replace-all is destructive and is rejected unless the caller explicitly
    /// confirms the operation.
    pub confirmed: bool,
    pub max_replacements: Option<usize>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// Absolute path used by the editor bridge.
    pub path: String,
    /// Workspace-root-relative path used for display.
    pub relative_path: String,
    /// One-based start line and column.
    pub line: usize,
    pub column: usize,
    /// One-based exclusive end location.
    pub end_line: usize,
    pub end_column: usize,
    pub preview: String,
    pub matched_text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub matches: Vec<SearchMatch>,
    pub truncated: bool,
    pub files_scanned: usize,
    pub skipped_binary_files: usize,
    pub skipped_oversized_files: usize,
    pub skipped_unreadable_files: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    pub files_changed: usize,
    pub replacements: usize,
    pub skipped_binary_files: usize,
    pub skipped_oversized_files: usize,
    pub skipped_unreadable_files: usize,
}

struct ScanCounts {
    files_scanned: usize,
    binary: usize,
    oversized: usize,
    unreadable: usize,
}

impl ScanCounts {
    fn new() -> Self {
        Self {
            files_scanned: 0,
            binary: 0,
            oversized: 0,
            unreadable: 0,
        }
    }
}

pub fn search_workspace<P: AsRef<Path>>(root: P, request: &SearchRequest) -> Result<SearchResult> {
    let root = canonical_workspace_root(root.as_ref())?;
    let matcher = compile_pattern(request)?;
    let max_results = request
        .max_results
        .unwrap_or(DEFAULT_MAX_RESULTS)
        .clamp(1, HARD_MAX_RESULTS);
    let max_file_size = bounded_file_size(request.max_file_size_bytes);
    let mut matches = Vec::new();
    let mut counts = ScanCounts::new();
    let mut truncated = false;

    for entry in workspace_walk_builder(&root).build() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                counts.unreadable += 1;
                continue;
            }
        };
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let Some(contents) = read_searchable_file(entry.path(), max_file_size, &mut counts) else {
            continue;
        };
        counts.files_scanned += 1;
        let line_starts = line_starts(&contents);
        let absolute_path = entry.path().to_string_lossy().to_string();
        let relative_path = relative_display_path(&root, entry.path());

        for found in matcher.find_iter(&contents) {
            if matches.len() >= max_results {
                truncated = true;
                break;
            }
            let (line, column) = position_for_offset(&contents, &line_starts, found.start());
            let (end_line, end_column) = position_for_offset(&contents, &line_starts, found.end());
            let line_index = line.saturating_sub(1);
            let line_start = line_starts[line_index];
            let line_end = contents[line_start..]
                .find('\n')
                .map(|offset| line_start + offset)
                .unwrap_or(contents.len());
            let line_text = contents[line_start..line_end].trim_end_matches('\r');
            let match_start_in_line = found
                .start()
                .saturating_sub(line_start)
                .min(line_text.len());

            matches.push(SearchMatch {
                path: absolute_path.clone(),
                relative_path: relative_path.clone(),
                line,
                column,
                end_line,
                end_column,
                preview: preview_line(line_text, match_start_in_line),
                matched_text: truncate_chars(found.as_str(), MATCH_TEXT_CHAR_LIMIT),
            });
        }

        if truncated {
            break;
        }
    }

    Ok(SearchResult {
        matches,
        truncated,
        files_scanned: counts.files_scanned,
        skipped_binary_files: counts.binary,
        skipped_oversized_files: counts.oversized,
        skipped_unreadable_files: counts.unreadable,
    })
}

pub fn replace_all<P: AsRef<Path>>(root: P, request: &ReplaceRequest) -> Result<ReplaceResult> {
    if !request.confirmed {
        bail!("replace-all requires explicit confirmation");
    }

    let root = canonical_workspace_root(root.as_ref())?;
    let matcher = compile_pattern(&request.search)?;
    if matcher.is_match("") {
        bail!("replace-all patterns that match empty text are not allowed");
    }

    let max_file_size = bounded_file_size(request.search.max_file_size_bytes);
    let max_replacements = request
        .max_replacements
        .unwrap_or(DEFAULT_MAX_REPLACEMENTS)
        .clamp(1, HARD_MAX_REPLACEMENTS);
    let mut counts = ScanCounts::new();
    let mut replacements = 0usize;
    let mut pending: Vec<(PathBuf, String)> = Vec::new();

    // Validate and build every change before touching disk. This prevents an
    // invalid/binary/oversized file from ever being rewritten and lets us
    // enforce the replacement cap before the first mutation.
    for entry in workspace_walk_builder(&root).build() {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                counts.unreadable += 1;
                continue;
            }
        };
        if !entry
            .file_type()
            .map(|kind| kind.is_file())
            .unwrap_or(false)
        {
            continue;
        }

        let Some(contents) = read_searchable_file(entry.path(), max_file_size, &mut counts) else {
            continue;
        };
        counts.files_scanned += 1;
        let file_replacements = matcher.find_iter(&contents).count();
        if file_replacements == 0 {
            continue;
        }

        replacements = replacements
            .checked_add(file_replacements)
            .context("replacement count overflow")?;
        if replacements > max_replacements {
            bail!(
                "replace-all would perform {replacements} replacements, exceeding the cap of {max_replacements}"
            );
        }

        let updated = if request.search.regex {
            matcher
                .replace_all(&contents, request.replacement.as_str())
                .into_owned()
        } else {
            matcher
                .replace_all(&contents, |_: &regex::Captures<'_>| {
                    request.replacement.as_str()
                })
                .into_owned()
        };
        pending.push((entry.into_path(), updated));
    }

    for (path, contents) in &pending {
        atomic_write_text(path, contents)
            .with_context(|| format!("replace-all failed while writing {}", path.display()))?;
    }

    Ok(ReplaceResult {
        files_changed: pending.len(),
        replacements,
        skipped_binary_files: counts.binary,
        skipped_oversized_files: counts.oversized,
        skipped_unreadable_files: counts.unreadable,
    })
}

fn compile_pattern(request: &SearchRequest) -> Result<Regex> {
    if request.query.is_empty() {
        bail!("search query cannot be empty");
    }
    if request.query.len() > MAX_QUERY_BYTES {
        bail!("search query exceeds the {MAX_QUERY_BYTES}-byte limit");
    }

    let pattern = if request.regex {
        request.query.clone()
    } else {
        regex::escape(&request.query)
    };
    let pattern = if request.whole_word {
        format!(r"\b(?:{pattern})\b")
    } else {
        pattern
    };

    RegexBuilder::new(&pattern)
        .case_insensitive(!request.case_sensitive)
        .unicode(true)
        .size_limit(16 * 1024 * 1024)
        .dfa_size_limit(16 * 1024 * 1024)
        .build()
        .with_context(|| format!("invalid search pattern: {pattern}"))
}

fn canonical_workspace_root(root: &Path) -> Result<PathBuf> {
    let root = root
        .canonicalize()
        .with_context(|| format!("workspace does not exist: {}", root.display()))?;
    if !root.is_dir() {
        bail!("workspace is not a directory: {}", root.display());
    }
    Ok(root)
}

fn bounded_file_size(requested: Option<u64>) -> u64 {
    requested
        .unwrap_or(DEFAULT_MAX_FILE_SIZE_BYTES)
        .clamp(1, HARD_MAX_FILE_SIZE_BYTES)
}

fn read_searchable_file(
    path: &Path,
    max_file_size: u64,
    counts: &mut ScanCounts,
) -> Option<String> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(_) => {
            counts.unreadable += 1;
            return None;
        }
    };
    if metadata.len() > max_file_size {
        counts.oversized += 1;
        return None;
    }

    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => {
            counts.unreadable += 1;
            return None;
        }
    };
    if bytes.contains(&0) {
        counts.binary += 1;
        return None;
    }
    match String::from_utf8(bytes) {
        Ok(contents) => Some(contents),
        Err(_) => {
            counts.binary += 1;
            None
        }
    }
}

fn line_starts(contents: &str) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(
        contents
            .match_indices('\n')
            .map(|(offset, _)| offset.saturating_add(1)),
    );
    starts
}

fn position_for_offset(contents: &str, starts: &[usize], offset: usize) -> (usize, usize) {
    let line_index = starts
        .partition_point(|start| *start <= offset)
        .saturating_sub(1);
    let line_start = starts[line_index];
    let safe_offset = offset.min(contents.len());
    let column = contents[line_start..safe_offset].chars().count() + 1;
    (line_index + 1, column)
}

fn preview_line(line: &str, match_start_byte: usize) -> String {
    let chars: Vec<char> = line.chars().collect();
    if chars.len() <= PREVIEW_CHAR_LIMIT {
        return line.to_string();
    }

    let safe_byte = match_start_byte.min(line.len());
    let match_start_char = line[..safe_byte].chars().count();
    let prefix_marker = match_start_char > PREVIEW_CHAR_LIMIT / 3;
    let content_budget = PREVIEW_CHAR_LIMIT.saturating_sub(4);
    let window_start = if prefix_marker {
        match_start_char.saturating_sub(content_budget / 3)
    } else {
        0
    };
    let window_end = (window_start + content_budget).min(chars.len());
    let suffix_marker = window_end < chars.len();

    let mut preview = String::with_capacity(PREVIEW_CHAR_LIMIT);
    if prefix_marker {
        preview.push_str("… ");
    }
    preview.extend(chars[window_start..window_end].iter());
    if suffix_marker {
        preview.push_str(" …");
    }
    preview
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    if value.chars().count() <= max_chars {
        return value.to_string();
    }
    let mut truncated: String = value.chars().take(max_chars.saturating_sub(1)).collect();
    truncated.push('…');
    truncated
}

fn relative_display_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tree::TestDir;

    #[test]
    fn literal_search_honors_case_words_ignores_and_positions() {
        let test_dir = TestDir::new("literal-search");
        fs::write(test_dir.path().join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(
            test_dir.path().join("visible.txt"),
            "alpha Alphabet\nsecond alpha line\n",
        )
        .unwrap();
        fs::write(test_dir.path().join(".env"), "ALPHA=alpha\n").unwrap();
        fs::write(test_dir.path().join("ignored.txt"), "alpha\n").unwrap();

        let result = search_workspace(
            test_dir.path(),
            &SearchRequest {
                query: "alpha".into(),
                whole_word: true,
                ..SearchRequest::default()
            },
        )
        .unwrap();

        assert_eq!(result.matches.len(), 4);
        assert!(result
            .matches
            .iter()
            .all(|found| found.relative_path != "ignored.txt"));
        let second_line = result
            .matches
            .iter()
            .find(|found| found.relative_path == "visible.txt" && found.line == 2)
            .unwrap();
        assert_eq!((second_line.line, second_line.column), (2, 8));
    }

    #[test]
    fn regex_search_caps_results() {
        let test_dir = TestDir::new("regex-search");
        fs::write(test_dir.path().join("matches.txt"), "item-1 item-2 item-3").unwrap();

        let result = search_workspace(
            test_dir.path(),
            &SearchRequest {
                query: r"item-\d".into(),
                regex: true,
                max_results: Some(2),
                max_file_size_bytes: Some(64),
                ..SearchRequest::default()
            },
        )
        .unwrap();

        assert_eq!(result.matches.len(), 2);
        assert!(result.truncated);
    }

    #[test]
    fn search_skips_binary_and_oversized_files() {
        let test_dir = TestDir::new("safe-search");
        fs::write(test_dir.path().join("binary.bin"), b"item-4\0tail").unwrap();
        fs::write(test_dir.path().join("large.txt"), "item-5 ".repeat(40)).unwrap();

        let result = search_workspace(
            test_dir.path(),
            &SearchRequest {
                query: r"item-\d".into(),
                regex: true,
                max_file_size_bytes: Some(64),
                ..SearchRequest::default()
            },
        )
        .unwrap();

        assert!(result.matches.is_empty());
        assert_eq!(result.skipped_binary_files, 1);
        assert_eq!(result.skipped_oversized_files, 1);
    }

    #[test]
    fn replace_all_requires_confirmation_and_writes_only_text_matches() {
        let test_dir = TestDir::new("replace-all");
        fs::write(test_dir.path().join("a.txt"), "alpha alpha").unwrap();
        fs::write(test_dir.path().join("binary.bin"), b"alpha\0alpha").unwrap();

        let mut request = ReplaceRequest {
            search: SearchRequest {
                query: "alpha".into(),
                case_sensitive: true,
                ..SearchRequest::default()
            },
            replacement: "$value".into(),
            ..ReplaceRequest::default()
        };
        assert!(replace_all(test_dir.path(), &request).is_err());
        assert_eq!(
            fs::read_to_string(test_dir.path().join("a.txt")).unwrap(),
            "alpha alpha"
        );

        request.confirmed = true;
        request.max_replacements = Some(1);
        assert!(replace_all(test_dir.path(), &request).is_err());
        assert_eq!(
            fs::read_to_string(test_dir.path().join("a.txt")).unwrap(),
            "alpha alpha"
        );

        request.max_replacements = None;
        let result = replace_all(test_dir.path(), &request).unwrap();
        assert_eq!(result.files_changed, 1);
        assert_eq!(result.replacements, 2);
        assert_eq!(result.skipped_binary_files, 1);
        assert_eq!(
            fs::read_to_string(test_dir.path().join("a.txt")).unwrap(),
            "$value $value"
        );
        assert_eq!(
            fs::read(test_dir.path().join("binary.bin")).unwrap(),
            b"alpha\0alpha"
        );
    }

    #[test]
    fn regex_replace_supports_capture_expansion() {
        let test_dir = TestDir::new("regex-replace");
        fs::write(test_dir.path().join("a.txt"), "left=right").unwrap();

        let result = replace_all(
            test_dir.path(),
            &ReplaceRequest {
                search: SearchRequest {
                    query: r"(\w+)=(\w+)".into(),
                    regex: true,
                    case_sensitive: true,
                    ..SearchRequest::default()
                },
                replacement: "$2=$1".into(),
                confirmed: true,
                max_replacements: None,
            },
        )
        .unwrap();

        assert_eq!(result.replacements, 1);
        assert_eq!(
            fs::read_to_string(test_dir.path().join("a.txt")).unwrap(),
            "right=left"
        );
    }

    #[test]
    fn search_and_replace_never_touch_recovery_trash() {
        let test_dir = TestDir::new("search-recovery-trash");
        let trash = test_dir.path().join(".code-engine-trash").join("entry");
        fs::create_dir_all(&trash).unwrap();
        let payload = trash.join("payload");
        fs::write(&payload, "private alpha").unwrap();
        fs::write(test_dir.path().join("visible.txt"), "visible alpha").unwrap();

        let search = SearchRequest {
            query: "alpha".into(),
            case_sensitive: true,
            ..SearchRequest::default()
        };
        let result = search_workspace(test_dir.path(), &search).unwrap();
        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].relative_path, "visible.txt");

        replace_all(
            test_dir.path(),
            &ReplaceRequest {
                search,
                replacement: "beta".into(),
                confirmed: true,
                max_replacements: None,
            },
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&payload).unwrap(), "private alpha");
        assert_eq!(
            fs::read_to_string(test_dir.path().join("visible.txt")).unwrap(),
            "visible beta"
        );
    }
}
