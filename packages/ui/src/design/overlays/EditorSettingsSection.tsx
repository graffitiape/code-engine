import { EDITOR_THEME_OPTIONS } from "../../components/editor/editorThemes";
import type { AppSettings } from "../../bridge/types";
import { updateSettings } from "../../stores/settings";
import { Select } from "../forms/Select";
import { LspSettingsSection } from "./LspSettingsSection";
import { SettingRow } from "./SettingRow";
import { SettingsToggle } from "./SettingsToggle";

export interface EditorSettingsSectionProps {
  settings: AppSettings;
}

export function EditorSettingsSection(props: EditorSettingsSectionProps) {
  return (
    <>
      <div class="set-group">
        <h3>Text editor</h3>
        <SettingRow label="Color theme" description="Controls editor colors and syntax highlighting.">
          <Select
            class="settings-select"
            value={props.settings.editor_theme}
            options={EDITOR_THEME_OPTIONS}
            onChange={(editor_theme) => updateSettings({ editor_theme })}
            ariaLabel="Editor color theme"
          />
        </SettingRow>
        <SettingRow label="Font family" description="A locally installed monospaced font works best.">
          <input
            class="settings-input"
            value={props.settings.font_family}
            aria-label="Editor font family"
            onChange={(event) => updateSettings({
              font_family: event.currentTarget.value.trim() || "monospace",
            })}
          />
        </SettingRow>
        <SettingRow label="Font size" description={`${props.settings.font_size}px`}>
          <input
            class="settings-range"
            type="range"
            min="10"
            max="24"
            step="1"
            value={props.settings.font_size}
            aria-label="Editor font size"
            onInput={(event) => updateSettings({ font_size: Number(event.currentTarget.value) })}
          />
        </SettingRow>
        <SettingRow label="Line height" description={props.settings.line_height.toFixed(2)}>
          <input
            class="settings-range"
            type="range"
            min="1.1"
            max="2"
            step="0.05"
            value={props.settings.line_height}
            aria-label="Editor line height"
            onInput={(event) => updateSettings({ line_height: Number(event.currentTarget.value) })}
          />
        </SettingRow>
        <SettingRow label="Tab size">
          <Select
            class="settings-select"
            value={String(props.settings.tab_size)}
            options={[
              { value: "2", label: "2 spaces" },
              { value: "4", label: "4 spaces" },
              { value: "8", label: "8 spaces" },
            ]}
            onChange={(value) => updateSettings({ tab_size: Number(value) })}
            ariaLabel="Editor tab size"
          />
        </SettingRow>
        <SettingRow label="Word wrap" description="Wrap long lines at the editor viewport.">
          <SettingsToggle
            label="Word wrap"
            on={props.settings.word_wrap}
            onToggle={() => updateSettings({ word_wrap: !props.settings.word_wrap })}
          />
        </SettingRow>
      </div>

      <LspSettingsSection settings={props.settings} />
    </>
  );
}
