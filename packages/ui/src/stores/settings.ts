import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { getSettings, saveSettings } from "../bridge/tauri";
import type { AppSettings } from "../bridge/types";

const defaults: AppSettings = {
  theme: "tokyonight",
  density: "compact",
  font_family: "JetBrains Mono",
  font_size: 14,
  line_height: 1.5,
  word_wrap: false,
  tab_size: 2,
  codex_path: null,
};

const [settingsStore, setSettingsStore] = createStore<AppSettings>({ ...defaults });
const [settingsReady, setSettingsReady] = createSignal(false);
const [settingsError, setSettingsError] = createSignal<string | null>(null);

let initializePromise: Promise<AppSettings> | null = null;
let saveTimer: number | undefined;

function applyToDocument(settings: AppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme);
  root.setAttribute("data-density", settings.density);
  root.removeAttribute("data-vibrancy");
  root.style.removeProperty("--window-opacity");
  root.style.setProperty("--font-mono", `"${settings.font_family}", "SF Mono", monospace`);
  root.style.setProperty("--editor-font-size", `${settings.font_size}px`);
  root.style.setProperty("--editor-line-height", String(settings.line_height));
}

export function initializeSettings(): Promise<AppSettings> {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    try {
      const loaded = await getSettings();
      const merged = { ...defaults, ...loaded };
      setSettingsStore(merged);
      applyToDocument(merged);
      setSettingsReady(true);
      return merged;
    } catch (error) {
      // Vite's browser-only preview has no Tauri IPC. Defaults keep it usable.
      const message = error instanceof Error ? error.message : String(error);
      setSettingsError(message);
      applyToDocument(settingsStore);
      setSettingsReady(true);
      return { ...settingsStore };
    }
  })();
  return initializePromise;
}

export function updateSettings(settings: Partial<AppSettings>, persist = true) {
  setSettingsStore(settings);
  applyToDocument(settingsStore);
  if (!persist) return;

  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveSettings({ ...settingsStore })
      .then(() => setSettingsError(null))
      .catch((error) => {
        setSettingsError(error instanceof Error ? error.message : String(error));
      });
  }, 180);
}

export function useSettingsStore() {
  return {
    settings: settingsStore,
    ready: settingsReady,
    error: settingsError,
  };
}
