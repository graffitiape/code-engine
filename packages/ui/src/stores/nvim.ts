import { createSignal, createEffect } from "solid-js";
import { createStore, produce } from "solid-js/store";
import type { GridSnapshot, NvimUiEvent } from "../bridge/types";
import { onNvimEvent } from "../bridge/channel";

export interface PaneState {
  paneId: string;
  grids: Record<string, GridSnapshot>;
  mode: string;
  modeIdx: number;
  title: string;
  defaultFg: number;
  defaultBg: number;
  defaultSp: number;
}

interface NvimStore {
  panes: Record<string, PaneState>;
  activePaneId: string | null;
}

const [store, setStore] = createStore<NvimStore>({
  panes: {},
  activePaneId: null,
});

/** Initialize a pane in the store */
export function initPane(paneId: string) {
  setStore("panes", paneId, {
    paneId,
    grids: {},
    mode: "normal",
    modeIdx: 0,
    title: "",
    defaultFg: 0xc0caf5,
    defaultBg: 0x1a1b26,
    defaultSp: 0xff0000,
  });
}

/** Set the active pane */
export function setActivePaneId(paneId: string) {
  setStore("activePaneId", paneId);
}

/** Remove a pane from the store */
export function removePane(paneId: string) {
  setStore(
    produce((s) => {
      delete s.panes[paneId];
      if (s.activePaneId === paneId) {
        const remaining = Object.keys(s.panes);
        s.activePaneId = remaining.length > 0 ? remaining[0] : null;
      }
    }),
  );
}

/** Process an incoming NvimUiEvent */
export function handleNvimEvent(event: NvimUiEvent) {
  const paneId = event.pane_id;

  // Auto-init pane if it doesn't exist yet (events can arrive before initPane)
  if (!store.panes[paneId]) {
    console.log("[CE] auto-init pane from event:", paneId);
    initPane(paneId);
  }

  switch (event.type) {
    case "Flush":
      console.log("[CE] Flush for pane:", paneId, "grids:", Object.keys(event.grids));
      setStore("panes", paneId, "grids", event.grids);
      break;
    case "ModeChange":
      setStore("panes", paneId, "mode", event.mode);
      setStore("panes", paneId, "modeIdx", event.mode_idx);
      break;
    case "DefaultColorsChanged":
      setStore("panes", paneId, "defaultFg", event.fg);
      setStore("panes", paneId, "defaultBg", event.bg);
      setStore("panes", paneId, "defaultSp", event.sp);
      break;
    case "TitleChanged":
      setStore("panes", paneId, "title", event.title);
      break;
  }
}

/** Start listening for nvim events */
export async function startNvimEventListener() {
  await onNvimEvent(handleNvimEvent);
}

/** Get the store (read-only access) */
export function useNvimStore() {
  return store;
}

/** Get the active pane state */
export function useActivePane(): () => PaneState | undefined {
  return () => {
    const id = store.activePaneId;
    return id ? store.panes[id] : undefined;
  };
}
