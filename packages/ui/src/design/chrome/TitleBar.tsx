// Window titlebar — traffic lights, project badge, page switcher, tabs, overlay toggles.

import { For, Show } from 'solid-js';
import type { Tab } from '../types';
import { Icon, FileIcon } from '../Icon';
import { PageSwitcher, type PageKey } from './PageSwitcher';
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from '../../lib/titlebar';

export interface TitleBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onCommandPalette: () => void;
  toggleSidebar: () => void;
  toggleGit: () => void;
  toggleMinimap: () => void;
  toggleSettings: () => void;
  toggleSearch: () => void;
  sidebarOpen: boolean;
  activeOverlay: string | null;
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
}

export function TitleBar(props: TitleBarProps) {
  return (
    <div
      class="titlebar"
      data-screen-label="TitleBar"
      onMouseDown={handleTitlebarMouseDown}
      onMouseUp={handleTitlebarMouseUp}
    >
      <div class="traffic-lights">
        <span class="tl close" />
        <span class="tl min" />
        <span class="tl max" />
      </div>
      <div class="project-badge" title="Switch project">
        <span class="logo">
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M2 3l3-2 3 2v4L5 9 2 7V3z" stroke="white" stroke-width="0.8" />
            <circle cx="5" cy="5" r="1" fill="white" />
          </svg>
        </span>
        <span class="name">code-engine</span>
        <Icon name="chevronDown" style={{ width: '10px', height: '10px', color: 'var(--fg-3)' }} />
      </div>
      <PageSwitcher active={props.activePage} onNavigate={props.onNavigatePage} />
      <div class="tabs">
        <For each={props.tabs}>
          {(t) => (
            <div
              class={`tab ${t.id === props.activeTabId ? 'active' : ''}`}
              onClick={() => props.onTabClick(t.id)}
            >
              <FileIcon type={t.icon} />
              <span class="name">{t.name}</span>
              <Show when={t.dirty}>
                <span class="dirty" />
              </Show>
              <span
                class="close"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onTabClose(t.id);
                }}
              >
                <Icon name="close" style={{ width: '10px', height: '10px' }} />
              </span>
            </div>
          )}
        </For>
        <div class="tab-new" onClick={props.onNewTab} title="New tab (⌘T)">
          <Icon name="plus" style={{ width: '12px', height: '12px' }} />
        </div>
      </div>
      <div class="titlebar-right">
        <button
          class={`icon-btn ${props.sidebarOpen ? 'active' : ''}`}
          onClick={props.toggleSidebar}
          title="Toggle sidebar (⌘B)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
            <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
            <path d="M6 2.5v11" />
          </svg>
        </button>
        <button class="icon-btn" onClick={props.onCommandPalette} title="Command palette (⌘⇧P)">
          <Icon name="command" />
        </button>
        <button
          class={`icon-btn ${props.activeOverlay === 'search' ? 'active' : ''}`}
          onClick={props.toggleSearch}
          title="Search (⌘⇧F)"
        >
          <Icon name="search" />
        </button>
        <button
          class={`icon-btn ${props.activeOverlay === 'minimap' ? 'active' : ''}`}
          onClick={props.toggleMinimap}
          title="Minimap (⌘⇧M)"
        >
          <Icon name="minimap" />
        </button>
        <button
          class={`icon-btn ${props.activeOverlay === 'git' ? 'active' : ''}`}
          onClick={props.toggleGit}
          title="Git panel (⌘K G)"
        >
          <Icon name="git" />
          <span class="dot" style={{ background: 'var(--yellow)' }} />
        </button>
        <button
          class={`icon-btn ${props.activeOverlay === 'settings' ? 'active' : ''}`}
          onClick={props.toggleSettings}
          title="Settings (⌘,)"
        >
          <Icon name="settings" />
        </button>
      </div>
    </div>
  );
}
