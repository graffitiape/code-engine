// Mock syntax-highlighted pane used in the design preview only.
// Real PaneContainer replaces this at integration.

import { For, Show } from 'solid-js';
import type { CodeFile, EditorMode } from '../types';

export interface NvimPaneMockProps {
  code: CodeFile;
  focused: boolean;
  onFocus: () => void;
  mode: EditorMode;
}

export function NvimPaneMock(props: NvimPaneMockProps) {
  const currentIdx = () => props.code.lines.findIndex((x) => x.current);
  return (
    <div
      class={`pane ${props.focused ? 'focused' : ''}`}
      onMouseDown={props.onFocus}
      data-screen-label="NvimPane"
    >
      <div class="nvim-canvas">
        <div class="nvim-inner">
          <div class="gutter">
            <For each={props.code.lines}>
              {(ln) => (
                <span
                  class={`ln ${ln.current ? 'current' : ''} ${ln.hunk === 'a' ? 'git-a' : ''} ${
                    ln.hunk === 'b' ? 'git-m' : ''
                  }`}
                >
                  {ln.current
                    ? ln.gutter
                    : Math.abs(ln.gutter - (currentIdx() + 1)) || ln.gutter}
                </span>
              )}
            </For>
          </div>
          <div class="code">
            <For each={props.code.lines}>
              {(ln) => (
                <span class={`line ${ln.current ? 'current-line' : ''}`}>
                  <span innerHTML={ln.html || '\u00A0'} />
                  <Show when={ln.current && props.focused}>
                    <span class={`cursor ${props.mode === 'INSERT' ? 'insert' : ''}`} />
                  </Show>
                  <Show when={ln.diagnostic}>
                    <span class="diag-inline">   ■ {ln.diagnostic}</span>
                  </Show>
                </span>
              )}
            </For>
            <Show
              when={
                props.focused &&
                props.mode === 'NORMAL' &&
                props.code.language === 'typescriptreact'
              }
            >
              <div class="completion" style={{ top: 'calc(14 * 1.55em + 8px)', left: '10ch' }}>
                <div class="item active">
                  <span class="kind fn">fn</span>
                  <span>createEffect</span>
                  <span class="detail">(fn: Accessor) =&gt; void</span>
                </div>
                <div class="item">
                  <span class="kind fn">fn</span>
                  <span>createMemo</span>
                  <span class="detail">&lt;T&gt;(fn) =&gt; T</span>
                </div>
                <div class="item">
                  <span class="kind fn">fn</span>
                  <span>createSignal</span>
                  <span class="detail">&lt;T&gt;(v) =&gt; Signal</span>
                </div>
                <div class="item">
                  <span class="kind ty">ty</span>
                  <span>Component</span>
                  <span class="detail">type Component&lt;P&gt;</span>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </div>
  );
}
