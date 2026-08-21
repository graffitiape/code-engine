import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "../../design";
import { PIPELINE_AGENT_PRESETS, type PipelineAgentPresetId } from "./agentPresets";

interface PipelineAddStepMenuProps {
  disabled: boolean;
  agentDisabled: boolean;
  onAddAgent: (presetId: PipelineAgentPresetId) => void;
  onAddGit: () => void;
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
          <span>Codex presets</span>
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
