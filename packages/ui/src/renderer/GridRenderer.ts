import type { CellData, GridSnapshot, ResolvedAttr } from "../bridge/types";

/** Color conversion: u32 → CSS hex */
function colorToCSS(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/** Highlight attributes resolved for rendering */
export interface RenderAttr {
  fg: string;
  bg: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

/** Default highlight attributes */
interface HlDefaults {
  fg: number;
  bg: number;
}

/**
 * Canvas 2D grid renderer for Neovim output.
 *
 * Renders a grid of character cells onto a <canvas> element.
 * Each cell is drawn with background fill + text character.
 */
export class GridRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private cellWidth: number = 0;
  private cellHeight: number = 0;
  private fontFamily: string;
  private fontSize: number;
  private dpr: number;
  private defaults: HlDefaults = { fg: 0xc0caf5, bg: 0x1a1b26 };

  // Highlight attribute cache from hl_attr_define — populated externally
  private hlAttrs: Map<number, RenderAttr> = new Map();

  constructor(canvas: HTMLCanvasElement, fontFamily: string, fontSize: number) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.fontFamily = fontFamily;
    this.fontSize = fontSize;
    this.dpr = window.devicePixelRatio || 1;

    this.measureFont();
  }

  /** Measure font to determine cell dimensions */
  private measureFont() {
    this.ctx.font = `${this.fontSize}px "${this.fontFamily}", monospace`;
    const metrics = this.ctx.measureText("M");

    this.cellWidth = Math.ceil(metrics.width);
    this.cellHeight = Math.ceil(this.fontSize * 1.5); // line height factor
  }

  /** Update default colors from Neovim */
  setDefaults(fg: number, bg: number) {
    this.defaults = { fg, bg };
  }

  /** Get cell dimensions (for calculating grid cols/rows from pixel dimensions) */
  getCellSize(): { width: number; height: number } {
    return { width: this.cellWidth, height: this.cellHeight };
  }

  /** Resize the canvas to match container dimensions */
  resize(pixelWidth: number, pixelHeight: number): { cols: number; rows: number } {
    this.dpr = window.devicePixelRatio || 1;

    this.canvas.width = pixelWidth * this.dpr;
    this.canvas.height = pixelHeight * this.dpr;
    this.canvas.style.width = `${pixelWidth}px`;
    this.canvas.style.height = `${pixelHeight}px`;

    this.ctx.scale(this.dpr, this.dpr);
    this.measureFont();

    const cols = Math.floor(pixelWidth / this.cellWidth);
    const rows = Math.floor(pixelHeight / this.cellHeight);

    return { cols, rows };
  }

  /** Render a complete grid snapshot */
  render(snapshot: GridSnapshot) {
    const { width, height, cells, cursor_row, cursor_col } = snapshot;

    // Clear canvas
    this.ctx.fillStyle = colorToCSS(this.defaults.bg);
    this.ctx.fillRect(
      0,
      0,
      this.canvas.width / this.dpr,
      this.canvas.height / this.dpr,
    );

    // Draw each cell
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const idx = row * width + col;
        const cell = cells[idx];
        if (!cell) continue;

        const x = col * this.cellWidth;
        const y = row * this.cellHeight;

        this.drawCell(x, y, cell, row === cursor_row && col === cursor_col);
      }
    }
  }

  /** Draw a single cell */
  private drawCell(
    x: number,
    y: number,
    cell: CellData,
    isCursor: boolean,
  ) {
    const attr = this.resolveAttr(cell.hl_id);

    // Background
    this.ctx.fillStyle = isCursor ? attr.fg : attr.bg;
    this.ctx.fillRect(x, y, this.cellWidth, this.cellHeight);

    // Text
    if (cell.text && cell.text !== " ") {
      const fontStyle = `${attr.italic ? "italic " : ""}${attr.bold ? "bold " : ""}${this.fontSize}px "${this.fontFamily}", monospace`;
      this.ctx.font = fontStyle;
      this.ctx.fillStyle = isCursor ? attr.bg : attr.fg;
      this.ctx.textBaseline = "top";

      // Center the glyph vertically within the cell
      const textY = y + (this.cellHeight - this.fontSize) / 2;
      this.ctx.fillText(cell.text, x, textY);
    }

    // Underline
    if (attr.underline) {
      this.ctx.strokeStyle = attr.fg;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      this.ctx.moveTo(x, y + this.cellHeight - 1);
      this.ctx.lineTo(x + this.cellWidth, y + this.cellHeight - 1);
      this.ctx.stroke();
    }

    // Strikethrough
    if (attr.strikethrough) {
      this.ctx.strokeStyle = attr.fg;
      this.ctx.lineWidth = 1;
      this.ctx.beginPath();
      const midY = y + this.cellHeight / 2;
      this.ctx.moveTo(x, midY);
      this.ctx.lineTo(x + this.cellWidth, midY);
      this.ctx.stroke();
    }
  }

  /** Resolve highlight attributes for a highlight ID */
  private resolveAttr(hlId: number): RenderAttr {
    const cached = this.hlAttrs.get(hlId);
    if (cached) return cached;

    // Default: use default colors
    return {
      fg: colorToCSS(this.defaults.fg),
      bg: colorToCSS(this.defaults.bg),
      bold: false,
      italic: false,
      underline: false,
      strikethrough: false,
    };
  }

  /** Update cached highlight attributes (called when hl_attr_define events arrive) */
  setHlAttr(id: number, attr: RenderAttr) {
    this.hlAttrs.set(id, attr);
  }

  /** Convert a Rust-side ResolvedAttr (numeric colors) into a RenderAttr. */
  setHlAttrFromResolved(id: number, attr: ResolvedAttr) {
    this.hlAttrs.set(id, {
      fg: colorToCSS(attr.fg),
      bg: colorToCSS(attr.bg),
      bold: attr.bold,
      italic: attr.italic,
      underline: attr.underline || attr.undercurl || attr.underdouble,
      strikethrough: attr.strikethrough,
    });
  }

  /** Clear all cached highlight attributes */
  clearHlAttrs() {
    this.hlAttrs.clear();
  }

  /** Update font settings */
  setFont(family: string, size: number) {
    this.fontFamily = family;
    this.fontSize = size;
    this.measureFont();
  }
}
