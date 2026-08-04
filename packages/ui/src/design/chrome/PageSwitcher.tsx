// Page switcher pills embedded in the titlebar.

import { For } from 'solid-js';

export type PageKey = 'editor' | 'agents' | 'pipelines';

export interface PageSwitcherProps {
  active: PageKey;
  onNavigate: (page: PageKey) => void;
}

const PAGES: { key: PageKey; label: string }[] = [
  { key: 'editor', label: 'Editor' },
  { key: 'agents', label: 'Agents' },
  { key: 'pipelines', label: 'Pipelines' },
];

export function PageSwitcher(props: PageSwitcherProps) {
  const tabRefs: Array<HTMLButtonElement | undefined> = [];

  const focusPage = (index: number) => {
    const normalized = (index + PAGES.length) % PAGES.length;
    const targetPage = PAGES[normalized];
    props.onNavigate(targetPage.key);
    queueMicrotask(() => {
      const visibleTarget = [...document.querySelectorAll<HTMLButtonElement>(
        `[data-workspace-page="${targetPage.key}"]`,
      )].find(
        (button) =>
          button.closest<HTMLElement>('[role="tabpanel"]')?.style.display === 'contents',
      );
      (visibleTarget ?? tabRefs[normalized])?.focus();
    });
  };

  const handleKeyDown = (event: KeyboardEvent, index: number) => {
    let target: number | null = null;
    if (event.key === 'ArrowRight') target = index + 1;
    else if (event.key === 'ArrowLeft') target = index - 1;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = PAGES.length - 1;
    if (target === null) return;
    event.preventDefault();
    focusPage(target);
  };

  return (
    <div
      class="page-switcher"
      role="tablist"
      aria-label="Workspace pages"
      aria-orientation="horizontal"
    >
      <For each={PAGES}>
        {(p, index) => (
          <button
            ref={(element) => { tabRefs[index()] = element; }}
            type="button"
            role="tab"
            aria-controls={`workspace-page-${p.key}`}
            aria-selected={props.active === p.key}
            data-workspace-page={p.key}
            tabIndex={props.active === p.key ? 0 : -1}
            class={`page-pill ${props.active === p.key ? 'active' : ''}`}
            onClick={() => props.onNavigate(p.key)}
            onKeyDown={(event) => handleKeyDown(event, index())}
          >
            {p.label}
          </button>
        )}
      </For>
    </div>
  );
}
