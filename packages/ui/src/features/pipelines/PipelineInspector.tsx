import { For, Match, Show, Switch, createMemo } from "solid-js";
import type { CodexModel } from "../../bridge/tauri";
import { Select, type SelectOption } from "../../design";
import { PERMISSION_OPTIONS } from "../agents/types";
import type { PipelineAgentNode, PipelineDefinition } from "./types";

interface PipelineInspectorProps {
  pipeline: PipelineDefinition;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  models: readonly CodexModel[];
  disabled: boolean;
  onRenamePipeline: (name: string) => void;
  onUpdateNode: (nodeId: string, patch: Partial<PipelineAgentNode> & { name?: string }) => void;
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
  const deleteAgent = (agent: PipelineAgentNode) => {
    const connections = props.pipeline.edges.filter(
      (entry) => entry.source === agent.id || entry.target === agent.id,
    ).length;
    if (
      connections > 0 &&
      !window.confirm(
        `Remove ${agent.name} and ${connections} connected ${connections === 1 ? "wire" : "wires"}?`,
      )
    ) return;
    props.onDeleteNode(agent.id);
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
                  onClick={() => deleteAgent(agent())}
                >
                  Remove agent
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
                <p class="pipeline-inspector-note">
                  Handoff order {connection().order + 1}. The upstream response becomes bounded, untrusted context for the next agent.
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
              <div><strong>{props.pipeline.nodes.filter((entry) => entry.type === "agent").length}</strong><span>Agents</span></div>
              <div><strong>{props.pipeline.edges.length}</strong><span>Wires</span></div>
            </div>
            <div class="pipeline-inspector-guide">
              <strong>Build the flow</strong>
              <ol>
                <li>Add and configure Codex agents.</li>
                <li>Connect output ports to downstream inputs.</li>
                <li>Enter a task and run the validated DAG.</li>
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
