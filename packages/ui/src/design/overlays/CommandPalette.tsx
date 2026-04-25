// Command palette overlay — fuzzy file search over the workspace.

import { For, Show, createMemo, createResource, createSignal, onMount } from 'solid-js';
import type { JSX } from 'solid-js';
import { Icon, FileIcon } from '../Icon';
import { listWorkspaceFiles } from '../../bridge/tauri';

export interface CommandPaletteProps {
  onClose: () => void;
  onOpenFile: (path: string) => void;
  workspaceRoot: string | null;
}

interface PaletteRow {
  primary: string;
  secondary: string;
  path: string;
  icon: string;
}

function ext(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : 'file';
}

function basename(p: string): string {
  const i = p.lastIndexOf('/');
  return i >= 0 ? p.slice(i + 1) : p;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal('');
  const [activeIdx, setActiveIdx] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const [files] = createResource(
    () => props.workspaceRoot,
    async (root) => {
      if (!root) return [] as string[];
      try {
        return await listWorkspaceFiles(root, 20000);
      } catch {
        return [];
      }
    },
  );

  onMount(() => {
    inputRef?.focus();
  });

  const rootLen = () => (props.workspaceRoot?.length ?? 0) + 1;

  const filtered = createMemo<PaletteRow[]>(() => {
    const list = files() ?? [];
    const q = query().toLowerCase();
    const rows: PaletteRow[] = [];
    const lim = q ? 200 : 100;
    for (const path of list) {
      const rel = path.slice(rootLen());
      const name = basename(rel);
      if (q && !rel.toLowerCase().includes(q)) continue;
      rows.push({ primary: name, secondary: rel, path, icon: ext(name) });
      if (rows.length >= lim) break;
    }
    return rows;
  });

  const handleKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(filtered().length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const sel = filtered()[activeIdx()];
      if (sel) props.onOpenFile(sel.path);
      props.onClose();
    } else if (e.key === 'Escape') {
      props.onClose();
    }
  };

  const highlight = (text: string): JSX.Element => {
    const q = query();
    if (!q) return text;
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <span class="hl">{text.slice(i, i + q.length)}</span>
        {text.slice(i + q.length)}
      </>
    );
  };

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay palette" onKeyDown={handleKey}>
        <div class="search">
          <span class="icon">
            <Icon name="search" />
          </span>
          <input
            ref={inputRef}
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActiveIdx(0);
            }}
            placeholder={
              props.workspaceRoot
                ? 'Search files in workspace…'
                : 'Open a folder first (⌘O)'
            }
          />
          <kbd>⌘P</kbd>
        </div>
        <div class="list">
          <Show when={files.loading}>
            <div class="section-label">Indexing workspace…</div>
          </Show>
          <Show when={!filtered().length && !files.loading}>
            <div class="section-label">No results</div>
          </Show>
          <For each={filtered()}>
            {(item, i) => {
              const isActive = () => i() === activeIdx();
              return (
                <div
                  class={`row ${isActive() ? 'active' : ''}`}
                  onMouseEnter={() => setActiveIdx(i())}
                  onClick={() => {
                    props.onOpenFile(item.path);
                    props.onClose();
                  }}
                >
                  <span class="icon">
                    <FileIcon type={item.icon} />
                  </span>
                  <div
                    style={{
                      display: 'flex',
                      'flex-direction': 'column',
                      gap: '2px',
                      flex: '1',
                      'min-width': '0',
                    }}
                  >
                    <span class="primary">{highlight(item.primary)}</span>
                    <span class="secondary">{highlight(item.secondary)}</span>
                  </div>
                </div>
              );
            }}
          </For>
        </div>
        <div class="footer">
          <div class="hints">
            <span class="hint-item">
              <kbd>↑↓</kbd> navigate
            </span>
            <span class="hint-item">
              <kbd>↵</kbd> open
            </span>
            <span class="hint-item">
              <kbd>esc</kbd> close
            </span>
          </div>
          <span>{filtered().length} matches</span>
        </div>
      </div>
    </>
  );
}
