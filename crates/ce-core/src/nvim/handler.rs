use std::collections::HashMap;
use std::sync::Arc;

use nvim_rs::Handler;
use rmpv::Value;
use tokio::sync::mpsc;
use tracing::{debug, trace, warn};

use crate::grid::highlight::ResolvedAttr;
use crate::grid::state::GridManager;
use crate::nvim::protocol::{GridCell, HlAttr, ModeInfo, RedrawEvent};

/// Events emitted from the handler to the bridge layer
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "type")]
pub enum NvimUiEvent {
    /// A flush occurred — grid state is consistent, render now
    Flush {
        pane_id: String,
        grids: HashMap<u64, GridSnapshot>,
        /// Resolved highlight attrs referenced by any cell's `hl_id`. Sent
        /// every flush so the renderer never has to track partial state.
        hl_attrs: HashMap<u64, ResolvedAttr>,
        /// Default fg/bg/sp from the active colorscheme (most recent
        /// `default_colors_set`).
        default_fg: u32,
        default_bg: u32,
        default_sp: u32,
    },
    /// Mode changed
    ModeChange {
        pane_id: String,
        mode: String,
        mode_idx: u64,
    },
    /// Default colors changed
    DefaultColorsChanged {
        pane_id: String,
        fg: u32,
        bg: u32,
        sp: u32,
    },
    /// Title changed
    TitleChanged {
        pane_id: String,
        title: String,
    },
}

/// Snapshot of a grid for sending to frontend
#[derive(Debug, Clone, serde::Serialize)]
pub struct GridSnapshot {
    pub width: u64,
    pub height: u64,
    pub cells: Vec<CellData>,
    pub cursor_row: u64,
    pub cursor_col: u64,
    pub dirty: bool,
}

/// Single cell data for serialization
#[derive(Debug, Clone, serde::Serialize)]
pub struct CellData {
    pub text: String,
    pub hl_id: u64,
}

/// NvimHandler implements nvim_rs::Handler to process redraw events
#[derive(Clone)]
pub struct NvimHandler {
    pane_id: String,
    event_tx: mpsc::UnboundedSender<NvimUiEvent>,
    grid_manager: Arc<tokio::sync::Mutex<GridManager>>,
}

impl NvimHandler {
    pub fn new(pane_id: String, event_tx: mpsc::UnboundedSender<NvimUiEvent>) -> Self {
        Self {
            pane_id,
            event_tx,
            grid_manager: Arc::new(tokio::sync::Mutex::new(GridManager::new())),
        }
    }

    /// Parse a single redraw event from msgpack
    fn parse_redraw_event(name: &str, args: &[Value]) -> Vec<RedrawEvent> {
        let mut events = Vec::new();

        for arg in args {
            let params = match arg.as_array() {
                Some(a) => a,
                None => continue,
            };

            match name {
                "grid_resize" => {
                    if params.len() >= 3 {
                        events.push(RedrawEvent::GridResize {
                            grid: params[0].as_u64().unwrap_or(1),
                            width: params[1].as_u64().unwrap_or(80),
                            height: params[2].as_u64().unwrap_or(24),
                        });
                    }
                }
                "grid_clear" => {
                    if !params.is_empty() {
                        events.push(RedrawEvent::GridClear {
                            grid: params[0].as_u64().unwrap_or(1),
                        });
                    }
                }
                "grid_line" => {
                    if params.len() >= 4 {
                        let grid = params[0].as_u64().unwrap_or(1);
                        let row = params[1].as_u64().unwrap_or(0);
                        let col_start = params[2].as_u64().unwrap_or(0);
                        let empty_vec = vec![];
                        let cells_data = params[3].as_array().unwrap_or(&empty_vec);
                        let wrap = params.get(4).and_then(|v| v.as_bool()).unwrap_or(false);

                        let mut cells = Vec::new();
                        let mut last_hl_id: u64 = 0;

                        for cell in cells_data {
                            if let Some(cell_arr) = cell.as_array() {
                                let text = cell_arr
                                    .first()
                                    .and_then(|v| v.as_str())
                                    .unwrap_or(" ")
                                    .to_string();
                                let hl_id = cell_arr
                                    .get(1)
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(last_hl_id);
                                let repeat = cell_arr
                                    .get(2)
                                    .and_then(|v| v.as_u64())
                                    .unwrap_or(1);

                                last_hl_id = hl_id;
                                cells.push(GridCell {
                                    text,
                                    hl_id,
                                    repeat,
                                });
                            }
                        }

                        events.push(RedrawEvent::GridLine {
                            grid,
                            row,
                            col_start,
                            cells,
                            wrap,
                        });
                    }
                }
                "grid_cursor_goto" => {
                    if params.len() >= 3 {
                        events.push(RedrawEvent::GridCursorGoto {
                            grid: params[0].as_u64().unwrap_or(1),
                            row: params[1].as_u64().unwrap_or(0),
                            col: params[2].as_u64().unwrap_or(0),
                        });
                    }
                }
                "grid_scroll" => {
                    if params.len() >= 7 {
                        events.push(RedrawEvent::GridScroll {
                            grid: params[0].as_u64().unwrap_or(1),
                            top: params[1].as_u64().unwrap_or(0),
                            bot: params[2].as_u64().unwrap_or(0),
                            left: params[3].as_u64().unwrap_or(0),
                            right: params[4].as_u64().unwrap_or(0),
                            rows: params[5].as_i64().unwrap_or(0),
                            cols: params[6].as_i64().unwrap_or(0),
                        });
                    }
                }
                "grid_destroy" => {
                    if !params.is_empty() {
                        events.push(RedrawEvent::GridDestroy {
                            grid: params[0].as_u64().unwrap_or(1),
                        });
                    }
                }
                "hl_attr_define" => {
                    if params.len() >= 2 {
                        let id = params[0].as_u64().unwrap_or(0);
                        let rgb_map: HashMap<String, Value> = params[1]
                            .as_map()
                            .map(|m| {
                                m.iter()
                                    .filter_map(|(k, v)| {
                                        k.as_str().map(|s| (s.to_string(), v.clone()))
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();

                        events.push(RedrawEvent::HlAttrDefine {
                            id,
                            rgb_attr: HlAttr::from_map(&rgb_map),
                        });
                    }
                }
                "hl_group_set" => {
                    if params.len() >= 2 {
                        events.push(RedrawEvent::HlGroupSet {
                            name: params[0].as_str().unwrap_or("").to_string(),
                            hl_id: params[1].as_u64().unwrap_or(0),
                        });
                    }
                }
                "default_colors_set" => {
                    if params.len() >= 3 {
                        events.push(RedrawEvent::DefaultColorsSet {
                            fg: params[0].as_u64().unwrap_or(0xFFFFFF) as u32,
                            bg: params[1].as_u64().unwrap_or(0x000000) as u32,
                            sp: params[2].as_u64().unwrap_or(0xFF0000) as u32,
                        });
                    }
                }
                "mode_info_set" => {
                    if params.len() >= 2 {
                        let cursor_style_enabled =
                            params[0].as_bool().unwrap_or(false);
                        let infos = params[1]
                            .as_array()
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|v| {
                                        let map = v.as_map()?;
                                        let get_str = |key: &str| -> Option<String> {
                                            map.iter()
                                                .find(|(k, _)| k.as_str() == Some(key))
                                                .and_then(|(_, v)| v.as_str())
                                                .map(|s| s.to_string())
                                        };
                                        let get_u64 = |key: &str| -> Option<u64> {
                                            map.iter()
                                                .find(|(k, _)| k.as_str() == Some(key))
                                                .and_then(|(_, v)| v.as_u64())
                                        };
                                        Some(ModeInfo {
                                            name: get_str("name").unwrap_or_default(),
                                            cursor_shape: get_str("cursor_shape"),
                                            cell_percentage: get_u64("cell_percentage"),
                                            attr_id: get_u64("attr_id"),
                                        })
                                    })
                                    .collect::<Vec<_>>()
                            })
                            .unwrap_or_default();
                        events.push(RedrawEvent::ModeInfoSet {
                            cursor_style_enabled,
                            mode_info: infos,
                        });
                    }
                }
                "mode_change" => {
                    if params.len() >= 2 {
                        events.push(RedrawEvent::ModeChange {
                            mode: params[0].as_str().unwrap_or("normal").to_string(),
                            mode_idx: params[1].as_u64().unwrap_or(0),
                        });
                    }
                }
                "set_title" => {
                    if !params.is_empty() {
                        events.push(RedrawEvent::SetTitle {
                            title: params[0].as_str().unwrap_or("").to_string(),
                        });
                    }
                }
                "set_icon" => {
                    if !params.is_empty() {
                        events.push(RedrawEvent::SetIcon {
                            icon: params[0].as_str().unwrap_or("").to_string(),
                        });
                    }
                }
                "option_set" => {
                    if params.len() >= 2 {
                        events.push(RedrawEvent::OptionSet {
                            name: params[0].as_str().unwrap_or("").to_string(),
                            value: params[1].clone(),
                        });
                    }
                }
                "flush" => {
                    events.push(RedrawEvent::Flush);
                }
                "busy_start" => events.push(RedrawEvent::BusyStart),
                "busy_stop" => events.push(RedrawEvent::BusyStop),
                "mouse_on" => events.push(RedrawEvent::MouseOn),
                "mouse_off" => events.push(RedrawEvent::MouseOff),
                "bell" => events.push(RedrawEvent::Bell),
                "visual_bell" => events.push(RedrawEvent::VisualBell),
                _ => {
                    trace!("unhandled redraw event: {}", name);
                }
            }
        }

        events
    }
}

#[async_trait::async_trait]
impl Handler for NvimHandler {
    type Writer = nvim_rs::compat::tokio::Compat<tokio::process::ChildStdin>;

    async fn handle_notify(
        &self,
        name: String,
        args: Vec<Value>,
        _neovim: nvim_rs::Neovim<Self::Writer>,
    ) {
        if name != "redraw" {
            debug!("non-redraw notification: {}", name);
            return;
        }

        let mut grid_manager = self.grid_manager.lock().await;
        let mut pending_mode_change: Option<(String, u64)> = None;
        let mut pending_title: Option<String> = None;

        // Each arg in a redraw notification is [event_name, ...params]
        for arg in &args {
            if let Some(arr) = arg.as_array() {
                if arr.is_empty() {
                    continue;
                }
                let event_name = match arr[0].as_str() {
                    Some(n) => n,
                    None => continue,
                };

                let event_args = &arr[1..];
                let events = Self::parse_redraw_event(event_name, event_args);

                for event in events {
                    match event {
                        RedrawEvent::GridResize { grid, width, height } => {
                            grid_manager.resize(grid, width, height);
                        }
                        RedrawEvent::GridClear { grid } => {
                            grid_manager.clear(grid);
                        }
                        RedrawEvent::GridLine {
                            grid,
                            row,
                            col_start,
                            cells,
                            ..
                        } => {
                            grid_manager.put_cells(grid, row, col_start, &cells);
                        }
                        RedrawEvent::GridCursorGoto { grid, row, col } => {
                            grid_manager.set_cursor(grid, row, col);
                        }
                        RedrawEvent::GridScroll {
                            grid,
                            top,
                            bot,
                            left,
                            right,
                            rows,
                            ..
                        } => {
                            grid_manager.scroll(grid, top, bot, left, right, rows);
                        }
                        RedrawEvent::GridDestroy { grid } => {
                            grid_manager.destroy(grid);
                        }
                        RedrawEvent::HlAttrDefine { id, rgb_attr } => {
                            grid_manager.set_hl_attr(id, rgb_attr);
                        }
                        RedrawEvent::DefaultColorsSet { fg, bg, sp } => {
                            grid_manager.set_default_colors(fg, bg, sp);
                            let _ = self.event_tx.send(NvimUiEvent::DefaultColorsChanged {
                                pane_id: self.pane_id.clone(),
                                fg,
                                bg,
                                sp,
                            });
                        }
                        RedrawEvent::ModeChange { mode, mode_idx } => {
                            pending_mode_change = Some((mode, mode_idx));
                        }
                        RedrawEvent::SetTitle { title } => {
                            pending_title = Some(title);
                        }
                        RedrawEvent::Flush => {
                            // Build snapshots of all dirty grids
                            let snapshots = grid_manager.take_snapshots();
                            if !snapshots.is_empty() {
                                // Collect every hl_id referenced this flush so
                                // the frontend can resolve cell colors.
                                let mut needed: std::collections::HashSet<u64> =
                                    std::collections::HashSet::new();
                                needed.insert(0);
                                for snap in snapshots.values() {
                                    for c in &snap.cells {
                                        needed.insert(c.hl_id);
                                    }
                                }

                                let mut hl_attrs: HashMap<u64, ResolvedAttr> =
                                    HashMap::new();
                                for id in needed {
                                    hl_attrs.insert(
                                        id,
                                        grid_manager.highlights.resolve(id),
                                    );
                                }

                                let default_fg = grid_manager.highlights.default_fg;
                                let default_bg = grid_manager.highlights.default_bg;
                                let default_sp = grid_manager.highlights.default_sp;

                                let _ = self.event_tx.send(NvimUiEvent::Flush {
                                    pane_id: self.pane_id.clone(),
                                    grids: snapshots
                                        .into_iter()
                                        .map(|(id, snap)| (id, snap))
                                        .collect(),
                                    hl_attrs,
                                    default_fg,
                                    default_bg,
                                    default_sp,
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // Send batched mode/title changes after processing all events
        if let Some((mode, mode_idx)) = pending_mode_change {
            let _ = self.event_tx.send(NvimUiEvent::ModeChange {
                pane_id: self.pane_id.clone(),
                mode,
                mode_idx,
            });
        }
        if let Some(title) = pending_title {
            let _ = self.event_tx.send(NvimUiEvent::TitleChanged {
                pane_id: self.pane_id.clone(),
                title,
            });
        }
    }

    async fn handle_request(
        &self,
        name: String,
        _args: Vec<Value>,
        _neovim: nvim_rs::Neovim<Self::Writer>,
    ) -> Result<Value, Value> {
        warn!("unhandled request: {}", name);
        Ok(Value::Nil)
    }
}
