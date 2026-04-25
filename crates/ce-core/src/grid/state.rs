use std::collections::HashMap;

use crate::nvim::handler::{CellData, GridSnapshot};
use crate::nvim::protocol::{GridCell, HlAttr};

use super::highlight::HighlightTable;

/// A single cell in the grid
#[derive(Debug, Clone)]
struct Cell {
    text: String,
    hl_id: u64,
}

impl Default for Cell {
    fn default() -> Self {
        Self {
            text: " ".to_string(),
            hl_id: 0,
        }
    }
}

/// State for a single grid
#[derive(Debug)]
struct Grid {
    width: u64,
    height: u64,
    cells: Vec<Vec<Cell>>,
    cursor_row: u64,
    cursor_col: u64,
    dirty: bool,
}

impl Grid {
    fn new(width: u64, height: u64) -> Self {
        let cells = (0..height)
            .map(|_| (0..width).map(|_| Cell::default()).collect())
            .collect();
        Self {
            width,
            height,
            cells,
            cursor_row: 0,
            cursor_col: 0,
            dirty: true,
        }
    }

    fn resize(&mut self, width: u64, height: u64) {
        let mut new_cells: Vec<Vec<Cell>> = (0..height)
            .map(|_| (0..width).map(|_| Cell::default()).collect())
            .collect();

        // Copy existing content
        let copy_rows = std::cmp::min(self.height, height) as usize;
        let copy_cols = std::cmp::min(self.width, width) as usize;
        for row in 0..copy_rows {
            for col in 0..copy_cols {
                new_cells[row][col] = self.cells[row][col].clone();
            }
        }

        self.width = width;
        self.height = height;
        self.cells = new_cells;
        self.dirty = true;
    }

    fn clear(&mut self) {
        for row in &mut self.cells {
            for cell in row {
                *cell = Cell::default();
            }
        }
        self.dirty = true;
    }

    fn put_cells(&mut self, row: u64, col_start: u64, cells: &[GridCell]) {
        let row_idx = row as usize;
        if row_idx >= self.cells.len() {
            return;
        }

        let mut col = col_start as usize;
        for cell in cells {
            for _ in 0..cell.repeat {
                if col < self.cells[row_idx].len() {
                    self.cells[row_idx][col] = Cell {
                        text: cell.text.clone(),
                        hl_id: cell.hl_id,
                    };
                    col += 1;
                }
            }
        }
        self.dirty = true;
    }

    fn scroll(&mut self, top: u64, bot: u64, left: u64, right: u64, rows: i64) {
        let top = top as usize;
        let bot = bot as usize;
        let left = left as usize;
        let right = right as usize;

        if rows > 0 {
            // Scroll up: move rows upward
            let rows = rows as usize;
            for r in top..(bot.saturating_sub(rows)) {
                let src = r + rows;
                if src < bot && src < self.cells.len() && r < self.cells.len() {
                    for c in left..right.min(self.cells[r].len()) {
                        self.cells[r][c] = self.cells[src][c].clone();
                    }
                }
            }
            // Clear the newly revealed rows at the bottom
            for r in bot.saturating_sub(rows)..bot {
                if r < self.cells.len() {
                    for c in left..right.min(self.cells[r].len()) {
                        self.cells[r][c] = Cell::default();
                    }
                }
            }
        } else if rows < 0 {
            // Scroll down: move rows downward
            let rows = (-rows) as usize;
            for r in (top + rows..bot).rev() {
                let src = r - rows;
                if src >= top && src < self.cells.len() && r < self.cells.len() {
                    for c in left..right.min(self.cells[r].len()) {
                        self.cells[r][c] = self.cells[src][c].clone();
                    }
                }
            }
            // Clear the newly revealed rows at the top
            for r in top..top + rows {
                if r < self.cells.len() {
                    for c in left..right.min(self.cells[r].len()) {
                        self.cells[r][c] = Cell::default();
                    }
                }
            }
        }
        self.dirty = true;
    }

    fn snapshot(&self) -> GridSnapshot {
        let cells = self
            .cells
            .iter()
            .flat_map(|row| {
                row.iter().map(|cell| CellData {
                    text: cell.text.clone(),
                    hl_id: cell.hl_id,
                })
            })
            .collect();

        GridSnapshot {
            width: self.width,
            height: self.height,
            cells,
            cursor_row: self.cursor_row,
            cursor_col: self.cursor_col,
            dirty: self.dirty,
        }
    }
}

/// Manages all grids for a Neovim instance
pub struct GridManager {
    grids: HashMap<u64, Grid>,
    pub highlights: HighlightTable,
}

impl GridManager {
    pub fn new() -> Self {
        Self {
            grids: HashMap::new(),
            highlights: HighlightTable::new(),
        }
    }

    pub fn resize(&mut self, grid_id: u64, width: u64, height: u64) {
        match self.grids.get_mut(&grid_id) {
            Some(grid) => grid.resize(width, height),
            None => {
                self.grids.insert(grid_id, Grid::new(width, height));
            }
        }
    }

    pub fn clear(&mut self, grid_id: u64) {
        if let Some(grid) = self.grids.get_mut(&grid_id) {
            grid.clear();
        }
    }

    pub fn put_cells(&mut self, grid_id: u64, row: u64, col_start: u64, cells: &[GridCell]) {
        if let Some(grid) = self.grids.get_mut(&grid_id) {
            grid.put_cells(row, col_start, cells);
        }
    }

    pub fn set_cursor(&mut self, grid_id: u64, row: u64, col: u64) {
        if let Some(grid) = self.grids.get_mut(&grid_id) {
            grid.cursor_row = row;
            grid.cursor_col = col;
            grid.dirty = true;
        }
    }

    pub fn scroll(&mut self, grid_id: u64, top: u64, bot: u64, left: u64, right: u64, rows: i64) {
        if let Some(grid) = self.grids.get_mut(&grid_id) {
            grid.scroll(top, bot, left, right, rows);
        }
    }

    pub fn destroy(&mut self, grid_id: u64) {
        self.grids.remove(&grid_id);
    }

    pub fn set_hl_attr(&mut self, id: u64, attr: HlAttr) {
        self.highlights.set(id, attr);
        // Mark all grids dirty when highlight changes
        for grid in self.grids.values_mut() {
            grid.dirty = true;
        }
    }

    pub fn set_default_colors(&mut self, fg: u32, bg: u32, sp: u32) {
        self.highlights.set_defaults(fg, bg, sp);
        for grid in self.grids.values_mut() {
            grid.dirty = true;
        }
    }

    /// Take snapshots of all dirty grids and mark them clean
    pub fn take_snapshots(&mut self) -> HashMap<u64, GridSnapshot> {
        let mut snapshots = HashMap::new();
        for (&id, grid) in &mut self.grids {
            if grid.dirty {
                snapshots.insert(id, grid.snapshot());
                grid.dirty = false;
            }
        }
        snapshots
    }
}
