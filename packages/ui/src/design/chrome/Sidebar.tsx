// File-tree sidebar with collapsible directory rows.

import { For, Show } from 'solid-js';
import type { FileNode } from '../types';
import { Icon, FileIcon } from '../Icon';
import { Icons } from '../data';

interface TreeRowProps {
  node: FileNode;
  onToggle: (n: FileNode) => void;
  openFile: (n: FileNode) => void;
  paths: Set<string>;
}

function TreeRow(props: TreeRowProps) {
  const isOpenActive = () => props.node.type === 'file' && props.paths.has(props.node.name);
  const rowClass = () =>
    `tree-row ${props.node.type === 'dir' && props.node.expanded ? 'expanded' : ''} ${
      props.node.active || isOpenActive() ? 'active' : ''
    }`;
  return (
    <>
      <div
        class={rowClass()}
        style={{ 'padding-left': `${6 + props.node.depth * 12}px` }}
        onClick={() =>
          props.node.type === 'dir' ? props.onToggle(props.node) : props.openFile(props.node)
        }
      >
        <Show
          when={props.node.type === 'dir'}
          fallback={
            <>
              <span class="chevron" style={{ opacity: '0' }} />
              <FileIcon type={props.node.icon || 'file'} />
            </>
          }
        >
          <span class="chevron">
            <Icon name="chevronRight" style={{ width: '10px', height: '10px' }} />
          </span>
          <span
            class="file-icon"
            style={{ color: 'var(--blue)' }}
            innerHTML={Icons[props.node.expanded ? 'folderOpen' : 'folder']}
          />
        </Show>
        <span>{props.node.name}</span>
        <Show when={props.node.git}>
          <span class={`git-status ${props.node.git}`}>{props.node.git}</span>
        </Show>
      </div>
      <Show when={props.node.type === 'dir' && props.node.expanded && props.node.children}>
        <For each={props.node.children}>
          {(c) => (
            <TreeRow
              node={c}
              onToggle={props.onToggle}
              openFile={props.openFile}
              paths={props.paths}
            />
          )}
        </For>
      </Show>
    </>
  );
}

export interface SidebarProps {
  tree: FileNode[];
  toggleNode: (n: FileNode) => void;
  openFile: (n: FileNode) => void;
  openFilePaths: Set<string>;
  collapsed: boolean;
}

export function Sidebar(props: SidebarProps) {
  return (
    <div class={`sidebar ${props.collapsed ? 'collapsed' : ''}`}>
      <div class="sidebar-header">
        <span>Explorer</span>
        <div class="actions">
          <button class="icon-btn" title="New file">
            <Icon name="plus" style={{ width: '12px', height: '12px' }} />
          </button>
          <button class="icon-btn" title="Collapse all">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M2 6l3-3 3 3M14 10l-3 3-3-3" />
            </svg>
          </button>
        </div>
      </div>
      <div class="tree">
        <For each={props.tree}>
          {(n) => (
            <TreeRow
              node={n}
              onToggle={props.toggleNode}
              openFile={props.openFile}
              paths={props.openFilePaths}
            />
          )}
        </For>
      </div>
    </div>
  );
}
