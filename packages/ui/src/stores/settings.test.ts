import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "../bridge/types";
import { saveSettings } from "../bridge/tauri";
import { flushSettings, settingsStyleProperties, updateSettings } from "./settings";
import { DEFAULT_PIPELINE_AGENT_INSTRUCTIONS } from "../features/pipelines/pipelineAgentDefaults";

vi.mock("../bridge/tauri", () => ({
  getSettings: vi.fn(),
  saveSettings: vi.fn(() => Promise.resolve()),
}));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function appSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
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
    ...overrides,
  };
}

describe("settingsStyleProperties", () => {
  it("maps the default interface size to the root typography size", () => {
    expect(settingsStyleProperties(appSettings())).toMatchObject({
      "--ui-font-size": "13px",
      "--editor-font-size": "14px",
      "--editor-line-height": "1.5",
    });
  });

  it("keeps interface and editor text sizes independent", () => {
    const properties = settingsStyleProperties(appSettings({
      ui_font_size: 18,
      font_size: 11,
      line_height: 1.7,
    }));

    expect(properties["--ui-font-size"]).toBe("18px");
    expect(properties["--editor-font-size"]).toBe("11px");
    expect(properties["--editor-line-height"]).toBe("1.7");
  });

  it("applies and persists interface text-size updates", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);
    const setProperty = vi.fn();
    vi.stubGlobal("document", {
      documentElement: {
        setAttribute: vi.fn(),
        removeAttribute: vi.fn(),
        style: {
          removeProperty: vi.fn(),
          setProperty,
        },
      },
    });

    updateSettings({ ui_font_size: 17 });

    expect(setProperty).toHaveBeenCalledWith("--ui-font-size", "17px");
    await vi.advanceTimersByTimeAsync(180);
    expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(
      expect.objectContaining({ ui_font_size: 17 }),
    );
  });

  it("flushes pending native settings before the autosave delay", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("window", globalThis);

    updateSettings({ lsp_enabled: true });
    await flushSettings();

    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(saveSettings)).toHaveBeenCalledWith(
      expect.objectContaining({ lsp_enabled: true }),
    );
    await vi.advanceTimersByTimeAsync(180);
    expect(vi.mocked(saveSettings)).toHaveBeenCalledTimes(1);
  });
});
