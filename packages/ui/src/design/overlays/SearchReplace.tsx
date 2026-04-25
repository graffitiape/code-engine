// Project-wide search/replace panel.

import { For, Show, createSignal } from 'solid-js';
import { Icon, FileIcon } from '../Icon';
import { SearchResults } from '../data';

export interface SearchReplaceProps {
  onClose: () => void;
}

interface ToggleState {
  aa: boolean;
  ww: boolean;
  re: boolean;
}

export function SearchReplace(props: SearchReplaceProps) {
  const [query, setQuery] = createSignal(SearchResults.query);
  const [replace, setReplace] = createSignal('');
  const [showReplace, setShowReplace] = createSignal(false);
  const [mode, setMode] = createSignal<ToggleState>({ aa: false, ww: false, re: false });

  const total = SearchResults.files.reduce((a, f) => a + f.matches.length, 0);

  return (
    <div class="overlay search-panel">
      <div class="sp-body">
        <div
          style={{
            display: 'flex',
            gap: '8px',
            'align-items': 'center',
            'margin-bottom': '2px',
          }}
        >
          <button
            class="icon-btn"
            onClick={() => setShowReplace(!showReplace())}
            title="Toggle replace"
          >
            <Icon
              name="chevronRight"
              style={{
                transform: showReplace() ? 'rotate(90deg)' : 'none',
                transition: 'transform .15s',
              }}
            />
          </button>
          <strong style={{ 'font-size': '12px', color: 'var(--fg-0)' }}>Search</strong>
          <span
            style={{
              'margin-left': 'auto',
              color: 'var(--fg-3)',
              'font-size': '11px',
              'font-family': 'var(--font-mono)',
            }}
          >
            {total} matches · 3 files
          </span>
          <button class="icon-btn" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="field">
          <span class="icon">
            <Icon name="search" />
          </span>
          <input
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            placeholder="Find in project…"
          />
          <div class="toggles">
            <span
              class={`tog ${mode().aa ? 'on' : ''}`}
              onClick={() => setMode((m) => ({ ...m, aa: !m.aa }))}
              title="Match case"
            >
              Aa
            </span>
            <span
              class={`tog ${mode().ww ? 'on' : ''}`}
              onClick={() => setMode((m) => ({ ...m, ww: !m.ww }))}
              title="Match whole word"
            >
              ab
            </span>
            <span
              class={`tog ${mode().re ? 'on' : ''}`}
              onClick={() => setMode((m) => ({ ...m, re: !m.re }))}
              title="Regex"
            >
              .*
            </span>
          </div>
        </div>
        <Show when={showReplace()}>
          <div class="field">
            <span class="icon">
              <Icon name="replace" />
            </span>
            <input
              value={replace()}
              onInput={(e) => setReplace(e.currentTarget.value)}
              placeholder="Replace with…"
            />
            <div class="toggles">
              <span class="tog" title="Replace">
                ↵
              </span>
              <span class="tog" title="Replace all">
                ⇧↵
              </span>
            </div>
          </div>
        </Show>
        <div class="results">
          <For each={SearchResults.files}>
            {(f) => (
              <div class="file-group">
                <div class="file-head">
                  <Icon
                    name="chevronDown"
                    style={{ width: '10px', height: '10px', color: 'var(--fg-3)' }}
                  />
                  <FileIcon type={f.path.split('.').pop() || 'file'} />
                  <span>{f.path}</span>
                  <span class="count">{f.matches.length}</span>
                </div>
                <For each={f.matches}>
                  {(m) => (
                    <div class="match">
                      <span class="ln">{m.ln}</span>
                      <span class="text">
                        {m.before}
                        <span class="hl">{m.hl}</span>
                        {m.after}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </div>
        <div
          style={{
            display: 'flex',
            gap: '6px',
            'align-items': 'center',
            'justify-content': 'space-between',
            'font-size': '11px',
            color: 'var(--fg-3)',
            'font-family': 'var(--font-mono)',
          }}
        >
          <span>ripgrep · 24ms</span>
          <span>
            <kbd class="key">F3</kbd> next · <kbd class="key">⇧F3</kbd> prev
          </span>
        </div>
      </div>
    </div>
  );
}
