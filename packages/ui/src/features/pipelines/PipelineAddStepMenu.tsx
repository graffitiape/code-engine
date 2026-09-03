import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "../../design";
import { PIPELINE_AGENT_PRESETS, type PipelineAgentPresetId } from "./agentPresets";
import type { SavedPipelineAgent } from "./pipelineAgentLibrary";

interface PipelineAddStepMenuProps {
  disabled: boolean;
  agentDisabled: boolean;
  savedAgents: readonly SavedPipelineAgent[];
  onAddAgent: (presetId: PipelineAgentPresetId) => void;
  onAddSavedAgent: (savedAgentId: string) => void;
  onDeleteSavedAgent: (savedAgentId: string) => boolean;
  onAddGit: () => void;
}

function permissionLabel(permission: SavedPipelineAgent["permission"]): string {
  if (permission === "read-only") return "Read only";
  if (permission === "full-access") return "Full access";
  return "Workspace access";
}

export function PipelineAddStepMenu(props: PipelineAddStepMenuProps) {
  const [open, setOpen] = createSignal(false);
  let rootRef: HTMLDivElement | undefined;

  onMount(() => {
    const closeOutside = (event: PointerEvent) => {
      if (rootRef && !rootRef.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    onCleanup(() => document.removeEventListener("pointerdown", closeOutside));
  });

  const choose = (action: () => void) => {
    setOpen(false);
    action();
  };
  const deleteSavedAgent = (savedAgentId: string) => {
    if (!props.onDeleteSavedAgent(savedAgentId)) return;
    setOpen(false);
    queueMicrotask(() => {
      rootRef?.querySelector<HTMLButtonElement>(".pipeline-add-step-trigger")?.focus();
    });
  };

  return (
    <div
      ref={rootRef}
      class={`pipeline-add-step-menu ${open() ? "open" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open()) {
          event.preventDefault();
          setOpen(false);
          rootRef?.querySelector<HTMLButtonElement>(".pipeline-add-step-trigger")?.focus();
        }
      }}
    >
      <button
        type="button"
        class="pipeline-add-step-trigger"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="plus" /> Add step <Icon name="chevronDown" />
      </button>

      <Show when={open()}>
        <div class="pipeline-add-step-popover" role="menu" aria-label="Pipeline step type">
          <Show when={props.savedAgents.length > 0}>
            <span>Saved agents</span>
            <For each={props.savedAgents}>
              {(agent) => (
                <div class="pipeline-saved-agent-row" role="none">
                  <button
                    type="button"
                    class="pipeline-saved-agent-add"
                    role="menuitem"
                    disabled={props.agentDisabled}
                    onClick={() => choose(() => props.onAddSavedAgent(agent.id))}
                  >
                    <span class={`pipeline-add-step-icon ${agent.color}`}><Icon name="command" /></span>
                    <span>
                      <strong>{agent.name}</strong>
                      <small>{agent.model} · {permissionLabel(agent.permission)}</small>
                    </span>
                  </button>
                  <button
                    type="button"
                    class="pipeline-saved-agent-delete"
                    role="menuitem"
                    aria-label={`Delete saved agent ${agent.name}`}
                    title={`Delete saved agent ${agent.name}`}
                    onClick={() => deleteSavedAgent(agent.id)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              )}
            </For>
            <span class="pipeline-add-step-section">Codex presets</span>
          </Show>
          <Show when={props.savedAgents.length === 0}>
            <span>Codex presets</span>
          </Show>
          <For each={PIPELINE_AGENT_PRESETS}>
            {(preset) => (
              <button
                type="button"
                role="menuitem"
                disabled={props.agentDisabled}
                onClick={() => choose(() => props.onAddAgent(preset.id))}
              >
                <span class={`pipeline-add-step-icon ${preset.color}`}><Icon name={preset.icon} /></span>
                <span>
                  <strong>{preset.label}</strong>
                  <small>{preset.description}</small>
                </span>
              </button>
            )}
          </For>
          <span class="pipeline-add-step-section">Automation</span>
          <button type="button" role="menuitem" onClick={() => choose(props.onAddGit)}>
            <span class="pipeline-add-step-icon git"><Icon name="git" /></span>
            <span>
              <strong>Git action</strong>
              <small>Stage, commit, and optionally push project changes</small>
            </span>
          </button>
        </div>
      </Show>
    </div>
  );
}
