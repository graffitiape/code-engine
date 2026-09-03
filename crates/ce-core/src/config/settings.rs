use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::Builder as TempFileBuilder;

const DEFAULT_PIPELINE_AGENT_INSTRUCTIONS: &str = "You are one stage in a Code Engine pipeline. Use the supplied pipeline plan to understand the other steps, but perform only the current stage's configured responsibility. Use direct upstream handoffs as context when they are available. Do not repeat work completed by another stage or take over another stage's responsibility. Respect the current stage's access level and return a concise handoff for downstream steps.";
const MAX_PIPELINE_AGENT_INSTRUCTION_CHARS: usize = 16_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct LspServerSettings {
    pub id: String,
    pub enabled: bool,
    pub executable: Option<String>,
}

impl Default for LspServerSettings {
    fn default() -> Self {
        Self {
            id: String::new(),
            enabled: true,
            executable: None,
        }
    }
}

fn default_lsp_servers() -> Vec<LspServerSettings> {
    ["typescript", "rust", "python", "json", "css", "html"]
        .into_iter()
        .map(|id| LspServerSettings {
            id: id.to_string(),
            ..LspServerSettings::default()
        })
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub editor_theme: String,
    pub density: String,
    pub app_zoom: f64,
    pub ui_font_size: f64,
    pub font_family: String,
    pub font_size: f64,
    pub line_height: f64,
    pub word_wrap: bool,
    pub tab_size: u8,
    pub lsp_enabled: bool,
    pub lsp_servers: Vec<LspServerSettings>,
    pub codex_path: Option<String>,
    pub pipeline_agent_instructions: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "tokyonight".to_string(),
            editor_theme: "match-interface".to_string(),
            density: "compact".to_string(),
            app_zoom: 1.0,
            ui_font_size: 13.0,
            font_family: "JetBrains Mono".to_string(),
            font_size: 14.0,
            line_height: 1.5,
            word_wrap: false,
            tab_size: 2,
            lsp_enabled: false,
            lsp_servers: default_lsp_servers(),
            codex_path: None,
            pipeline_agent_instructions: DEFAULT_PIPELINE_AGENT_INSTRUCTIONS.to_string(),
        }
    }
}

impl AppSettings {
    pub fn load() -> Result<Self> {
        let path = Self::config_path();
        if path.exists() {
            let contents = std::fs::read_to_string(&path)?;
            Ok(serde_json::from_str::<Self>(&contents)?.normalized())
        } else {
            Ok(Self::default())
        }
    }

    pub fn save(&self) -> Result<()> {
        let path = Self::config_path();
        self.save_to_path(&path)
    }

    fn save_to_path(&self, path: &Path) -> Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let contents = serde_json::to_string_pretty(&self.clone().normalized())?;
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        let mut temporary = TempFileBuilder::new()
            .prefix(".code-engine-settings-")
            .suffix(".tmp")
            .tempfile_in(parent)?;
        temporary.write_all(contents.as_bytes())?;
        temporary.as_file().sync_all()?;
        temporary.persist(path).map_err(|error| error.error)?;

        #[cfg(unix)]
        std::fs::File::open(parent)?.sync_all()?;

        Ok(())
    }

    /// Keep corrupted or hand-edited config files from breaking application
    /// layout while still accepting settings written by older releases.
    pub fn normalized(mut self) -> Self {
        if !matches!(
            self.theme.as_str(),
            "tokyonight" | "catppuccin" | "rosepine"
        ) {
            self.theme = "tokyonight".to_string();
        }
        if !matches!(
            self.editor_theme.as_str(),
            "match-interface" | "tokyonight" | "catppuccin" | "rosepine" | "one-dark"
        ) {
            self.editor_theme = "match-interface".to_string();
        }
        if !matches!(
            self.density.as_str(),
            "compact" | "comfortable" | "spacious"
        ) {
            self.density = "compact".to_string();
        }
        self.app_zoom = finite_clamp(self.app_zoom, 0.5, 2.0, 1.0);
        self.ui_font_size = finite_clamp(self.ui_font_size, 10.0, 18.0, 13.0);
        self.font_family = self.font_family.trim().chars().take(120).collect();
        if self.font_family.is_empty() {
            self.font_family = "JetBrains Mono".to_string();
        }
        self.font_size = finite_clamp(self.font_size, 10.0, 24.0, 14.0);
        self.line_height = finite_clamp(self.line_height, 1.1, 2.0, 1.5);
        if !matches!(self.tab_size, 2 | 4 | 8) {
            self.tab_size = 2;
        }
        let configured_lsp_servers = std::mem::take(&mut self.lsp_servers);
        self.lsp_servers = default_lsp_servers()
            .into_iter()
            .map(|mut default_server| {
                if let Some(configured) = configured_lsp_servers
                    .iter()
                    .find(|server| server.id == default_server.id)
                {
                    default_server.enabled = configured.enabled;
                    default_server.executable =
                        normalize_optional_path(configured.executable.clone());
                }
                default_server
            })
            .collect();
        self.codex_path = normalize_optional_path(self.codex_path);
        self.pipeline_agent_instructions = self
            .pipeline_agent_instructions
            .chars()
            .take(MAX_PIPELINE_AGENT_INSTRUCTION_CHARS)
            .collect();
        self
    }

    fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("code-engine")
            .join("settings.json")
    }
}

fn finite_clamp(value: f64, min: f64, max: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        fallback
    }
}

fn normalize_optional_path(value: Option<String>) -> Option<String> {
    value.and_then(|path| {
        let trimmed: String = path.trim().chars().take(4096).collect();
        (!trimmed.is_empty()).then_some(trimmed)
    })
}

#[cfg(test)]
mod tests {
    use super::AppSettings;
    use std::fs;

    #[test]
    fn normalizes_untrusted_config_values() {
        let settings = AppSettings {
            theme: "unknown".into(),
            editor_theme: "unknown".into(),
            density: "giant".into(),
            ui_font_size: 200.0,
            font_family: " ".into(),
            font_size: 200.0,
            line_height: f64::NAN,
            tab_size: 3,
            lsp_servers: vec![
                super::LspServerSettings {
                    id: "typescript".into(),
                    enabled: false,
                    executable: Some("  ~/bin/typescript-language-server  ".into()),
                },
                super::LspServerSettings {
                    id: "untrusted-server".into(),
                    enabled: true,
                    executable: Some("do-anything".into()),
                },
            ],
            codex_path: Some(" ".into()),
            ..AppSettings::default()
        }
        .normalized();

        assert_eq!(settings.theme, "tokyonight");
        assert_eq!(settings.editor_theme, "match-interface");
        assert_eq!(settings.density, "compact");
        assert_eq!(settings.app_zoom, 1.0);
        assert_eq!(settings.ui_font_size, 18.0);
        assert_eq!(settings.font_size, 24.0);
        assert_eq!(settings.line_height, 1.5);
        assert_eq!(settings.tab_size, 2);
        assert_eq!(settings.lsp_servers.len(), 6);
        assert_eq!(settings.lsp_servers[0].id, "typescript");
        assert!(!settings.lsp_servers[0].enabled);
        assert_eq!(
            settings.lsp_servers[0].executable.as_deref(),
            Some("~/bin/typescript-language-server")
        );
        assert!(settings
            .lsp_servers
            .iter()
            .all(|server| server.id != "untrusted-server"));
        assert_eq!(settings.codex_path, None);
        assert_eq!(
            settings.pipeline_agent_instructions,
            AppSettings::default().pipeline_agent_instructions,
        );
    }

    #[test]
    fn loads_legacy_settings_with_default_pipeline_instructions() {
        let settings: AppSettings = serde_json::from_str(r#"{"theme":"rosepine"}"#).unwrap();

        assert_eq!(settings.theme, "rosepine");
        assert_eq!(settings.editor_theme, "match-interface");
        assert_eq!(settings.app_zoom, 1.0);
        assert_eq!(settings.ui_font_size, 13.0);
        assert!(!settings.lsp_enabled);
        assert_eq!(settings.lsp_servers, super::default_lsp_servers());
        assert_eq!(
            settings.pipeline_agent_instructions,
            AppSettings::default().pipeline_agent_instructions,
        );
    }

    #[test]
    fn normalizes_interface_font_size_bounds_and_non_finite_values() {
        let minimum = AppSettings {
            ui_font_size: -20.0,
            ..AppSettings::default()
        }
        .normalized();
        let maximum = AppSettings {
            ui_font_size: 200.0,
            ..AppSettings::default()
        }
        .normalized();
        let fallback = AppSettings {
            ui_font_size: f64::NAN,
            ..AppSettings::default()
        }
        .normalized();

        assert_eq!(minimum.ui_font_size, 10.0);
        assert_eq!(maximum.ui_font_size, 18.0);
        assert_eq!(fallback.ui_font_size, 13.0);
    }

    #[test]
    fn normalizes_app_zoom_bounds_and_non_finite_values() {
        let minimum = AppSettings {
            app_zoom: -20.0,
            ..AppSettings::default()
        }
        .normalized();
        let maximum = AppSettings {
            app_zoom: 20.0,
            ..AppSettings::default()
        }
        .normalized();
        let fallback = AppSettings {
            app_zoom: f64::NAN,
            ..AppSettings::default()
        }
        .normalized();

        assert_eq!(minimum.app_zoom, 0.5);
        assert_eq!(maximum.app_zoom, 2.0);
        assert_eq!(fallback.app_zoom, 1.0);
    }

    #[test]
    fn atomically_replaces_existing_settings_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, r#"{"theme":"old"}"#).unwrap();

        let settings = AppSettings {
            theme: "rosepine".into(),
            editor_theme: "catppuccin".into(),
            ui_font_size: 17.0,
            font_size: 17.0,
            lsp_enabled: true,
            lsp_servers: super::default_lsp_servers()
                .into_iter()
                .map(|mut server| {
                    if server.id == "rust" {
                        server.executable = Some("/opt/tools/rust-analyzer".into());
                    }
                    server
                })
                .collect(),
            ..AppSettings::default()
        };
        settings.save_to_path(&path).unwrap();

        let saved: AppSettings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.theme, "rosepine");
        assert_eq!(saved.editor_theme, "catppuccin");
        assert_eq!(saved.ui_font_size, 17.0);
        assert_eq!(saved.font_size, 17.0);
        assert!(saved.lsp_enabled);
        assert_eq!(
            saved
                .lsp_servers
                .iter()
                .find(|server| server.id == "rust")
                .and_then(|server| server.executable.as_deref()),
            Some("/opt/tools/rust-analyzer")
        );
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            1,
            "temporary file should be consumed after replacement"
        );
    }
}
