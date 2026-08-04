// File-tree sidebar with collapsible directory rows.

import { For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import type { TrashEntry } from '../../bridge/tauri';
import type { FileNode } from '../types';
import { Icon, FileIcon } from '../Icon';
import { Icons } from '../icons';

interface TreeRowProps {
  node: FileNode;
  onToggle: (n: FileNode) => void;
  openFile: (n: FileNode) => void;
  paths: Set<string>;
  onContext: (node: FileNode, x: number, y: number) => void;
}

function TreeRow(props: TreeRowProps) {
  const isOpenActive = () =>
    props.node.type === 'file' && props.paths.has(props.node.path ?? props.node.name);
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
        onContextMenu={(event) => {
          event.preventDefault();
          props.onContext(props.node, event.clientX, event.clientY);
        }}
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
              onContext={props.onContext}
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
  onNewFile?: () => void;
  onNewFileIn?: (parent: FileNode) => void;
  onNewFolder?: (parent?: FileNode) => void;
  onRename?: (node: FileNode) => void;
  onTrash?: (node: FileNode) => void;
  trashEntries?: TrashEntry[];
  onRestore?: (entry: TrashEntry) => void;
  onCollapseAll?: () => void;
}

export function Sidebar(props: SidebarProps) {
  const [context, setContext] = createSignal<{
    node: FileNode;
    x: number;
    y: number;
  } | null>(null);

  onMount(() => {
    const close = () => setContext(null);
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', escape);
    onCleanup(() => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', escape);
    });
  });

  const runContextAction = (action: (node: FileNode) => void) => {
    const node = context()?.node;
    setContext(null);
    if (node) action(node);
  };

  return (
    <div class={`sidebar ${props.collapsed ? 'collapsed' : ''}`}>
      <div class="sidebar-header">
        <span>Explorer</span>
        <div class="actions">
          <button class="icon-btn" title="New file…" onClick={props.onNewFile}>
            <Icon name="plus" style={{ width: '12px', height: '12px' }} />
          </button>
          <button class="icon-btn" title="New folder" onClick={() => props.onNewFolder?.()}>
            <Icon name="folder" style={{ width: '12px', height: '12px' }} />
          </button>
          <button class="icon-btn" title="Collapse all" onClick={props.onCollapseAll}>
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
              onContext={(node, x, y) => setContext({ node, x, y })}
            />
          )}
        </For>
      </div>
      <Show when={(props.trashEntries?.length ?? 0) > 0}>
        <div class="explorer-trash">
          <div class="explorer-trash-title">Recoverable trash</div>
          <For each={props.trashEntries}>
            {(entry) => (
              <div class="explorer-trash-row" title={entry.originalPath}>
                <span>{entry.originalPath.split(/[\\/]/).pop()}</span>
                <button type="button" onClick={() => props.onRestore?.(entry)}>Restore</button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={context()}>
        {(menu) => (
          <div
            class="explorer-context-menu"
            role="menu"
            style={{ left: `${menu().x}px`, top: `${menu().y}px` }}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Show when={menu().node.type === 'dir'}>
              <button role="menuitem" onClick={() => runContextAction((node) => props.onNewFileIn?.(node))}>
                New file here…
              </button>
              <button role="menuitem" onClick={() => runContextAction((node) => props.onNewFolder?.(node))}>
                New folder here…
              </button>
            </Show>
            <Show when={menu().node.depth > 0}>
              <button role="menuitem" onClick={() => runContextAction((node) => props.onRename?.(node))}>
                Rename…
              </button>
              <button class="danger" role="menuitem" onClick={() => runContextAction((node) => props.onTrash?.(node))}>
                Move to recoverable trash
              </button>
            </Show>
          </div>
        )}
      </Show>
    </div>
  );
}
