/** Cursor shape types from Neovim */
export type CursorShape = "block" | "horizontal" | "vertical";

/** Parse cursor shape from Neovim mode info */
export function parseCursorShape(shape?: string): CursorShape {
  switch (shape) {
    case "horizontal":
      return "horizontal";
    case "vertical":
      return "vertical";
    default:
      return "block";
  }
}
