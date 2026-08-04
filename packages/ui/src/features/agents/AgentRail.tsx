import { For, Show, createMemo, createSignal } from "solid-js";
import type { CodexThread } from "../../bridge/tauri";
import { Icon } from "../../design";
import {
  formatRelativeTime,
  isThreadActive,
  sourceLabel,
  threadStatusType,
  threadTitle,
} from "./types";

interface AgentRailProps {
  threads: CodexThread[];
  currentId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRefresh: () => void;
}

export function AgentRail(props: AgentRailProps) {
  const [query, setQuery] = createSignal("");
  const filtered = createMemo(() => {
    const needle = query().trim().toLowerCase();
    if (!needle) return props.threads;
    return props.threads.filter((thread) =>
      `${threadTitle(thread)} ${thread.preview}`.toLowerCase().includes(needle),
    );
  });

  return (
    <aside class="agent-rail">
      <header class="agent-rail-head">
        <div>
          <span class="agent-eyebrow">CODEX</span>
          <h2>Tasks</h2>
        </div>
        <button class="agent-new-button" onClick={props.onNew}>
          <Icon name="plus" /> New
        </button>
      </header>

      <div class="agent-rail-search">
        <Icon name="search" />
        <input
          aria-label="Search Codex tasks"
          value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search tasks…"
        />
        <button class="agent-icon-button" onClick={props.onRefresh} title="Refresh tasks">
          <Icon name="replace" />
        </button>
      </div>

      <div class="agent-rail-list">
        <Show when={!props.loading} fallback={<RailSkeleton />}>
          <Show
            when={filtered().length > 0}
            fallback={
              <div class="agent-rail-empty">
                <span>No tasks in this project.</span>
                <button onClick={props.onNew}>Start the first one</button>
              </div>
            }
          >
            <For each={filtered()}>
              {(thread) => (
                <button
                  class={`agent-thread-row ${props.currentId === thread.id ? "active" : ""}`}
                  onClick={() => props.onSelect(thread.id)}
                >
                  <span
                    class={`agent-thread-state state-${threadStatusType(thread.status)}`}
                    aria-label={threadStatusType(thread.status)}
                  />
                  <span class="agent-thread-copy">
                    <span class="agent-thread-title">{threadTitle(thread)}</span>
                    <span class="agent-thread-meta">
                      <span>{sourceLabel(thread.source)}</span>
                      <span>·</span>
                      <span>{formatRelativeTime(thread.updatedAt)}</span>
                    </span>
                  </span>
                  <Show when={isThreadActive(thread)}>
                    <span class="agent-live-pill">live</span>
                  </Show>
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </aside>
  );
}

function RailSkeleton() {
  return (
    <div class="agent-rail-skeleton" aria-label="Loading tasks">
      <For each={[1, 2, 3]}>{() => <span />}</For>
    </div>
  );
}
