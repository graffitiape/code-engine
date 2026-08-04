import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import type { CodexServerRequest } from "../../bridge/tauri";
import { Icon } from "../../design";
import { ServerRequestCard } from "../agents/ServerRequestCard";
import { buildTopologicalLayers, validatePipelineGraph } from "./graph";
import { pipelineRunLabel } from "./canvas/runState";
import type { PipelineDefinition, PipelineRun } from "./types";

interface PipelineRunDockProps {
  pipeline: PipelineDefinition;
  task: string;
  run: PipelineRun | null;
  requests: readonly CodexServerRequest[];
  codexReady: boolean;
  active: boolean;
  error: string | null;
  onTask: (task: string) => void;
  onRun: () => void;
  onStop: () => void;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
  onOpenAgents: () => void;
  onClearError: () => void;
}

function statusLabel(status: PipelineRun["status"] | undefined): string {
  if (status === "needsAttention") return "Needs attention";
  if (status === "cancelling") return "Stopping";
  if (status === "validating") return "Validating";
  if (status === "queued") return "Queued";
  if (status === "completed") return "Completed";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed") return "Failed";
  if (status === "running") return "Running";
  return "Ready";
}

export function PipelineRunDock(props: PipelineRunDockProps) {
  const stageDetailsId = createUniqueId();
  const [selectedStageId, setSelectedStageId] = createSignal<string | null>(null);
  const validation = createMemo(() => validatePipelineGraph(props.pipeline));
  const orderedNodes = createMemo(() => {
    const byId = new Map(props.pipeline.nodes.map((node) => [node.id, node]));
    const layers = buildTopologicalLayers(props.pipeline);
    return layers ? layers.flatMap((layer) => layer.map((id) => byId.get(id)!).filter(Boolean)) : props.pipeline.nodes;
  });
  const visibleRun = () => props.run?.pipelineId === props.pipeline.id ? props.run : null;
  const selectedStage = createMemo(() => {
    const id = selectedStageId();
    const node = id ? props.pipeline.nodes.find((entry) => entry.id === id) : null;
    return node ? { node, state: visibleRun()?.nodes[node.id] } : null;
  });
  const canRun = () =>
    props.codexReady && validation().valid && Boolean(props.task.trim()) && !props.active;

  return (
    <section class="pipeline-run-dock" aria-label="Run pipeline">
      <div class="pipeline-run-compose">
        <div class="pipeline-run-heading">
          <div>
            <span class="pipeline-eyebrow">TASK INPUT</span>
            <strong>Send work through the factory</strong>
          </div>
          <span class={`pipeline-run-status status-${visibleRun()?.status ?? "ready"}`}>
            <span aria-hidden="true" /> {statusLabel(visibleRun()?.status)}
          </span>
        </div>
        <textarea
          value={props.task}
          disabled={props.active}
          placeholder="Describe a development task with acceptance criteria…"
          aria-label="Pipeline task"
          onInput={(event) => props.onTask(event.currentTarget.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canRun()) {
              event.preventDefault();
              props.onRun();
            }
          }}
        />
        <div class="pipeline-run-actions">
          <Show
            when={props.active}
            fallback={
              <Show
                when={props.codexReady}
                fallback={
                  <button type="button" class="pipeline-secondary-button" onClick={props.onOpenAgents}>
                    Connect Codex in Agents
                  </button>
                }
              >
                <button type="button" class="pipeline-run-button" disabled={!canRun()} onClick={props.onRun}>
                  <Icon name="play" /> Run pipeline <kbd>⌘↵</kbd>
                </button>
              </Show>
            }
          >
            <button type="button" class="pipeline-stop-button" onClick={props.onStop}>
              <span aria-hidden="true">■</span> Stop pipeline
            </button>
          </Show>
          <span>{props.pipeline.nodes.filter((node) => node.type === "agent").length} Codex stages</span>
        </div>
      </div>

      <div class="pipeline-run-monitor">
        <div class="pipeline-stage-strip" aria-label="Run stages">
          <For each={orderedNodes()}>
            {(node) => {
              const state = () => visibleRun()?.nodes[node.id];
              return (
                <button
                  type="button"
                  class={`pipeline-stage-chip stage-${state()?.status ?? "idle"}`}
                  aria-expanded={selectedStageId() === node.id}
                  aria-controls={stageDetailsId}
                  aria-label={`${node.name}: ${pipelineRunLabel(state()?.status)}. ${state()?.error ? state()!.error : state()?.output ? "Output available." : "No output yet."}`}
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
            <section
              id={stageDetailsId}
              class="pipeline-stage-details"
              aria-label={`${stage().node.name} stage details`}
            >
              <header>
                <strong>{stage().node.name}</strong>
                <span>{pipelineRunLabel(stage().state?.status)}</span>
              </header>
              <pre>{stage().state?.error ?? stage().state?.output ?? "This stage has not produced output yet."}</pre>
            </section>
          )}
        </Show>

        <Show when={!validation().valid}>
          <details class="pipeline-validation-message" open>
            <summary>Complete the graph before running · {validation().issues.length} {validation().issues.length === 1 ? "issue" : "issues"}</summary>
            <ul>
              <For each={validation().issues}>{(issue) => <li>{issue.message}</li>}</For>
            </ul>
          </details>
        </Show>

        <Show when={props.error ?? visibleRun()?.error}>
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

        <Show when={visibleRun()?.output && visibleRun()?.status === "completed"}>
          <details class="pipeline-result" open>
            <summary>Pipeline result</summary>
            <pre>{visibleRun()!.output}</pre>
          </details>
        </Show>

        <Show when={!visibleRun() && validation().valid}>
          <div class="pipeline-monitor-empty">
            <Icon name="branch" size={18} />
            <span>Validated DAG. Run it to see live stage states, approvals, and the final handoff.</span>
          </div>
        </Show>
        <div class="pipeline-sr-only" role="status" aria-live="polite" aria-atomic="true">
          Pipeline {statusLabel(visibleRun()?.status)}.
          {props.requests.length ? " Codex needs your approval or input." : ""}
          {visibleRun()?.error ? ` ${visibleRun()!.error}` : ""}
        </div>
      </div>
    </section>
  );
}
