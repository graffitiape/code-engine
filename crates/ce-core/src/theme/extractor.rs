use serde::Serialize;

/// Theme palette extracted from Neovim highlight groups
#[derive(Debug, Clone, Serialize)]
pub struct ThemePalette {
    pub bg: String,
    pub fg: String,
    pub accent: String,
    pub border: String,
    pub tab_bg: String,
    pub tab_active: String,
    pub status_bg: String,
    pub error: String,
    pub warn: String,
    pub info: String,
    pub hint: String,
    pub git_add: String,
    pub git_change: String,
    pub git_delete: String,
}

/// Convert a u32 color to CSS hex string
pub fn color_to_hex(color: u32) -> String {
    format!("#{:06x}", color)
}

impl Default for ThemePalette {
    fn default() -> Self {
        Self {
            bg: "#1a1b26".to_string(),
            fg: "#c0caf5".to_string(),
            accent: "#7aa2f7".to_string(),
            border: "#3b4261".to_string(),
            tab_bg: "#1f2335".to_string(),
            tab_active: "#292e42".to_string(),
            status_bg: "#1f2335".to_string(),
            error: "#f7768e".to_string(),
            warn: "#e0af68".to_string(),
            info: "#7aa2f7".to_string(),
            hint: "#1abc9c".to_string(),
            git_add: "#9ece6a".to_string(),
            git_change: "#7aa2f7".to_string(),
            git_delete: "#f7768e".to_string(),
        }
    }
}
