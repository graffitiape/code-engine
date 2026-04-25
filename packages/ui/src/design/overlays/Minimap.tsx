// Minimap overlay — buffer list + a stylized density preview.

import { For, createMemo, createSignal } from 'solid-js';
import { Icon, FileIcon } from '../Icon';
import { MinimapBuffers, synthMinimap } from '../data';

export interface MinimapProps {
  onClose: () => void;
  onOpenFile?: (name: string) => void;
}

export function Minimap(props: MinimapProps) {
  const [activeBuf, setActiveBuf] = createSignal('PaneView.tsx');
  const lines = createMemo(() => synthMinimap(120));

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay minimap">
        <div class="minimap-header">
          <div>
            <h3>Buffer Overview</h3>
            <div class="subtitle">{activeBuf()} · 38 lines · tsx</div>
          </div>
          <button class="icon-btn" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="minimap-body">
          <div class="minimap-buffers">
            <For each={MinimapBuffers}>
              {(b) => (
                <div
                  class={`minimap-buf ${b.name === activeBuf() ? 'active' : ''}`}
                  onClick={() => setActiveBuf(b.name)}
                >
                  <FileIcon type={b.icon} />
                  <span
                    style={{
                      overflow: 'hidden',
                      'text-overflow': 'ellipsis',
                      'white-space': 'nowrap',
                    }}
                  >
                    {b.name}
                  </span>
                  <span class="lines">{b.lines}L</span>
                </div>
              )}
            </For>
          </div>
          <div class="minimap-canvas">
            <div class="minimap-lines">
              <For each={lines()}>
                {(ln) => (
                  <div class={`minimap-line ${ln.cls}`} style={{ width: `${ln.w}%` }} />
                )}
              </For>
            </div>
            <div class="minimap-viewport" style={{ top: '26%', height: '22%' }} />
          </div>
        </div>
      </div>
    </>
  );
}
