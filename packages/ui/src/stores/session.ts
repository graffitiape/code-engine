import { createStore } from "solid-js/store";

interface SessionStore {
  windows: WindowState[];
  activeWindowIndex: number;
}

interface WindowState {
  id: string;
  name: string;
  paneIds: string[];
  activePaneId: string;
}

const [sessionStore, setSessionStore] = createStore<SessionStore>({
  windows: [],
  activeWindowIndex: 0,
});

export function addWindow(id: string, name: string, paneId: string) {
  setSessionStore("windows", (windows) => [
    ...windows,
    { id, name, paneIds: [paneId], activePaneId: paneId },
  ]);
}

export function setActiveWindow(index: number) {
  setSessionStore("activeWindowIndex", index);
}

export function useSessionStore() {
  return sessionStore;
}
