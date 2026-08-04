import { For, Show, createEffect, createMemo, createSignal } from "solid-js";
import type {
  CodexModel,
  CodexPermissionPreset,
  CodexServerRequest,
  CodexThread,
  CodexThreadItem,
} from "../../bridge/tauri";
import { Icon, Select } from "../../design";
import { AgentFeed } from "./AgentFeed";
import { ServerRequestCard } from "./ServerRequestCard";
import { PERMISSION_OPTIONS, asRecord, sourceLabel, threadStatusType, threadTitle } from "./types";

interface AgentThreadViewProps {
  thread: CodexThread;
  items: CodexThreadItem[];
  requests: CodexServerRequest[];
  models: CodexModel[];
  model: string;
  effort: string;
  permission: CodexPermissionPreset;
  active: boolean;
  loading: boolean;
  submitting: boolean;
  error: string | null;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  onPermission: (value: CodexPermissionPreset) => void;
  onSend: (text: string) => void;
  onInterrupt: () => void;
  onArchive: () => void;
  onRename: (name: string) => Promise<void>;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
  onClearError: () => void;
}

export function AgentThreadView(props: AgentThreadViewProps) {
  const [draft, setDraft] = createSignal("");
  const [renaming, setRenaming] = createSignal(false);
  const [name, setName] = createSignal(threadTitle(props.thread));
  let renderedThreadId = props.thread.id;

  createEffect(() => {
    const threadId = props.thread.id;
    const title = threadTitle(props.thread);
    if (threadId !== renderedThreadId) {
      renderedThreadId = threadId;
      setDraft("");
      setRenaming(false);
      setName(title);
    } else if (!renaming()) {
      setName(title);
    }
  });
  const selectedModel = createMemo(() => props.models.find((model) => model.model === props.model));
  const efforts = createMemo(() => selectedModel()?.supportedReasoningEfforts ?? []);
  const modelOptions = createMemo(() =>
    props.models.map((model) => ({ value: model.model, label: model.displayName })),
  );
  const effortOptions = createMemo(() =>
    efforts().map((effort) => ({
      value: effort.reasoningEffort,
      label: effort.reasoningEffort,
      description: effort.description,
    })),
  );
  const permissionOptions = PERMISSION_OPTIONS.map((option) => ({
    value: option.id,
    label: option.label,
    description: option.description,
  }));
  const visibleRequests = createMemo(() =>
    props.requests.filter((request) => {
      const requestThreadId = asRecord(request.params).threadId;
      return requestThreadId === undefined || requestThreadId === props.thread.id;
    }),
  );

  const send = () => {
    const value = draft().trim();
    if (!value || props.loading || props.submitting) return;
    props.onSend(value);
    setDraft("");
  };

  const saveName = async () => {
    const value = name().trim();
    if (value && value !== threadTitle(props.thread)) await props.onRename(value);
    setRenaming(false);
  };

  return (
    <main class="agent-thread-view">
      <header class="agent-thread-head">
        <div class="agent-thread-heading">
          <span class={`agent-thread-state state-${threadStatusType(props.thread.status)}`} />
          <div>
            <Show
              when={renaming()}
              fallback={
                <button
                  class="agent-thread-name"
                  disabled={props.loading}
                  title="Rename task"
                  onClick={() => setRenaming(true)}
                >
                  {threadTitle(props.thread)}
                </button>
              }
            >
              <input
                class="agent-thread-name-input"
                value={name()}
                onInput={(event) => setName(event.currentTarget.value)}
                onBlur={() => void saveName()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void saveName();
                  if (event.key === "Escape") {
                    setName(threadTitle(props.thread));
                    setRenaming(false);
                  }
                }}
                disabled={props.loading}
              />
            </Show>
            <div class="agent-thread-subtitle">
              <span>{sourceLabel(props.thread.source)}</span>
              <span>·</span>
              <span>{threadStatusType(props.thread.status)}</span>
              <Show when={props.thread.cliVersion}><span>· Codex {props.thread.cliVersion}</span></Show>
            </div>
          </div>
        </div>
        <Show when={props.active}>
          <button class="agent-stop-button" onClick={props.onInterrupt}>
            <span /> Stop
          </button>
        </Show>
        <button class="agent-icon-button" disabled={props.loading} onClick={props.onArchive} title="Archive task">
          <Icon name="close" />
        </button>
      </header>

      <Show when={props.error}>
        {(message) => (
          <div class="agent-error-banner">
            <span>{message()}</span>
            <button onClick={props.onClearError}><Icon name="close" /></button>
          </div>
        )}
      </Show>

      <Show when={visibleRequests().length > 0}>
        <div class="agent-requests-stack">
          <For each={visibleRequests()}>
            {(request) => <ServerRequestCard request={request} onRespond={props.onRespond} />}
          </For>
        </div>
      </Show>

      <Show
        when={!props.loading}
        fallback={<div class="agent-thread-loading"><span class="agent-spinner" /> Loading history…</div>}
      >
        <AgentFeed items={props.items} active={props.active} />
      </Show>

      <footer class="agent-thread-composer">
        <textarea
          value={draft()}
          disabled={props.loading}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={props.active ? "Steer the active turn…" : "Ask Codex to continue…"}
        />
        <div class="agent-thread-controls">
          <Select
            compact
            disabled={props.loading}
            value={props.model}
            options={modelOptions()}
            onChange={props.onModel}
            ariaLabel="Codex model"
            title="Model"
          />
          <Select
            compact
            disabled={props.loading || !effortOptions().length}
            value={props.effort}
            options={effortOptions()}
            onChange={props.onEffort}
            ariaLabel="Reasoning effort"
            title="Reasoning effort"
          />
          <Select
            compact
            disabled={props.loading}
            value={props.permission}
            options={permissionOptions}
            onChange={(value) => props.onPermission(value as CodexPermissionPreset)}
            ariaLabel="Task permissions"
            title="Permissions"
          />
          <span class="agent-thread-controls-spacer" />
          <span class="agent-send-hint">Enter to {props.active ? "steer" : "send"}</span>
          <button class="agent-send-button" disabled={!draft().trim() || props.loading || props.submitting} onClick={send}>
            <Icon name="chevronRight" />
          </button>
        </div>
      </footer>
    </main>
  );
}
