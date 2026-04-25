// Page switcher pills (Editor / Agents) embedded in the titlebar.

import { For } from 'solid-js';

export type PageKey = 'editor' | 'agents';

export interface PageSwitcherProps {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
}

const PAGES: { key: PageKey; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'agents', label: 'Agents' },
];

export function PageSwitcher(props: PageSwitcherProps) {
  return (
    <div class="page-switcher" role="tablist" aria-label="Workspace pages">
      <For each={PAGES}>
        {(p) => (
          <button
            type="button"
            role="tab"
            aria-selected={props.active === p.key}
            class={`page-pill ${props.active === p.key ? 'active' : ''}`}
            onClick={() => props.onNavigate(p.key)}
          >
            {p.label}
          </button>
        )}
      </For>
    </div>
  );
}
