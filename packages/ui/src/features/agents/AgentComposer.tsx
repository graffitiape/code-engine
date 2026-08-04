import { For, Show, createMemo, createSignal } from "solid-js";
import type { CodexModel, CodexPermissionPreset } from "../../bridge/tauri";
import { Icon, Select } from "../../design";
import { PERMISSION_OPTIONS } from "./types";

interface AgentComposerProps {
  models: CodexModel[];
  model: string;
  effort: string;
  permission: CodexPermissionPreset;
  projectPath: string;
  submitting: boolean;
  onModel: (model: string) => void;
  onEffort: (effort: string) => void;
  onPermission: (permission: CodexPermissionPreset) => void;
  onSubmit: (prompt: string) => void;
  onCancel?: () => void;
}

export function AgentComposer(props: AgentComposerProps) {
  const [prompt, setPrompt] = createSignal("");
  const selectedModel = createMemo(() =>
    props.models.find((model) => model.model === props.model),
  );
  const efforts = createMemo(() => selectedModel()?.supportedReasoningEfforts ?? []);
  const modelOptions = createMemo(() =>
    props.models.map((model) => ({
      value: model.model,
      label: model.displayName,
      description: model.description,
    })),
  );
  const effortOptions = createMemo(() =>
    efforts().map((effort) => ({
      value: effort.reasoningEffort,
      label: effort.reasoningEffort,
      description: effort.description,
    })),
  );

  const submit = () => {
    const value = prompt().trim();
    if (!value || props.submitting) return;
    props.onSubmit(value);
    setPrompt("");
  };

  return (
    <main class="agent-composer-page">
      <section class="agent-composer-card">
        <header>
          <span class="agent-composer-icon"><Icon name="command" /></span>
          <div>
            <span class="agent-eyebrow">NEW CODEX TASK</span>
            <h1>What should Codex work on?</h1>
            <p title={props.projectPath}>Changes are scoped to {props.projectPath}</p>
          </div>
        </header>

        <textarea
          autofocus
          value={prompt()}
          onInput={(event) => setPrompt(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Describe the feature, bug, refactor, or investigation. Include acceptance criteria when they matter…"
        />

        <div class="agent-composer-grid">
          <label>
            <span>Model</span>
            <Select
              value={props.model}
              options={modelOptions()}
              onChange={props.onModel}
              ariaLabel="Codex model"
              placeholder="Choose a model"
            />
          </label>
          <label>
            <span>Reasoning</span>
            <Select
              value={props.effort}
              disabled={!efforts().length}
              options={effortOptions()}
              onChange={props.onEffort}
              ariaLabel="Reasoning effort"
              placeholder="Default effort"
            />
          </label>
        </div>

        <fieldset class="agent-permissions">
          <legend>Permissions</legend>
          <For each={PERMISSION_OPTIONS}>
            {(option) => (
              <label class={props.permission === option.id ? "selected" : ""}>
                <input
                  type="radio"
                  name="agent-permission"
                  checked={props.permission === option.id}
                  onChange={() => props.onPermission(option.id)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            )}
          </For>
        </fieldset>

        <Show when={props.permission === "full-access"}>
          <div class="agent-permission-warning">
            Full access removes the filesystem sandbox and approval prompts for this task.
          </div>
        </Show>

        <footer>
          <span><kbd>⌘</kbd><kbd>↵</kbd> start task</span>
          <div>
            <Show when={props.onCancel}>
              <button class="agent-secondary" onClick={props.onCancel}>Cancel</button>
            </Show>
            <button
              class="agent-primary"
              disabled={!prompt().trim() || !props.model || props.submitting}
              onClick={submit}
            >
              <Show when={props.submitting} fallback={<>Start task <Icon name="chevronRight" /></>}>
                <span class="agent-spinner small" /> Starting…
              </Show>
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}
