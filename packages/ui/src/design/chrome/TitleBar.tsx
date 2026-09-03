// Window titlebar — traffic lights, project badge, page switcher, tabs, overlay toggles.

import { For, Show } from 'solid-js';
import type { Tab } from '../types';
import { Icon, FileIcon } from '../Icon';
import { PageSwitcher, type PageKey } from './PageSwitcher';
import { ProjectSwitcher } from './ProjectSwitcher';
import { TitleBarActions, type TitleBarAction } from './TitleBarActions';
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from '../../lib/titlebar';

export interface TitleBarProps {
  tabs: Tab[];
  activeTabId: string;
  onTabClick: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onAction: (action: TitleBarAction) => void;
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
      <TitleBarActions
        activeOverlay={props.activeOverlay}
        sidebarOpen={props.sidebarOpen}
        onAction={props.onAction}
      />
    </div>
  );
}
