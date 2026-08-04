import { For, Match, Show, Switch, createSignal } from "solid-js";
import { Icon } from "../Icon";
import { updateSettings, useSettingsStore } from "../../stores/settings";

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

function Toggle(props: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button
      type="button"
      class={`switch ${props.on ? "on" : ""}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      onClick={props.onToggle}
    />
  );
}

function SettingRow(props: {
  label: string;
  description?: string;
  children: unknown;
}) {
  return (
    <div class="set-row">
      <div class="text-left">
        <div class="label">{props.label}</div>
        <Show when={props.description}><div class="desc">{props.description}</div></Show>
      </div>
      <div class="control">{props.children as any}</div>
    </div>
  );
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
              </div>
            </Match>

            <Match when={section() === "editor"}>
              <div class="set-group">
                <h3>Text editor</h3>
                <SettingRow label="Font family" description="A locally installed monospaced font works best.">
                  <input
                    class="settings-input"
                    value={settings.font_family}
                    onChange={(event) => updateSettings({ font_family: event.currentTarget.value.trim() || "monospace" })}
                  />
                </SettingRow>
                <SettingRow label="Font size" description={`${settings.font_size}px`}>
                  <input
                    class="settings-range"
                    type="range"
                    min="10"
                    max="24"
                    step="1"
                    value={settings.font_size}
                    onInput={(event) => updateSettings({ font_size: Number(event.currentTarget.value) })}
                  />
                </SettingRow>
                <SettingRow label="Line height" description={settings.line_height.toFixed(2)}>
                  <input
                    class="settings-range"
                    type="range"
                    min="1.1"
                    max="2"
                    step="0.05"
                    value={settings.line_height}
                    onInput={(event) => updateSettings({ line_height: Number(event.currentTarget.value) })}
                  />
                </SettingRow>
                <SettingRow label="Tab size">
                  <select
                    class="settings-select"
                    value={settings.tab_size}
                    onChange={(event) => updateSettings({ tab_size: Number(event.currentTarget.value) })}
                  >
                    <option value="2">2 spaces</option>
                    <option value="4">4 spaces</option>
                    <option value="8">8 spaces</option>
                  </select>
                </SettingRow>
                <SettingRow label="Word wrap" description="Wrap long lines at the editor viewport.">
                  <Toggle
                    label="Word wrap"
                    on={settings.word_wrap}
                    onToggle={() => updateSettings({ word_wrap: !settings.word_wrap })}
                  />
                </SettingRow>
              </div>
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
            </Match>

            <Match when={section() === "about"}>
              <div class="settings-about">
                <div class="welcome-logo" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 7l3-2 7 4v6l-3 2-7-4V7z" stroke="white" stroke-width="1.4" stroke-linejoin="round" />
                    <circle cx="12" cy="11" r="2" fill="white" />
                  </svg>
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
