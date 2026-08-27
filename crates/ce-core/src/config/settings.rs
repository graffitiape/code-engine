use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use tempfile::Builder as TempFileBuilder;

const DEFAULT_PIPELINE_AGENT_INSTRUCTIONS: &str = "You are one stage in a Code Engine pipeline. Use the supplied pipeline plan to understand the other steps, but perform only the current stage's configured responsibility. Use direct upstream handoffs as context when they are available. Do not repeat work completed by another stage or take over another stage's responsibility. Respect the current stage's access level and return a concise handoff for downstream steps.";
const MAX_PIPELINE_AGENT_INSTRUCTION_CHARS: usize = 16_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    pub theme: String,
    pub density: String,
    pub font_family: String,
    pub font_size: f64,
    pub line_height: f64,
    pub word_wrap: bool,
    pub tab_size: u8,
    pub codex_path: Option<String>,
    pub pipeline_agent_instructions: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "tokyonight".to_string(),
            density: "compact".to_string(),
            font_family: "JetBrains Mono".to_string(),
            font_size: 14.0,
            line_height: 1.5,
            word_wrap: false,
            tab_size: 2,
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
            self.density.as_str(),
            "compact" | "comfortable" | "spacious"
        ) {
            self.density = "compact".to_string();
        }
        self.font_family = self.font_family.trim().chars().take(120).collect();
        if self.font_family.is_empty() {
            self.font_family = "JetBrains Mono".to_string();
        }
        self.font_size = finite_clamp(self.font_size, 10.0, 24.0, 14.0);
        self.line_height = finite_clamp(self.line_height, 1.1, 2.0, 1.5);
        if !matches!(self.tab_size, 2 | 4 | 8) {
            self.tab_size = 2;
        }
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
            density: "giant".into(),
            font_family: " ".into(),
            font_size: 200.0,
            line_height: f64::NAN,
            tab_size: 3,
            codex_path: Some(" ".into()),
            ..AppSettings::default()
        }
        .normalized();

        assert_eq!(settings.theme, "tokyonight");
        assert_eq!(settings.density, "compact");
        assert_eq!(settings.font_size, 24.0);
        assert_eq!(settings.line_height, 1.5);
        assert_eq!(settings.tab_size, 2);
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
        assert_eq!(
            settings.pipeline_agent_instructions,
            AppSettings::default().pipeline_agent_instructions,
        );
    }

    #[test]
    fn atomically_replaces_existing_settings_file() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("settings.json");
        fs::write(&path, r#"{"theme":"old"}"#).unwrap();

        let settings = AppSettings {
            theme: "rosepine".into(),
            font_size: 17.0,
            ..AppSettings::default()
        };
        settings.save_to_path(&path).unwrap();

        let saved: AppSettings = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(saved.theme, "rosepine");
        assert_eq!(saved.font_size, 17.0);
        assert_eq!(
            fs::read_dir(directory.path()).unwrap().count(),
            1,
            "temporary file should be consumed after replacement"
        );
    }
}
