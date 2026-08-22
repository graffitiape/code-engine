import { For, Match, Show, Switch, createEffect } from "solid-js";
import type { CodexThreadItem } from "../../bridge/tauri";
import { Icon, MarkdownText } from "../../design";
import type { FileLinkTarget } from "../../design/MarkdownText";
import { safeJson, userMessageText } from "./types";

interface AgentFeedProps {
  items: CodexThreadItem[];
  active: boolean;
  onOpenFile: (target: FileLinkTarget) => void;
}

export function AgentFeed(props: AgentFeedProps) {
  let scrollRef: HTMLDivElement | undefined;

  createEffect(() => {
    props.items.length;
    props.items.at(-1)?.text;
    props.items.at(-1)?.aggregatedOutput;
    queueMicrotask(() => {
      if (scrollRef) scrollRef.scrollTop = scrollRef.scrollHeight;
    });
  });

  return (
    <div class="agent-feed" ref={scrollRef}>
      <Show
        when={props.items.length > 0}
        fallback={
          <div class="agent-feed-empty">
            <Icon name="command" />
            <span>This thread has no messages yet.</span>
          </div>
        }
      >
        <For each={props.items}>{(item) => <FeedItem item={item} onOpenFile={props.onOpenFile} />}</For>
      </Show>
      <Show when={props.active}>
        <div class="agent-thinking-row">
          <span class="agent-thinking-dots"><i /><i /><i /></span>
          Codex is working
        </div>
      </Show>
    </div>
  );
}

function FeedItem(props: { item: CodexThreadItem; onOpenFile: (target: FileLinkTarget) => void }) {
  const item = () => props.item;
  return (
    <Switch fallback={<GenericToolItem item={item()} />}>
      <Match when={item().type === "userMessage"}>
        <article class="agent-message user">
          <div class="agent-message-who">You</div>
          <div class="agent-message-text">{userMessageText(item())}</div>
        </article>
      </Match>
      <Match when={item().type === "agentMessage"}>
        <article class="agent-message assistant">
          <div class="agent-message-who">Codex</div>
          <MarkdownText class="agent-message-text" text={item().text} onOpenFile={props.onOpenFile} />
        </article>
      </Match>
      <Match when={item().type === "reasoning"}>
        <details class="agent-event-card reasoning" open>
          <summary><Icon name="search" /> Reasoning summary</summary>
          <div class="agent-event-copy">
            {item().text || (Array.isArray(item().summary) ? item().summary?.join("\n") : "Thinking…")}
          </div>
        </details>
      </Match>
      <Match when={item().type === "plan"}>
        <article class="agent-event-card plan">
          <header><Icon name="branch" /> Plan</header>
          <div class="agent-event-copy">{item().text}</div>
        </article>
      </Match>
      <Match when={item().type === "turnPlan"}>
        <article class="agent-event-card plan">
          <header><Icon name="branch" /> {item().title ?? "Plan"}</header>
          <ol class="agent-plan-list">
            <For each={item().plan ?? []}>
              {(step) => (
                <li class={`status-${step.status}`}>
                  <span>{step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : "○"}</span>
                  {step.step}
                </li>
              )}
            </For>
          </ol>
        </article>
      </Match>
      <Match when={item().type === "commandExecution"}>
        <details class="agent-event-card command" open={item().status === "inProgress"}>
          <summary>
            <Icon name="terminal" />
            <span class="agent-event-title">{item().command ?? "Shell command"}</span>
            <StatusPill status={item().status} />
          </summary>
          <Show when={item().cwd}><div class="agent-event-path">{item().cwd}</div></Show>
          <Show when={item().aggregatedOutput}>
            <pre>{item().aggregatedOutput}</pre>
          </Show>
          <Show when={typeof item().exitCode === "number"}>
            <footer>Exit {item().exitCode} · {formatDuration(item().durationMs)}</footer>
          </Show>
        </details>
      </Match>
      <Match when={item().type === "fileChange"}>
        <details class="agent-event-card files" open>
          <summary>
            <Icon name="git" />
            <span class="agent-event-title">File changes</span>
            <StatusPill status={item().status} />
          </summary>
          <For each={item().changes ?? []}>
            {(change) => (
              <details class="agent-file-change">
                <summary><span class={`change-${change.kind}`}>{change.kind}</span>{change.path}</summary>
                <Show when={change.diff}><pre>{change.diff}</pre></Show>
              </details>
            )}
          </For>
        </details>
      </Match>
      <Match when={item().type === "turnDiff"}>
        <details class="agent-event-card diff">
          <summary><Icon name="git" /> Turn diff</summary>
          <pre>{item().diff}</pre>
        </details>
      </Match>
      <Match when={item().type === "notice"}>
        <div class={`agent-notice ${item().noticeKind ?? "info"}`}>
          <span>{item().noticeKind === "error" ? "!" : "i"}</span>
          {item().text}
        </div>
      </Match>
      <Match when={item().type === "contextCompaction"}>
        <div class="agent-divider"><span>Context compacted</span></div>
      </Match>
    </Switch>
  );
}

function GenericToolItem(props: { item: CodexThreadItem }) {
  const label = () =>
    props.item.tool || props.item.server || readableType(props.item.type);
  return (
    <details class="agent-event-card tool" open={props.item.status === "inProgress"}>
      <summary>
        <Icon name="command" />
        <span class="agent-event-title">{label()}</span>
        <StatusPill status={props.item.status} />
      </summary>
      <Show when={props.item.arguments !== undefined}>
        <pre>{safeJson(props.item.arguments)}</pre>
      </Show>
      <Show when={props.item.result !== undefined && props.item.result !== null}>
        <pre>{safeJson(props.item.result)}</pre>
      </Show>
      <Show when={props.item.error !== undefined && props.item.error !== null}>
        <pre class="agent-tool-error">{safeJson(props.item.error)}</pre>
      </Show>
    </details>
  );
}

function StatusPill(props: { status: unknown }) {
  const value = () => (typeof props.status === "string" ? props.status : "");
  return <Show when={value()}>{(status) => <span class={`agent-status-pill status-${status()}`}>{status()}</span>}</Show>;
}

function readableType(type: string): string {
  return type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

function formatDuration(value: unknown): string {
  return typeof value === "number" ? `${(value / 1000).toFixed(1)}s` : "done";
}
