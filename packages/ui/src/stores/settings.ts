import { createStore } from "solid-js/store";
import type { AppSettings } from "../bridge/types";

const [settingsStore, setSettingsStore] = createStore<AppSettings>({
  font_family: "JetBrains Mono",
  font_size: 14,
  line_height: 1.5,
  opacity: 1.0,
  blur: false,
  nvim_path: null,
});

export function updateSettings(settings: Partial<AppSettings>) {
  setSettingsStore(settings);
}

export function useSettingsStore() {
  return settingsStore;
}
