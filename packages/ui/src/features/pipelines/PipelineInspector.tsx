import { For, Match, Show, Switch, createMemo } from "solid-js";
import type { CodexModel } from "../../bridge/tauri";
import { Icon, Select, type SelectOption } from "../../design";
import { PERMISSION_OPTIONS } from "../agents/types";
import type { PipelineEdgePatch, PipelineNodePatch } from "./pipelineStore";
import type {
  PipelineAgentNode,
  PipelineApprovalNode,
  PipelineDefinition,
  PipelineIntegrationNode,
} from "./types";

interface PipelineInspectorProps {
  pipeline: PipelineDefinition;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  models: readonly CodexModel[];
  disabled: boolean;
  onRenamePipeline: (name: string) => void;
  onUpdateNode: (nodeId: string, patch: PipelineNodePatch) => void;
  onUpdateEdge: (edgeId: string, patch: PipelineEdgePatch) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
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
  { value: "blue", label: "Blue", description: "Analysis stages" },
  { value: "orange", label: "Orange", description: "High-impact stages" },
];

const INTEGRATION_ACTIONS: SelectOption[] = [
  {
    value: "commit-push",
    label: "Commit & push",
    description: "Create a commit, then push the current branch to its configured upstream",
  },
  {
    value: "commit",
    label: "Commit only",
    description: "Create a local commit without pushing it",
  },
];

const CONNECTION_MODES: SelectOption[] = [
  {
    value: "automatic",
    label: "Automatic handoff",
    description: "Start the downstream step as soon as its inputs are ready",
  },
  {
    value: "approval",
    label: "Require approval",
    description: "Pause before the downstream step starts",
  },
];

export function PipelineInspector(props: PipelineInspectorProps) {
  let headingRef: HTMLElement | undefined;
  const node = createMemo(() =>
    props.pipeline.nodes.find((entry) => entry.id === props.selectedNodeId) ?? null,
  );
  const edge = createMemo(() =>
    props.pipeline.edges.find((entry) => entry.id === props.selectedEdgeId) ?? null,
  );
  const modelOptions = createMemo<SelectOption[]>(() => props.models.map((model) => ({
    value: model.model,
    label: model.displayName || model.model,
    description: model.description,
  })));
  const selectedModel = (agent: PipelineAgentNode) =>
    props.models.find((model) => model.model === agent.model);
  const effortOptions = (agent: PipelineAgentNode): SelectOption[] =>
    (selectedModel(agent)?.supportedReasoningEfforts ?? []).map((option) => ({
      value: option.reasoningEffort,
      label: option.reasoningEffort,
      description: option.description,
    }));
  const nodeName = (id: string) => props.pipeline.nodes.find((entry) => entry.id === id)?.name ?? id;
  const deleteStep = (step: PipelineAgentNode | PipelineIntegrationNode | PipelineApprovalNode) => {
    const connections = props.pipeline.edges.filter(
      (entry) => entry.source === step.id || entry.target === step.id,
    ).length;
    if (
      connections > 0 &&
      !window.confirm(
        `Remove ${step.name} and ${connections} connected ${connections === 1 ? "wire" : "wires"}?`,
      )
    ) return;
    props.onDeleteNode(step.id);
    queueMicrotask(() => headingRef?.focus());
  };

  return (
    <aside class="pipeline-inspector" aria-label="Pipeline inspector">
      <header ref={headingRef} class="pipeline-inspector-head" tabindex="-1">
        <span class="pipeline-eyebrow">INSPECTOR</span>
        <strong>{node()?.name ?? (edge() ? "Connection" : "Pipeline settings")}</strong>
      </header>

      <div class="pipeline-inspector-body">
        <Switch>
          <Match when={node()?.type === "agent" ? node() as PipelineAgentNode : null}>
            {(agent) => (
              <>
                <label class="pipeline-field">
                  <span>Agent name</span>
                  <input
                    value={agent().name}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(agent().id, { name: event.currentTarget.value })}
                  />
                </label>
                <label class="pipeline-field">
                  <span>Instructions</span>
                  <textarea
                    rows="7"
                    value={agent().instructions}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(agent().id, { instructions: event.currentTarget.value })}
                  />
                  <small>Authoritative objective for this stage. Upstream results are passed as untrusted data.</small>
                </label>
                <div class="pipeline-field">
                  <span>Codex model</span>
                  <Select
                    value={agent().model}
                    options={modelOptions()}
                    onChange={(model) => {
                      const match = props.models.find((entry) => entry.model === model);
                      props.onUpdateNode(agent().id, {
                        model,
                        effort: match?.defaultReasoningEffort ?? agent().effort,
                      });
                    }}
                    ariaLabel={`Model for ${agent().name}`}
                    placeholder="Choose a model"
                    disabled={props.disabled || !props.models.length}
                  />
                </div>
                <div class="pipeline-inspector-grid">
                  <div class="pipeline-field">
                    <span>Reasoning</span>
                    <Select
                      value={agent().effort}
                      options={effortOptions(agent())}
                      onChange={(effort) => props.onUpdateNode(agent().id, { effort })}
                      ariaLabel={`Reasoning effort for ${agent().name}`}
                      disabled={props.disabled || !effortOptions(agent()).length}
                      compact
                    />
                  </div>
                  <div class="pipeline-field">
                    <span>Retries</span>
                    <Select
                      value={String(agent().retryCount)}
                      options={RETRY_OPTIONS}
                      onChange={(value) => props.onUpdateNode(agent().id, { retryCount: Number(value) })}
                      ariaLabel={`Retry count for ${agent().name}`}
                      disabled={props.disabled}
                      compact
                    />
                  </div>
                </div>
                <div class="pipeline-field">
                  <span>Project access</span>
                  <Select
                    value={agent().permission}
                    options={PERMISSION_SELECT}
                    onChange={(permission) => props.onUpdateNode(agent().id, { permission: permission as PipelineAgentNode["permission"] })}
                    ariaLabel={`Project access for ${agent().name}`}
                    disabled={props.disabled}
                  />
                </div>
                <div class="pipeline-field">
                  <span>Station color</span>
                  <Select
                    value={agent().color}
                    options={COLOR_OPTIONS}
                    onChange={(color) => props.onUpdateNode(agent().id, { color })}
                    ariaLabel={`Station color for ${agent().name}`}
                    disabled={props.disabled}
                    compact
                  />
                </div>
                <button
                  type="button"
                  class="pipeline-danger-button"
                  disabled={props.disabled}
                  onClick={() => deleteStep(agent())}
                >
                  Remove agent
                </button>
              </>
            )}
          </Match>

          <Match when={node()?.type === "approval" ? node() as PipelineApprovalNode : null}>
            {(approval) => (
              <>
                <div class="pipeline-integration-card pipeline-approval-card">
                  <span class="pipeline-integration-logo"><Icon name="diagWarn" /></span>
                  <span>
                    <strong>Human approval</strong>
                    <small>Pauses the run before any downstream steps begin</small>
                  </span>
                </div>
                <label class="pipeline-field">
                  <span>Step name</span>
                  <input
                    value={approval().name}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(approval().id, { name: event.currentTarget.value })}
                  />
                </label>
                <label class="pipeline-field">
                  <span>Approval message</span>
                  <textarea
                    rows="5"
                    value={approval().message}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(approval().id, { message: event.currentTarget.value })}
                  />
                  <small>Explain what the reviewer should check before allowing the pipeline to continue.</small>
                </label>
                <p class="pipeline-inspector-note">
                  Approving passes the upstream handoff through unchanged. Rejecting stops this run and skips every downstream step.
                </p>
                <button
                  type="button"
                  class="pipeline-danger-button"
                  disabled={props.disabled}
                  onClick={() => deleteStep(approval())}
                >
                  Remove approval gate
                </button>
              </>
            )}
          </Match>

          <Match when={node()?.type === "integration" ? node() as PipelineIntegrationNode : null}>
            {(integration) => (
              <>
                <div class="pipeline-integration-card">
                  <span class="pipeline-integration-logo"><Icon name="git" /></span>
                  <span>
                    <strong>Git</strong>
                    <small>Uses this project’s Git remote and configured credentials</small>
                  </span>
                </div>
                <label class="pipeline-field">
                  <span>Step name</span>
                  <input
                    value={integration().name}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(integration().id, { name: event.currentTarget.value })}
                  />
                </label>
                <div class="pipeline-field">
                  <span>Action</span>
                  <Select
                    value={integration().action}
                    options={INTEGRATION_ACTIONS}
                    onChange={(action) => props.onUpdateNode(integration().id, {
                      action: action as PipelineIntegrationNode["action"],
                    })}
                    ariaLabel={`Git action for ${integration().name}`}
                    disabled={props.disabled}
                  />
                </div>
                <label class="pipeline-field">
                  <span>Commit message</span>
                  <input
                    value={integration().commitMessage}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(integration().id, {
                      commitMessage: event.currentTarget.value,
                    })}
                  />
                  <small>Use {"{{task}}"} to insert the task title. Subjects are limited to 72 characters.</small>
                </label>
                <label class="pipeline-integration-check">
                  <input
                    type="checkbox"
                    checked={integration().stageAll}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(integration().id, {
                      stageAll: event.currentTarget.checked,
                    })}
                  />
                  <span>
                    <strong>Stage all project changes</strong>
                    <small>Includes modified, deleted, and untracked files when this step runs.</small>
                  </span>
                </label>
                <p class="pipeline-inspector-note">
                  Push runs non-interactively against the branch’s configured upstream. Missing credentials or upstream configuration stop the pipeline with a visible error.
                </p>
                <button
                  type="button"
                  class="pipeline-danger-button"
                  disabled={props.disabled}
                  onClick={() => deleteStep(integration())}
                >
                  Remove integration
                </button>
              </>
            )}
          </Match>

          <Match when={node()}>
            {(terminal) => (
              <>
                <div class={`pipeline-terminal-badge ${terminal().type}`}>{terminal().type}</div>
                <label class="pipeline-field">
                  <span>Display name</span>
                  <input
                    value={terminal().name}
                    disabled={props.disabled}
                    onChange={(event) => props.onUpdateNode(terminal().id, { name: event.currentTarget.value })}
                  />
                </label>
                <p class="pipeline-inspector-note">
                  {terminal().type === "input"
                    ? "Every run starts here with the task from the run dock. Its position is fixed."
                    : "The result node joins its immediate upstream handoffs in wire order. Its position is fixed."}
                </p>
              </>
            )}
          </Match>

          <Match when={edge()}>
            {(connection) => (
              <>
                <div class="pipeline-connection-summary">
                  <strong>{nodeName(connection().source)}</strong>
                  <span>→</span>
                  <strong>{nodeName(connection().target)}</strong>
                </div>
                <div class="pipeline-field">
                  <span>Connection type</span>
                  <Select
                    value={connection().mode}
                    options={CONNECTION_MODES}
                    onChange={(mode) => props.onUpdateEdge(connection().id, {
                      mode: mode as "automatic" | "approval",
                    })}
                    ariaLabel={`Connection type from ${nodeName(connection().source)} to ${nodeName(connection().target)}`}
                    disabled={props.disabled}
                  />
                </div>
                <Show when={connection().mode === "approval"}>
                  <label class="pipeline-field">
                    <span>Approval message</span>
                    <textarea
                      rows="5"
                      value={connection().approvalMessage}
                      disabled={props.disabled}
                      onChange={(event) => props.onUpdateEdge(connection().id, {
                        approvalMessage: event.currentTarget.value,
                      })}
                    />
                    <small>Shown when this handoff pauses before the downstream step.</small>
                  </label>
                </Show>
                <p class="pipeline-inspector-note">
                  Handoff order {connection().order + 1}. {connection().mode === "approval"
                    ? "The target waits here for a human decision after all upstream work is ready."
                    : "The upstream response becomes bounded, untrusted context for the next agent."}
                </p>
                <button
                  type="button"
                  class="pipeline-danger-button"
                  disabled={props.disabled}
                  onClick={() => props.onDeleteEdge(connection().id)}
                >
                  Remove connection
                </button>
              </>
            )}
          </Match>

          <Match when={true}>
            <label class="pipeline-field">
              <span>Pipeline name</span>
              <input
                value={props.pipeline.name}
                disabled={props.disabled}
                onChange={(event) => props.onRenamePipeline(event.currentTarget.value)}
              />
            </label>
            <div class="pipeline-stat-grid">
              <div><strong>{props.pipeline.nodes.filter((entry) => entry.type === "agent" || entry.type === "integration" || entry.type === "approval").length}</strong><span>Steps</span></div>
              <div><strong>{props.pipeline.edges.length}</strong><span>Wires</span></div>
            </div>
            <div class="pipeline-inspector-guide">
              <strong>Build the flow</strong>
              <ol>
                <li>Add Codex agents and integration steps.</li>
                <li>Connect steps with automatic or approval handoffs.</li>
                <li>Assign this template to tasks from Task runs.</li>
              </ol>
            </div>
            <Show when={props.disabled}>
              <p class="pipeline-inspector-note">The current run uses an immutable snapshot. Stop it before editing this design.</p>
            </Show>
          </Match>
        </Switch>
      </div>
    </aside>
  );
}
