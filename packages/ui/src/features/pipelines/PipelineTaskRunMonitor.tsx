import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import type { CodexServerRequest } from "../../bridge/tauri";
import { Icon, MarkdownText } from "../../design";
import type { FileLinkTarget } from "../../design/MarkdownText";
import { ServerRequestCard } from "../agents/ServerRequestCard";
import { buildTopologicalLayers } from "./graph";
import { pipelineRunLabel } from "./canvas/runState";
import { pipelineNodeCanRetry } from "./pipelineRunner";
import type {
  PipelineApprovalDecision,
  PipelineDefinition,
  PipelineNodeRunState,
  PipelineRun,
  PipelineRunStatus,
} from "./types";

interface PipelineTaskRunMonitorProps {
  pipeline: PipelineDefinition;
  run: PipelineRun | null;
  legacyRunStatus: PipelineRunStatus | null;
  runs: readonly PipelineRun[];
  onSelectRun: (id: string) => void;
  requests: readonly CodexServerRequest[];
  error: string | null;
  onRespond: (id: string | number, response: unknown) => Promise<void>;
  onApproval: (
    kind: "node" | "edge",
    id: string,
    decision: PipelineApprovalDecision,
  ) => void;
  onClearError: () => void;
  onOpenFile: (target: FileLinkTarget) => void;
  active: boolean;
  onOpenAgentThread: (threadId: string, cwd: string) => Promise<void>;
  onRetryStep: (runId: string, nodeId: string) => void;
  onConfigureGit: (cwd: string) => void;
}

export function pipelineStageHasChat(
  node: PipelineDefinition["nodes"][number],
  state: PipelineRun["nodes"][string] | undefined,
): boolean {
  return node.type === "agent" && Boolean(state?.threadId);
}

export function pipelineStageNeedsGitSetup(
  node: PipelineDefinition["nodes"][number],
  state: PipelineNodeRunState | undefined,
): boolean {
  return node.type === "integration" && node.provider === "git" && state?.status === "failed";
}

export function openPipelineStageChat(
  threadId: string,
  cwd: string,
  onOpenAgentThread: (threadId: string, cwd: string) => Promise<void>,
): void {
  void onOpenAgentThread(threadId, cwd);
}

export function pipelineStagePresentation(
  state: PipelineNodeRunState | undefined,
  legacyRunStatus: PipelineRunStatus | null,
): { status: string; label: string } {
  if (state) return { status: state.status, label: pipelineRunLabel(state.status) };
  if (legacyRunStatus) return { status: "not-recorded", label: "Not recorded" };
  return { status: "idle", label: "Idle" };
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
  const chatStage = createMemo(() => {
    const stage = selectedStage();
    return stage && pipelineStageHasChat(stage.node, stage.state) ? stage : null;
  });
  const retryStage = createMemo(() => {
    const run = props.run;
    const stage = selectedStage();
    return run && stage && pipelineNodeCanRetry(run, stage.node.id) ? stage : null;
  });
  const gitSetupStage = createMemo(() => {
    const stage = selectedStage();
    return stage && pipelineStageNeedsGitSetup(stage.node, stage.state) ? stage : null;
  });
  const displayedRunStatus = () => props.run?.status ?? props.legacyRunStatus;
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
          <strong>{props.run ? "Execution history" : props.legacyRunStatus ? "Previous execution" : "Ready to run"}</strong>
          <Show when={props.run && props.runs.length > 0}>
            <select
              class="pipeline-run-history-select"
              aria-label="Select pipeline execution"
              value={props.run?.id}
              onChange={(event) => props.onSelectRun(event.currentTarget.value)}
            >
              <For each={props.runs}>{(run, index) => (
                <option value={run.id}>{`Run ${props.runs.length - index()} · ${new Date(run.createdAt).toLocaleString()} · ${pipelineRunLabel(run.status)}`}</option>
              )}</For>
            </select>
          </Show>
        </div>
        <Show when={displayedRunStatus()}>
          {(status) => <span class={`pipeline-run-status status-${status()}`}><span />{pipelineRunLabel(status())}</span>}
        </Show>
      </header>

      <div class="pipeline-stage-strip" aria-label="Pipeline stages">
        <For each={orderedNodes()}>
          {(node) => {
            const state = () => props.run?.nodes[node.id];
            const presentation = () => pipelineStagePresentation(state(), props.legacyRunStatus);
            return (
              <button
                type="button"
                class={`pipeline-stage-chip stage-${presentation().status}`}
                aria-expanded={selectedStageId() === node.id}
                aria-controls={detailsId}
                onClick={() => setSelectedStageId((selected) => selected === node.id ? null : node.id)}
              >
                <span aria-hidden="true" />
                <strong>{node.name}</strong>
                <small>{presentation().label}</small>
              </button>
            );
          }}
        </For>
      </div>

      <Show when={selectedStage()}>
        {(stage) => (
          <section id={detailsId} class="pipeline-stage-details">
            <header>
              <strong>{stage().node.name}</strong>
              <span>{pipelineStagePresentation(stage().state, props.legacyRunStatus).label}</span>
            </header>
            <Show when={stage().state} fallback={
              <p class="pipeline-stage-history-unavailable">
                {props.legacyRunStatus
                  ? "Detailed status and chat history were not recorded for this earlier execution."
                  : "This step has not run yet."}
              </p>
            }>
              {(state) => (
                <Show when={!state().error} fallback={<pre>{state().error}</pre>}>
                  <MarkdownText
                    class="pipeline-stage-output"
                    text={state().output ?? "This step has not produced output yet."}
                    onOpenFile={props.onOpenFile}
                  />
                </Show>
              )}
            </Show>
            <Show when={chatStage() || retryStage() || gitSetupStage()}>
              <div class="pipeline-stage-chat-link">
                <Show when={gitSetupStage()}>
                  <button
                    class="pipeline-secondary-button"
                    type="button"
                    disabled={props.active}
                    onClick={() => props.onConfigureGit(props.run!.cwd)}
                  >
                    Fix Git setup
                  </button>
                </Show>
                <Show when={retryStage()}>
                  {(retry) => (
                    <button
                      class="pipeline-secondary-button"
                      type="button"
                      disabled={props.active}
                      onClick={() => props.onRetryStep(props.run!.id, retry().node.id)}
                    >
                      Retry step
                    </button>
                  )}
                </Show>
                <Show when={chatStage()}>
                  {(chat) => (
                    <button
                      class="pipeline-secondary-button"
                      type="button"
                      onClick={() => openPipelineStageChat(
                        chat().state!.threadId!,
                        props.run!.cwd,
                        props.onOpenAgentThread,
                      )}
                    >
                      Open chat in Agents <Icon name="chevronRight" />
                    </button>
                  )}
                </Show>
              </div>
            </Show>
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
          <MarkdownText class="pipeline-result-output" text={props.run!.output} onOpenFile={props.onOpenFile} />
        </details>
      </Show>

      <Show when={!props.run}>
        <Show
          when={props.legacyRunStatus}
          fallback={
            <div class="pipeline-monitor-empty">
              <Icon name="play" size={16} />
              <span>Run this task to see live stages, approvals, integration steps, and the final handoff.</span>
            </div>
          }
        >
          {(status) => (
            <div class="pipeline-legacy-run-notice">
              <Icon name="diagWarn" size={16} />
              <span>
                This execution finished as <strong>{pipelineRunLabel(status()).toLowerCase()}</strong>,
                but it predates detailed run-history recording. Run the task again to capture exact stage statuses and chat links.
              </span>
            </div>
          )}
        </Show>
      </Show>
    </section>
  );
}
