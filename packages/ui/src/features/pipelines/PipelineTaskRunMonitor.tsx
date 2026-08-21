import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import type { CodexServerRequest } from "../../bridge/tauri";
import { Icon } from "../../design";
import { ServerRequestCard } from "../agents/ServerRequestCard";
import { buildTopologicalLayers } from "./graph";
import { pipelineRunLabel } from "./canvas/runState";
import type { PipelineApprovalDecision, PipelineDefinition, PipelineRun } from "./types";

interface PipelineTaskRunMonitorProps {
  pipeline: PipelineDefinition;
  run: PipelineRun | null;
  requests: readonly CodexServerRequest[];
  error: string | null;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
  onApproval: (
    kind: "node" | "edge",
    id: string,
    decision: PipelineApprovalDecision,
  ) => void;
  onClearError: () => void;
}

export function PipelineTaskRunMonitor(props: PipelineTaskRunMonitorProps) {
  const detailsId = createUniqueId();
  const [selectedStageId, setSelectedStageId] = createSignal<string | null>(null);
  const definition = () => props.run?.definition ?? props.pipeline;
  const orderedNodes = createMemo(() => {
    const graph = definition();
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    const layers = buildTopologicalLayers(graph);
    return layers
      ? layers.flatMap((layer) => layer.map((id) => byId.get(id)!).filter(Boolean))
      : graph.nodes;
  });
  const selectedStage = createMemo(() => {
    const id = selectedStageId();
    const node = id ? definition().nodes.find((entry) => entry.id === id) : null;
    return node ? { node, state: props.run?.nodes[node.id] } : null;
  });
  const pendingApproval = createMemo(() => {
    const run = props.run;
    if (!run) return null;
    const edgeState = Object.values(run.edges).find(
      (entry) => entry.status === "waitingForApproval",
    );
    const edge = edgeState
      ? run.definition.edges.find((entry) => entry.id === edgeState.edgeId)
      : null;
    if (edge) {
      const source = run.definition.nodes.find((entry) => entry.id === edge.source);
      const target = run.definition.nodes.find((entry) => entry.id === edge.target);
      return {
        kind: "edge" as const,
        id: edge.id,
        name: `${source?.name ?? "Upstream"} → ${target?.name ?? "Downstream"}`,
        message: edge.approvalMessage,
      };
    }
    const node = run.definition.nodes.find(
      (entry) => entry.type === "approval" && run.nodes[entry.id]?.status === "waitingForApproval",
    );
    return node?.type === "approval" ? {
      kind: "node" as const,
      id: node.id,
      name: node.name,
      message: node.message,
    } : null;
  });

  return (
    <section class="pipeline-task-monitor" aria-label="Task run details">
      <header>
        <div>
          <span class="pipeline-eyebrow">RUN TIMELINE</span>
          <strong>{props.run ? "Latest execution" : "Ready to run"}</strong>
        </div>
        <Show when={props.run}>
          {(run) => <span class={`pipeline-run-status status-${run().status}`}><span />{pipelineRunLabel(run().status)}</span>}
        </Show>
      </header>

      <div class="pipeline-stage-strip" aria-label="Pipeline stages">
        <For each={orderedNodes()}>
          {(node) => {
            const state = () => props.run?.nodes[node.id];
            return (
              <button
                type="button"
                class={`pipeline-stage-chip stage-${state()?.status ?? "idle"}`}
                aria-expanded={selectedStageId() === node.id}
                aria-controls={detailsId}
                onClick={() => setSelectedStageId((selected) => selected === node.id ? null : node.id)}
              >
                <span aria-hidden="true" />
                <strong>{node.name}</strong>
                <small>{pipelineRunLabel(state()?.status)}</small>
              </button>
            );
          }}
        </For>
      </div>

      <Show when={selectedStage()}>
        {(stage) => (
          <section id={detailsId} class="pipeline-stage-details">
            <header><strong>{stage().node.name}</strong><span>{pipelineRunLabel(stage().state?.status)}</span></header>
            <pre>{stage().state?.error ?? stage().state?.output ?? "This step has not produced output yet."}</pre>
          </section>
        )}
      </Show>

      <Show when={props.error ?? props.run?.error}>
        {(message) => (
          <div class="pipeline-run-error" role="alert">
            <span>{message()}</span>
            <button type="button" onClick={props.onClearError} aria-label="Dismiss error">×</button>
          </div>
        )}
      </Show>

      <Show when={props.requests.length}>
        <div class="pipeline-request-stack">
          <For each={props.requests}>
            {(request) => <ServerRequestCard request={request} onRespond={props.onRespond} />}
          </For>
        </div>
      </Show>

      <Show when={pendingApproval()}>
        {(approval) => (
          <section class="pipeline-approval-request" aria-label={`${approval().name} approval required`}>
            <span class="pipeline-approval-request-icon"><Icon name="diagWarn" size={17} /></span>
            <div>
              <span class="pipeline-eyebrow">APPROVAL REQUIRED</span>
              <strong>{approval().name}</strong>
              <p>{approval().message}</p>
            </div>
            <div class="pipeline-approval-request-actions">
              <button
                type="button"
                class="pipeline-approval-reject"
                onClick={() => props.onApproval(approval().kind, approval().id, "rejected")}
              >
                Reject run
              </button>
              <button
                type="button"
                class="pipeline-run-button"
                onClick={() => props.onApproval(approval().kind, approval().id, "approved")}
              >
                Approve & continue
              </button>
            </div>
          </section>
        )}
      </Show>

      <Show when={props.run?.output && props.run?.status === "completed"}>
        <details class="pipeline-result" open>
          <summary>Pipeline result</summary>
          <pre>{props.run!.output}</pre>
        </details>
      </Show>

      <Show when={!props.run}>
        <div class="pipeline-monitor-empty">
          <Icon name="play" size={16} />
          <span>Run this task to see live stages, approvals, integration steps, and the final handoff.</span>
        </div>
      </Show>
    </section>
  );
}
