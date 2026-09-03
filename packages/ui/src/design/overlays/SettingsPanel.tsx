import { For, Match, Show, Switch, createSignal } from "solid-js";
import { Icon } from "../Icon";
import { AppLogo } from "../AppLogo";
import { updateSettings, useSettingsStore } from "../../stores/settings";
import { DEFAULT_PIPELINE_AGENT_INSTRUCTIONS } from "../../features/pipelines/pipelineAgentDefaults";
import { EditorSettingsSection } from "./EditorSettingsSection";
import { SettingRow } from "./SettingRow";

export interface SettingsPanelProps {
  onClose: () => void;
}

type Section = "appearance" | "editor" | "agents" | "about";

const SECTIONS: Array<{ id: Section; label: string; icon: string }> = [
  { id: "appearance", label: "Appearance", icon: "minimap" },
  { id: "editor", label: "Editor", icon: "code" },
  { id: "agents", label: "Agents", icon: "bolt" },
  { id: "about", label: "About", icon: "settings" },
];

const THEMES = ["tokyonight", "catppuccin", "rosepine"] as const;
const DENSITIES = ["compact", "comfortable", "spacious"] as const;

function themePreview(theme: string) {
  if (theme === "tokyonight") return "linear-gradient(135deg, #1a1b26, #7aa2f7)";
  if (theme === "catppuccin") return "linear-gradient(135deg, #1e1e2e, #cba6f7)";
  return "linear-gradient(135deg, #1f1d2e, #c4a7e7)";
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [section, setSection] = createSignal<Section>("appearance");
  const { settings, error } = useSettingsStore();

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay settings" data-screen-label="Settings">
        <div class="settings-nav">
          <h4>Code Engine</h4>
          <For each={SECTIONS}>
            {(item) => (
              <button
                type="button"
                class={`nav-item ${section() === item.id ? "active" : ""}`}
                onClick={() => setSection(item.id)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </button>
            )}
          </For>
        </div>

        <div class="settings-body">
          <div class="settings-titlebar">
            <div>
              <h2>{SECTIONS.find((item) => item.id === section())?.label}</h2>
              <div class="sub">Changes are saved automatically.</div>
            </div>
            <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Close settings">
              <Icon name="close" />
            </button>
          </div>

          <Show when={error()}>{(message) => <div class="settings-error">{message()}</div>}</Show>

          <Switch>
            <Match when={section() === "appearance"}>
              <div class="set-group">
                <h3>Theme</h3>
                <SettingRow label="Color palette" description="Applied to editor chrome and agent surfaces.">
                  <div class="color-chips">
                    <For each={THEMES as readonly string[]}>
                      {(theme) => (
                        <button
                          type="button"
                          class={`color-chip ${settings.theme === theme ? "on" : ""}`}
                          onClick={() => updateSettings({ theme })}
                          title={theme}
                          aria-label={`Use ${theme} theme`}
                          style={{ background: themePreview(theme) }}
                        />
                      )}
                    </For>
                  </div>
                </SettingRow>
                <SettingRow label="Chrome density" description="Controls title, tab, breadcrumb, and status height.">
                  <div class="seg">
                    <For each={DENSITIES as readonly string[]}>
                      {(density) => (
                        <button
                          type="button"
                          class={settings.density === density ? "on" : ""}
                          onClick={() => updateSettings({ density })}
                        >
                          {density[0].toUpperCase() + density.slice(1)}
                        </button>
                      )}
                    </For>
                  </div>
                </SettingRow>
                <SettingRow
                  label="Interface text size"
                  description={`${settings.ui_font_size}px base · navigation, agents, pipelines, and dialogs.`}
                >
                  <input
                    class="settings-range"
                    type="range"
                    min="10"
                    max="18"
                    step="1"
                    value={settings.ui_font_size}
                    aria-label="Interface text size"
                    onInput={(event) => updateSettings({ ui_font_size: Number(event.currentTarget.value) })}
                  />
                </SettingRow>
              </div>
            </Match>

            <Match when={section() === "editor"}>
              <EditorSettingsSection settings={settings} />
            </Match>

            <Match when={section() === "agents"}>
              <div class="set-group">
                <h3>Codex runtime</h3>
                <SettingRow
                  label="Codex binary"
                  description="Leave blank to auto-detect Codex from PATH, Homebrew, or standard install locations."
                >
                  <input
                    class="settings-input wide"
                    value={settings.codex_path ?? ""}
                    placeholder="Auto-detect"
                    onChange={(event) => updateSettings({ codex_path: event.currentTarget.value.trim() || null })}
                  />
                </SettingRow>
                <div class="settings-note">
                  Authentication is owned by Codex. Code Engine never stores your ChatGPT tokens or API keys.
                  Restart the Agents runtime after changing this path.
                </div>
              </div>
              <div class="set-group">
                <div class="settings-group-titlebar">
                  <h3>Pipeline agents</h3>
                  <button
                    type="button"
                    class="settings-reset"
                    onClick={() => updateSettings({
                      pipeline_agent_instructions: DEFAULT_PIPELINE_AGENT_INSTRUCTIONS,
                    })}
                  >
                    Reset default
                  </button>
                </div>
                <label class="settings-field">
                  <span>Global pipeline instructions</span>
                  <small>
                    Added to every pipeline agent. The current graph, other step purposes,
                    and direct connections are supplied automatically for each run.
                  </small>
                  <textarea
                    class="settings-textarea"
                    value={settings.pipeline_agent_instructions}
                    maxLength={16_000}
                    rows={9}
                    onInput={(event) => updateSettings({
                      pipeline_agent_instructions: event.currentTarget.value,
                    })}
                  />
                </label>
                <div class="settings-note">
                  Stage instructions remain local to each template node. Global instructions
                  describe how every agent should behave as part of a pipeline.
                </div>
              </div>
            </Match>

            <Match when={section() === "about"}>
              <div class="settings-about">
                <div class="welcome-logo" aria-hidden="true">
                  <AppLogo />
                </div>
                <h2>Code Engine</h2>
                <p>Version 1.0.0</p>
                <span>A focused local editor with first-class Codex agents.</span>
              </div>
            </Match>
          </Switch>
        </div>
      </div>
    </>
  );
}
