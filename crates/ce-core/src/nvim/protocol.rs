use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// A single cell in a grid_line event
#[derive(Debug, Clone)]
pub struct GridCell {
    pub text: String,
    pub hl_id: u64,
    pub repeat: u64,
}

/// Highlight attributes from hl_attr_define
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HlAttr {
    pub foreground: Option<u32>,
    pub background: Option<u32>,
    pub special: Option<u32>,
    pub reverse: bool,
    pub italic: bool,
    pub bold: bool,
    pub strikethrough: bool,
    pub underline: bool,
    pub undercurl: bool,
    pub underdouble: bool,
    pub underdotted: bool,
    pub underdashed: bool,
    pub blend: u8,
}

/// Mode information from mode_info_set
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModeInfo {
    pub name: String,
    pub cursor_shape: Option<String>,
    pub cell_percentage: Option<u64>,
    pub attr_id: Option<u64>,
}

/// Parsed redraw events from Neovim
#[derive(Debug, Clone)]
pub enum RedrawEvent {
    GridResize {
        grid: u64,
        width: u64,
        height: u64,
    },
    GridClear {
        grid: u64,
    },
    GridLine {
        grid: u64,
        row: u64,
        col_start: u64,
        cells: Vec<GridCell>,
        wrap: bool,
    },
    GridCursorGoto {
        grid: u64,
        row: u64,
        col: u64,
    },
    GridScroll {
        grid: u64,
        top: u64,
        bot: u64,
        left: u64,
        right: u64,
        rows: i64,
        cols: i64,
    },
    GridDestroy {
        grid: u64,
    },
    HlAttrDefine {
        id: u64,
        rgb_attr: HlAttr,
    },
    HlGroupSet {
        name: String,
        hl_id: u64,
    },
    DefaultColorsSet {
        fg: u32,
        bg: u32,
        sp: u32,
    },
    ModeInfoSet {
        cursor_style_enabled: bool,
        mode_info: Vec<ModeInfo>,
    },
    ModeChange {
        mode: String,
        mode_idx: u64,
    },
    SetTitle {
        title: String,
    },
    SetIcon {
        icon: String,
    },
    OptionSet {
        name: String,
        value: rmpv::Value,
    },
    Flush,
    BusyStart,
    BusyStop,
    MouseOn,
    MouseOff,
    Bell,
    VisualBell,
}

impl HlAttr {
    pub fn from_map(map: &HashMap<String, rmpv::Value>) -> Self {
        let get_bool = |key: &str| -> bool {
            map.get(key).and_then(|v| v.as_bool()).unwrap_or(false)
        };
        let get_color = |key: &str| -> Option<u32> {
            map.get(key).and_then(|v| v.as_u64()).map(|v| v as u32)
        };

        HlAttr {
            foreground: get_color("foreground"),
            background: get_color("background"),
            special: get_color("special"),
            reverse: get_bool("reverse"),
            italic: get_bool("italic"),
            bold: get_bool("bold"),
            strikethrough: get_bool("strikethrough"),
            underline: get_bool("underline"),
            undercurl: get_bool("undercurl"),
            underdouble: get_bool("underdouble"),
            underdotted: get_bool("underdotted"),
            underdashed: get_bool("underdashed"),
            blend: map.get("blend").and_then(|v| v.as_u64()).unwrap_or(0) as u8,
        }
    }
}
