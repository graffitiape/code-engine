import { nvimInput } from "../bridge/tauri";

/** GUI-level shortcuts that should NOT be forwarded to Neovim */
const GUI_SHORTCUTS: Record<string, string> = {
  "meta+t": "new-tab",
  "meta+w": "close-pane",
  "meta+shift+p": "command-palette",
  "meta+,": "settings",
  "meta+1": "tab-1",
  "meta+2": "tab-2",
  "meta+3": "tab-3",
  "meta+4": "tab-4",
  "meta+5": "tab-5",
  "meta+6": "tab-6",
  "meta+7": "tab-7",
  "meta+8": "tab-8",
  "meta+9": "tab-9",
  "meta+shift+h": "split-horizontal",
  "meta+shift+v": "split-vertical",
  "meta+]": "focus-next-pane",
  "meta+[": "focus-prev-pane",
};

export type GuiAction = string;
export type GuiActionHandler = (action: GuiAction) => void;

/**
 * Keyboard input handler that captures key events and routes them
 * either to GUI actions or to a Neovim instance.
 */
export class KeyHandler {
  private paneId: string | null = null;
  private guiHandler: GuiActionHandler | null = null;
  private element: HTMLElement;

  constructor(element: HTMLElement) {
    this.element = element;
    this.element.addEventListener("keydown", this.onKeyDown);
  }

  /** Set the active pane to send input to */
  setActivePane(paneId: string) {
    this.paneId = paneId;
  }

  /** Set handler for GUI-level actions */
  onGuiAction(handler: GuiActionHandler) {
    this.guiHandler = handler;
  }

  /** Clean up event listeners */
  destroy() {
    this.element.removeEventListener("keydown", this.onKeyDown);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Build shortcut key for GUI check
    const shortcutParts: string[] = [];
    if (e.metaKey) shortcutParts.push("meta");
    if (e.ctrlKey) shortcutParts.push("ctrl");
    if (e.altKey) shortcutParts.push("alt");
    if (e.shiftKey) shortcutParts.push("shift");
    shortcutParts.push(e.key.toLowerCase());
    const shortcutKey = shortcutParts.join("+");

    // Check for GUI shortcuts first
    const guiAction = GUI_SHORTCUTS[shortcutKey];
    if (guiAction) {
      e.preventDefault();
      e.stopPropagation();
      this.guiHandler?.(guiAction);
      return;
    }

    // Encode and send to Neovim
    const encoded = this.encodeKey(e);
    if (encoded && this.paneId) {
      e.preventDefault();
      e.stopPropagation();
      nvimInput(this.paneId, encoded).catch((err) => {
        console.error("failed to send input:", err);
      });
    }
  };

  /** Encode a KeyboardEvent into Neovim's key notation */
  private encodeKey(e: KeyboardEvent): string | null {
    const key = e.key;

    // Ignore modifier-only keys
    if (
      key === "Shift" ||
      key === "Control" ||
      key === "Alt" ||
      key === "Meta" ||
      key === "CapsLock" ||
      key === "NumLock"
    ) {
      return null;
    }

    // Map special keys
    const specialMap: Record<string, string> = {
      Escape: "Esc",
      Enter: "CR",
      Backspace: "BS",
      Tab: "Tab",
      Delete: "Del",
      " ": "Space",
      ArrowUp: "Up",
      ArrowDown: "Down",
      ArrowLeft: "Left",
      ArrowRight: "Right",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      Insert: "Insert",
      F1: "F1",
      F2: "F2",
      F3: "F3",
      F4: "F4",
      F5: "F5",
      F6: "F6",
      F7: "F7",
      F8: "F8",
      F9: "F9",
      F10: "F10",
      F11: "F11",
      F12: "F12",
    };

    const base = specialMap[key] ?? key;
    const isSpecial = base !== key || base.length > 1;

    const hasModifier =
      e.ctrlKey ||
      e.altKey ||
      e.metaKey ||
      (e.shiftKey && isSpecial);

    if (hasModifier) {
      let mods = "";
      if (e.shiftKey && isSpecial) mods += "S-";
      if (e.ctrlKey) mods += "C-";
      if (e.altKey) mods += "M-";
      if (e.metaKey) mods += "D-";
      return `<${mods}${base}>`;
    }

    if (isSpecial) {
      return `<${base}>`;
    }

    // Plain character
    return base;
  }
}
