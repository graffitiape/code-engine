// Git panel — staged/unstaged/untracked file lists from `git status`.

import { For, Show, createEffect, createSignal } from 'solid-js';
import { Icon } from '../Icon';
import { gitStatus, type GitFileStatus, type GitRepoStatus } from '../../bridge/tauri';

export interface GitPanelProps {
  onClose: () => void;
  workspaceRoot: string | null;
  onOpenFile?: (path: string) => void;
}

const TABS = ['status', 'log', 'branches', 'stash'] as const;
type GitTab = (typeof TABS)[number];

export function GitPanel(props: GitPanelProps) {
  const [status, setStatus] = createSignal<GitRepoStatus | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [activeFile, setActiveFile] = createSignal<string | null>(null);
  const [commitMsg, setCommitMsg] = createSignal('');
  const [activeTab, setActiveTab] = createSignal<GitTab>('status');

  async function refresh() {
    if (!props.workspaceRoot) {
      setStatus(null);
      setError('No workspace open');
      return;
    }
    try {
      const s = await gitStatus(props.workspaceRoot);
      setStatus(s);
      setError(null);
      if (!activeFile()) {
        const first = s.staged[0] ?? s.unstaged[0] ?? s.untracked[0];
        if (first) setActiveFile(first.path);
      }
    } catch (e) {
      setError(String(e));
      setStatus(null);
    }
  }

  createEffect(() => {
    // Re-fetch whenever the panel opens with a new root.
    void props.workspaceRoot;
    refresh();
  });

  function statusBadge(f: GitFileStatus): string {
    switch (f.kind) {
      case 'new':
        return 'A';
      case 'modified':
        return 'M';
      case 'deleted':
        return 'D';
      case 'renamed':
        return 'R';
      case 'conflict':
        return 'U';
      default:
        return '?';
    }
  }

  function rowFor(f: GitFileStatus) {
    return (
      <div
        class={`row ${f.path === activeFile() ? 'active' : ''}`}
        onClick={() => {
          setActiveFile(f.path);
          if (props.workspaceRoot && props.onOpenFile) {
            props.onOpenFile(`${props.workspaceRoot}/${f.path}`);
          }
        }}
      >
        <span class={`status ${statusBadge(f)}`}>{statusBadge(f)}</span>
        <span class="path">{f.path}</span>
      </div>
    );
  }

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay git-panel" data-screen-label="GitPanel">
        <div class="git-header">
          <div class="title">
            <Icon name="git" style={{ color: 'var(--orange)' }} />
            Source Control
          </div>
          <Show when={status()}>
            <div class="branch-pill">
              <Icon name="branch" style={{ width: '11px', height: '11px' }} />
              {status()!.branch}
            </div>
            <span class="ahead-behind">
              ↑{status()!.ahead} · ↓{status()!.behind}
            </span>
          </Show>
          <div class="tabs-row">
            <For each={TABS as readonly GitTab[]}>
              {(t) => (
                <span
                  class={`gtab ${t === activeTab() ? 'active' : ''}`}
                  onClick={() => setActiveTab(t)}
                >
                  {t[0].toUpperCase() + t.slice(1)}
                </span>
              )}
            </For>
          </div>
          <button class="icon-btn" onClick={refresh} title="Refresh">
            <Icon name="chevronDown" style={{ transform: 'rotate(-90deg)' }} />
          </button>
          <button class="icon-btn" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="git-body">
          <div class="git-files">
            <Show when={error()}>
              <div class="muted" style={{ padding: '12px' }}>
                {error()}
              </div>
            </Show>
            <Show when={status()}>
              <div class="group">
                <span>Staged</span>
                <span class="count">{status()!.staged.length}</span>
              </div>
              <div class="list" style={{ flex: 'none' }}>
                <For each={status()!.staged}>{(f) => rowFor(f)}</For>
              </div>
              <div class="group">
                <span>Changes</span>
                <span class="count">{status()!.unstaged.length}</span>
              </div>
              <div class="list">
                <For each={status()!.unstaged}>{(f) => rowFor(f)}</For>
              </div>
              <div class="group">
                <span>Untracked</span>
                <span class="count">{status()!.untracked.length}</span>
              </div>
              <div class="list">
                <For each={status()!.untracked}>{(f) => rowFor(f)}</For>
              </div>
            </Show>
            <div class="git-commit">
              <textarea
                value={commitMsg()}
                onInput={(e) => setCommitMsg(e.currentTarget.value)}
                placeholder="Commit message…"
              />
              <div class="commit-actions">
                <button disabled={!commitMsg()}>Commit</button>
                <button class="sec">Stash</button>
              </div>
            </div>
          </div>
          <div class="git-diff">
            <div class="diff-head">
              <span class="path">{activeFile() ?? '—'}</span>
            </div>
            <div class="diff-body" style={{ padding: '24px', color: 'var(--fg-2)' }}>
              {activeFile()
                ? 'Diff viewer coming soon — for now use the editor pane to inspect changes.'
                : 'Select a file to inspect.'}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
