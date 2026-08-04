import { startWindowDrag, titlebarDoubleClick } from "../bridge/tauri";

const INTERACTIVE_TITLEBAR_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "summary",
  "[role='button']",
  ".icon-btn",
  ".tab",
  ".tab-new",
  ".page-pill",
  ".project-badge",
  ".project-menu",
].join(", ");

function isInteractiveTitlebarTarget(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest(INTERACTIVE_TITLEBAR_SELECTOR);
}

let doubleClickStart: { x: number; y: number } | null = null;

// macOS titlebars drag on the first mousedown, but defer double-click zoom
// until mouseup so a small drag cancels the zoom instead of racing it.
export function handleTitlebarMouseDown(event: MouseEvent) {
  if (event.button !== 0 || isInteractiveTitlebarTarget(event.target)) {
    return;
  }

  if (event.detail === 2) {
    doubleClickStart = { x: event.clientX, y: event.clientY };
    return;
  }

  if (event.detail !== 1 || event.buttons !== 1) return;

  event.preventDefault();
  startWindowDrag().catch((err) =>
    console.warn("[CE] startWindowDrag failed:", err),
  );
}

export function handleTitlebarMouseUp(event: MouseEvent) {
  if (event.button !== 0 || event.detail !== 2 || isInteractiveTitlebarTarget(event.target)) {
    doubleClickStart = null;
    return;
  }

  const start = doubleClickStart;
  doubleClickStart = null;
  if (!start) return;

  const movedX = Math.abs(event.clientX - start.x);
  const movedY = Math.abs(event.clientY - start.y);
  if (movedX > 2 || movedY > 2) return;

  event.preventDefault();
  titlebarDoubleClick().catch((err) =>
    console.warn("[CE] titlebarDoubleClick failed:", err),
  );
}
