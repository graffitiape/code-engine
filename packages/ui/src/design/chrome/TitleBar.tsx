// Window titlebar — traffic lights, project badge, page switcher, tabs, overlay toggles.

import { For, Show } from 'solid-js';
import type { Tab } from '../types';
import { Icon, FileIcon } from '../Icon';
import { PageSwitcher, type PageKey } from './PageSwitcher';
import { ProjectSwitcher } from './ProjectSwitcher';
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
      <ProjectSwitcher />
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
          title="Git panel"
        >
          <Icon name="git" />
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
