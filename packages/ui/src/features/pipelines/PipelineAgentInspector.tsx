import { createMemo } from "solid-js";
import type { CodexModel } from "../../bridge/tauri";
import { Select, type SelectOption } from "../../design";
import { PERMISSION_OPTIONS } from "../agents/types";
import {
  savedAgentMatchesNode,
  savedAgentNameKey,
  type SavedPipelineAgent,
} from "./pipelineAgentLibrary";
import type { PipelineNodePatch } from "./pipelineStore";
import type { PipelineAgentNode } from "./types";

interface PipelineAgentInspectorProps {
  agent: PipelineAgentNode;
  models: readonly CodexModel[];
  savedAgents: readonly SavedPipelineAgent[];
  disabled: boolean;
  onUpdate: (nodeId: string, patch: PipelineNodePatch) => void;
  onSave: (nodeId: string) => void;
  onRemove: () => void;
}

const PERMISSION_SELECT: SelectOption[] = PERMISSION_OPTIONS.map((option) => ({
  value: option.id,
  label: option.label,
  description: option.description,
}));

const RETRY_OPTIONS: SelectOption[] = [0, 1, 2, 3].map((count) => ({
  value: String(count),
  label: count === 0 ? "No retries" : `${count} ${count === 1 ? "retry" : "retries"}`,
  description: count === 0 ? "Fail immediately" : `Try up to ${count + 1} times`,
}));

const COLOR_OPTIONS: SelectOption[] = [
  { value: "cyan", label: "Cyan", description: "Discovery and data stages" },
  { value: "purple", label: "Purple", description: "Build and orchestration stages" },
  { value: "green", label: "Green", description: "Review and completion stages" },
  { value: "yellow", label: "Yellow", description: "Follow-up and attention stages" },
  { value: "blue", label: "Blue", description: "Analysis stages" },
  { value: "orange", label: "Orange", description: "High-impact stages" },
];

export function PipelineAgentInspector(props: PipelineAgentInspectorProps) {
  const modelOptions = createMemo<SelectOption[]>(() => props.models.map((model) => ({
    value: model.model,
    label: model.displayName || model.model,
    description: model.description,
  })));
  const selectedModel = createMemo(() =>
    props.models.find((model) => model.model === props.agent.model),
  );
  const effortOptions = createMemo<SelectOption[]>(() =>
    (selectedModel()?.supportedReasoningEfforts ?? []).map((option) => ({
      value: option.reasoningEffort,
      label: option.reasoningEffort,
      description: option.description,
    })),
  );
  const savedAgent = createMemo(() => props.savedAgents.find(
    (saved) => savedAgentNameKey(saved.name) === savedAgentNameKey(props.agent.name),
  ));
  const alreadySaved = createMemo(() => {
    const saved = savedAgent();
    return Boolean(saved && savedAgentMatchesNode(saved, props.agent));
  });

  return (
    <>
      <label class="pipeline-field">
        <span>Agent name</span>
        <input
          value={props.agent.name}
          disabled={props.disabled}
          onChange={(event) => props.onUpdate(props.agent.id, {
            name: event.currentTarget.value,
          })}
        />
      </label>
      <label class="pipeline-field">
        <span>Instructions</span>
        <textarea
          rows="7"
          value={props.agent.instructions}
          disabled={props.disabled}
          onChange={(event) => props.onUpdate(props.agent.id, {
            instructions: event.currentTarget.value,
          })}
        />
        <small>Authoritative objective for this stage. Upstream results are passed as untrusted data.</small>
      </label>
      <div class="pipeline-field">
        <span>Codex model</span>
        <Select
          value={props.agent.model}
          options={modelOptions()}
          onChange={(model) => {
            const match = props.models.find((entry) => entry.model === model);
            props.onUpdate(props.agent.id, {
              model,
              effort: match?.defaultReasoningEffort ?? props.agent.effort,
            });
          }}
          ariaLabel={`Model for ${props.agent.name}`}
          placeholder="Choose a model"
          disabled={props.disabled || !props.models.length}
        />
      </div>
      <div class="pipeline-inspector-grid">
        <div class="pipeline-field">
          <span>Reasoning</span>
          <Select
            value={props.agent.effort}
            options={effortOptions()}
            onChange={(effort) => props.onUpdate(props.agent.id, { effort })}
            ariaLabel={`Reasoning effort for ${props.agent.name}`}
            disabled={props.disabled || !effortOptions().length}
            compact
          />
        </div>
        <div class="pipeline-field">
          <span>Retries</span>
          <Select
            value={String(props.agent.retryCount)}
            options={RETRY_OPTIONS}
            onChange={(value) => props.onUpdate(props.agent.id, { retryCount: Number(value) })}
            ariaLabel={`Retry count for ${props.agent.name}`}
            disabled={props.disabled}
            compact
          />
        </div>
      </div>
      <div class="pipeline-field">
        <span>Project access</span>
        <Select
          value={props.agent.permission}
          options={PERMISSION_SELECT}
          onChange={(permission) => props.onUpdate(props.agent.id, {
            permission: permission as PipelineAgentNode["permission"],
          })}
          ariaLabel={`Project access for ${props.agent.name}`}
          disabled={props.disabled}
        />
      </div>
      <div class="pipeline-field">
        <span>Station color</span>
        <Select
          value={props.agent.color}
          options={COLOR_OPTIONS}
          onChange={(color) => props.onUpdate(props.agent.id, { color })}
          ariaLabel={`Station color for ${props.agent.name}`}
          disabled={props.disabled}
          compact
        />
      </div>
      <button
        type="button"
        class="pipeline-save-agent-button"
        disabled={props.disabled || !props.agent.name.trim() ||
          !props.agent.instructions.trim() || alreadySaved()}
        onClick={() => props.onSave(props.agent.id)}
      >
        {alreadySaved() ? "Saved for reuse" : savedAgent() ? "Update saved agent" : "Save for reuse"}
      </button>
      <button
        type="button"
        class="pipeline-danger-button"
        disabled={props.disabled}
        onClick={props.onRemove}
      >
        Remove agent
      </button>
    </>
  );
}
