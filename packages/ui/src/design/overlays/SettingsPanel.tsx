// Settings overlay — Appearance, Editor, and Neovim sections.

import { For, createSignal } from 'solid-js';
import type { SettingsShape } from '../types';
import { Icon } from '../Icon';

export interface SettingsPanelProps {
  onClose: () => void;
  settings: SettingsShape;
  setSettings: (updater: (s: SettingsShape) => SettingsShape) => void;
}

const NAV_PREFS = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'editor', label: 'Editor' },
  { id: 'nvim', label: 'Neovim' },
  { id: 'panes', label: 'Panes & Tabs' },
  { id: 'keys', label: 'Keybindings' },
];

const NAV_SYS = [
  { id: 'plugins', label: 'Plugins' },
  { id: 'updates', label: 'Updates' },
  { id: 'about', label: 'About' },
];

const THEMES = ['tokyonight', 'catppuccin', 'rosepine'] as const;
const DENSITIES = ['compact', 'comfortable', 'spacious'] as const;

function chipBg(t: string) {
  if (t === 'tokyonight') return 'linear-gradient(135deg, #1a1b26, #7aa2f7)';
  if (t === 'catppuccin') return 'linear-gradient(135deg, #1e1e2e, #cba6f7)';
  return 'linear-gradient(135deg, #1f1d2e, #c4a7e7)';
}

export function SettingsPanel(props: SettingsPanelProps) {
  const [section, setSection] = createSignal('appearance');
  const update = (k: string, v: unknown) =>
    props.setSettings((s) => ({ ...s, [k]: v }));

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay settings" data-screen-label="Settings">
        <div class="settings-nav">
          <h4>Preferences</h4>
          <For each={NAV_PREFS}>
            {(s) => (
              <div
                class={`nav-item ${section() === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <Icon name="settings" />
                <span>{s.label}</span>
              </div>
            )}
          </For>
          <h4 style={{ 'margin-top': '14px' }}>System</h4>
          <For each={NAV_SYS}>
            {(s) => (
              <div
                class={`nav-item ${section() === s.id ? 'active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                <Icon name="settings" />
                <span>{s.label}</span>
              </div>
            )}
          </For>
        </div>
        <div class="settings-body">
          <h2>Appearance</h2>
          <div class="sub">
            Chrome styling. Neovim-rendered surfaces are controlled by your colorscheme and follow it
            automatically.
          </div>

          <div class="set-group">
            <h3>Theme</h3>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Color palette</div>
                <div class="desc">
                  Synced to nvim `g:colors_name`. Override here to decouple GUI chrome from editor.
                </div>
              </div>
              <div class="control">
                <div class="color-chips">
                  <For each={THEMES as readonly string[]}>
                    {(t) => (
                      <div
                        class={`color-chip ${props.settings.theme === t ? 'on' : ''}`}
                        onClick={() => update('theme', t)}
                        title={t}
                        style={{ background: chipBg(t) }}
                      />
                    )}
                  </For>
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Window transparency</div>
                <div class="desc">macOS vibrancy. Uses window blur and a translucent background.</div>
              </div>
              <div class="control">
                <div
                  class={`switch ${props.settings.vibrancy === 'on' ? 'on' : ''}`}
                  onClick={() =>
                    update('vibrancy', props.settings.vibrancy === 'on' ? 'off' : 'on')
                  }
                />
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Chrome density</div>
                <div class="desc">Height of tab bar, breadcrumbs, and status bar.</div>
              </div>
              <div class="control">
                <div class="seg">
                  <For each={DENSITIES as readonly string[]}>
                    {(d) => (
                      <button
                        class={props.settings.density === d ? 'on' : ''}
                        onClick={() => update('density', d)}
                      >
                        {d[0].toUpperCase() + d.slice(1)}
                      </button>
                    )}
                  </For>
                </div>
              </div>
            </div>
          </div>

          <div class="set-group">
            <h3>Editor</h3>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Font</div>
                <div class="desc">
                  Used by the grid renderer. Must be monospaced; Nerd Font variants recommended.
                </div>
              </div>
              <div class="control">
                <div class="select">
                  JetBrains Mono NF{' '}
                  <Icon name="chevronDown" style={{ width: '10px', height: '10px' }} />
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Font size</div>
                <div class="desc">In points.</div>
              </div>
              <div class="control">
                <div class="select" style={{ 'min-width': '80px' }}>
                  14 <Icon name="chevronDown" style={{ width: '10px', height: '10px' }} />
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Ligatures</div>
                <div class="desc">Render programming ligatures (→, ⇒, ≠, etc.)</div>
              </div>
              <div class="control">
                <div class="switch on" />
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Cursor style</div>
              </div>
              <div class="control">
                <div class="seg">
                  <button class="on">Block</button>
                  <button>Beam</button>
                  <button>Underline</button>
                </div>
              </div>
            </div>
          </div>

          <div class="set-group">
            <h3>Neovim</h3>
            <div class="set-row">
              <div class="text-left">
                <div class="label">Binary path</div>
                <div class="desc">Override the nvim executable. Leave blank to auto-detect.</div>
              </div>
              <div class="control">
                <div class="select" style={{ 'min-width': '260px' }}>
                  /opt/homebrew/bin/nvim{' '}
                  <Icon name="chevronDown" style={{ width: '10px', height: '10px' }} />
                </div>
              </div>
            </div>
            <div class="set-row">
              <div class="text-left">
                <div class="label">One process per pane</div>
                <div class="desc">Recommended. Disables ext_multigrid for plugin compat.</div>
              </div>
              <div class="control">
                <div class="switch on" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
