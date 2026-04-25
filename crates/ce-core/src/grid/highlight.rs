use std::collections::HashMap;

use crate::nvim::protocol::HlAttr;

/// Manages highlight attributes and color resolution
#[derive(Debug, Default)]
pub struct HighlightTable {
    attrs: HashMap<u64, HlAttr>,
    pub default_fg: u32,
    pub default_bg: u32,
    pub default_sp: u32,
}

impl HighlightTable {
    pub fn new() -> Self {
        Self {
            attrs: HashMap::new(),
            default_fg: 0xFFFFFF,
            default_bg: 0x000000,
            default_sp: 0xFF0000,
        }
    }

    pub fn set(&mut self, id: u64, attr: HlAttr) {
        self.attrs.insert(id, attr);
    }

    pub fn get(&self, id: u64) -> Option<&HlAttr> {
        self.attrs.get(&id)
    }

    pub fn set_defaults(&mut self, fg: u32, bg: u32, sp: u32) {
        self.default_fg = fg;
        self.default_bg = bg;
        self.default_sp = sp;
    }

    /// Resolve foreground color for a highlight ID, accounting for reverse
    pub fn resolve_fg(&self, id: u64) -> u32 {
        match self.attrs.get(&id) {
            Some(attr) => {
                if attr.reverse {
                    attr.background.unwrap_or(self.default_bg)
                } else {
                    attr.foreground.unwrap_or(self.default_fg)
                }
            }
            None => self.default_fg,
        }
    }

    /// Resolve background color for a highlight ID, accounting for reverse
    pub fn resolve_bg(&self, id: u64) -> u32 {
        match self.attrs.get(&id) {
            Some(attr) => {
                if attr.reverse {
                    attr.foreground.unwrap_or(self.default_fg)
                } else {
                    attr.background.unwrap_or(self.default_bg)
                }
            }
            None => self.default_bg,
        }
    }

    /// Get full resolved attributes for serialization to frontend
    pub fn resolve(&self, id: u64) -> ResolvedAttr {
        let attr = self.attrs.get(&id);
        match attr {
            Some(a) => ResolvedAttr {
                fg: self.resolve_fg(id),
                bg: self.resolve_bg(id),
                sp: a.special.unwrap_or(self.default_sp),
                bold: a.bold,
                italic: a.italic,
                underline: a.underline,
                undercurl: a.undercurl,
                underdouble: a.underdouble,
                underdotted: a.underdotted,
                underdashed: a.underdashed,
                strikethrough: a.strikethrough,
            },
            None => ResolvedAttr {
                fg: self.default_fg,
                bg: self.default_bg,
                sp: self.default_sp,
                ..Default::default()
            },
        }
    }
}

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ResolvedAttr {
    pub fg: u32,
    pub bg: u32,
    pub sp: u32,
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub undercurl: bool,
    pub underdouble: bool,
    pub underdotted: bool,
    pub underdashed: bool,
    pub strikethrough: bool,
}
