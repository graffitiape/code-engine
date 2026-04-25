/** Cell data from Neovim grid */
export interface CellData {
  text: string;
  hl_id: number;
}

/** Snapshot of a grid at flush time */
export interface GridSnapshot {
  width: number;
  height: number;
  cells: CellData[];
  cursor_row: number;
  cursor_col: number;
  dirty: boolean;
}

/** Resolved highlight attributes for rendering */
export interface ResolvedAttr {
  fg: number;
  bg: number;
  sp: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  undercurl: boolean;
  underdouble: boolean;
  underdotted: boolean;
  underdashed: boolean;
  strikethrough: boolean;
}

/** UI events from the Neovim backend */
export type NvimUiEvent =
  | {
      type: "Flush";
      pane_id: string;
      grids: Record<string, GridSnapshot>;
      hl_attrs: Record<string, ResolvedAttr>;
      default_fg: number;
      default_bg: number;
      default_sp: number;
    }
  | {
      type: "ModeChange";
      pane_id: string;
      mode: string;
      mode_idx: number;
    }
  | {
      type: "DefaultColorsChanged";
      pane_id: string;
      fg: number;
      bg: number;
      sp: number;
    }
  | {
      type: "TitleChanged";
      pane_id: string;
      title: string;
    };

/** App settings */
export interface AppSettings {
  font_family: string;
  font_size: number;
  line_height: number;
  opacity: number;
  blur: boolean;
  nvim_path: string | null;
}
