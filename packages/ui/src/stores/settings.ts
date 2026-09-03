import { createSignal } from "solid-js";
import { createStore } from "solid-js/store";
import { getSettings, saveSettings } from "../bridge/tauri";
import type { AppSettings } from "../bridge/types";
import { DEFAULT_PIPELINE_AGENT_INSTRUCTIONS } from "../features/pipelines/pipelineAgentDefaults";

const defaults: AppSettings = {
  theme: "tokyonight",
  editor_theme: "match-interface",
  density: "compact",
  app_zoom: 1,
  ui_font_size: 13,
  font_family: "JetBrains Mono",
  font_size: 14,
  line_height: 1.5,
  word_wrap: false,
  tab_size: 2,
  lsp_enabled: false,
  lsp_servers: ["typescript", "rust", "python", "json", "css", "html"].map((id) => ({
    id,
    enabled: true,
    executable: null,
  })),
  codex_path: null,
  pipeline_agent_instructions: DEFAULT_PIPELINE_AGENT_INSTRUCTIONS,
};

const [settingsStore, setSettingsStore] = createStore<AppSettings>({ ...defaults });
const [settingsReady, setSettingsReady] = createSignal(false);
const [settingsError, setSettingsError] = createSignal<string | null>(null);

let initializePromise: Promise<AppSettings> | null = null;
let saveTimer: number | undefined;
let settingsDirty = false;
let saveChain: Promise<void> = Promise.resolve();

export function settingsStyleProperties(settings: AppSettings) {
  return {
    "--font-mono": `"${settings.font_family}", "SF Mono", monospace`,
    "--ui-font-size": `${settings.ui_font_size}px`,
    "--editor-font-size": `${settings.font_size}px`,
    "--editor-line-height": String(settings.line_height),
  };
}

function applyToDocument(settings: AppSettings) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.setAttribute("data-theme", settings.theme);
  root.setAttribute("data-density", settings.density);
  root.removeAttribute("data-vibrancy");
  root.style.removeProperty("--window-opacity");
  for (const [property, value] of Object.entries(settingsStyleProperties(settings))) {
    root.style.setProperty(property, value);
  }
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

  settingsDirty = true;
  if (saveTimer !== undefined) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void persistPendingSettings().catch(() => {
      // The visible settings error is set by persistPendingSettings. A later
      // update or explicit flush retries the current in-memory settings.
    });
  }, 180);
}

function persistPendingSettings(): Promise<void> {
  if (!settingsDirty) return saveChain;
  settingsDirty = false;
  const snapshot = { ...settingsStore };
  const save = saveChain
    .catch(() => undefined)
    .then(() => saveSettings(snapshot))
    .then(() => {
      setSettingsError(null);
    })
    .catch((error) => {
      settingsDirty = true;
      setSettingsError(error instanceof Error ? error.message : String(error));
      throw error;
    });
  saveChain = save;
  return save;
}

/** Persist pending settings before a native subsystem reads its own config file. */
export function flushSettings(): Promise<void> {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  return persistPendingSettings();
}

export function useSettingsStore() {
  return {
    settings: settingsStore,
    ready: settingsReady,
    error: settingsError,
  };
}
