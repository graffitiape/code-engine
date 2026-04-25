import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { NvimUiEvent } from "./types";

type EventHandler = (event: NvimUiEvent) => void;

/** Listen for all Neovim UI events */
export async function onNvimEvent(handler: EventHandler): Promise<UnlistenFn> {
  return listen<NvimUiEvent>("nvim:event", (event) => {
    handler(event.payload);
  });
}

/** Listen for flush events on a specific pane */
export async function onPaneFlush(
  paneId: string,
  handler: (event: NvimUiEvent & { type: "Flush" }) => void,
): Promise<UnlistenFn> {
  return listen<NvimUiEvent>(`nvim:flush:${paneId}`, (event) => {
    if (event.payload.type === "Flush") {
      handler(event.payload);
    }
  });
}

/** Listen for mode changes on a specific pane */
export async function onPaneModeChange(
  paneId: string,
  handler: (mode: string, modeIdx: number) => void,
): Promise<UnlistenFn> {
  return listen<NvimUiEvent>(`nvim:mode:${paneId}`, (event) => {
    if (event.payload.type === "ModeChange") {
      handler(event.payload.mode, event.payload.mode_idx);
    }
  });
}
