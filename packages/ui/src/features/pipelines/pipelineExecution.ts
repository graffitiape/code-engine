import { codexRespondServerRequest, type CodexServerRequest } from "../../bridge/tauri";
import { registerAppCloseGuard } from "../../stores/appLifecycle";
import { registerWorkspaceSwitchGuard } from "../../stores/workspace";
import {
  subscribeCodexEvents,
  subscribeCodexServerRequests,
  subscribeCodexStatus,
  useAgentState,
} from "../agents/agentStore";
import { asRecord, fieldString } from "../agents/types";
import { createPipelineRun, executePipelineRun } from "./pipelineRunner";
import { PipelineTurnCleanupError } from "./codexRuntime";
import type { PipelineApprovalDecision } from "./types";
import {
  patchPipelineRun,
  patchPipelineRunEdge,
  patchPipelineRunNode,
  patchPipelineTaskRun,
  pipelineRunIsActive,
  setPipelineError,
  setPipelineRequests,
  setPipelineRun,
  usePipelineState,
} from "./pipelineStore";

interface ThreadOwner {
  runId: string;
  nodeId: string;
  generation: number | null;
  turnId: string | null;
  active: boolean;
}

interface PendingApprovalGate {
  runId: string;
  requestId: string;
  kind: "node" | "edge";
  respond: (decision: PipelineApprovalDecision) => void;
  cancel: () => void;
}

const threadOwners = new Map<string, ThreadOwner>();
const pendingApprovalGates = new Map<string, PendingApprovalGate>();
let activeController: AbortController | null = null;
let activeExecution: Promise<void> | null = null;
let activeRunId: string | null = null;
let stopRequested = false;
let lastStopError: Error | null = null;
let lastStopGeneration: number | null = null;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function waitForPipelineApproval(
  runId: string,
  requestId: string,
  kind: PendingApprovalGate["kind"],
  signal: AbortSignal,
): Promise<PipelineApprovalDecision> {
  return new Promise((resolve, reject) => {
    const key = `${kind}:${requestId}`;
    const cleanup = () => {
      signal.removeEventListener("abort", cancel);
      pendingApprovalGates.delete(key);
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("Pipeline run stopped", "AbortError"));
    };
    const respond = (decision: PipelineApprovalDecision) => {
      cleanup();
      resolve(decision);
    };
    if (signal.aborted) {
      cancel();
      return;
    }
    signal.addEventListener("abort", cancel, { once: true });
    pendingApprovalGates.set(key, { runId, requestId, kind, respond, cancel });
  });
}

function requestThreadId(request: CodexServerRequest): string | null {
  const params = asRecord(request.params);
  return fieldString(params, "threadId") ?? fieldString(params, "conversationId");
}

function requestTurnId(request: CodexServerRequest): string | null {
  return fieldString(asRecord(request.params), "turnId");
}

function releaseThreadOwner(
  threadId: string | null,
  turnId: string | null,
  runId: string,
  nodeId: string,
) {
  if (!threadId) return;
  const owner = threadOwners.get(threadId);
  if (
    !owner ||
    owner.runId !== runId ||
    owner.nodeId !== nodeId ||
    (turnId !== null && owner.turnId !== null && owner.turnId !== turnId)
  ) return;
  owner.active = false;
  threadOwners.delete(threadId);
  const remaining = usePipelineState().pendingRequests.filter(
    (request) => requestThreadId(request) !== threadId,
  );
  if (remaining.length !== usePipelineState().pendingRequests.length) {
    setPipelineRequests(remaining);
  }
}

function removeRequest(requestId: string | number) {
  const state = usePipelineState();
  const request = state.pendingRequests.find((entry) => entry.id === requestId);
  const remaining = state.pendingRequests.filter((entry) => entry.id !== requestId);
  setPipelineRequests(remaining);
  const threadId = request ? requestThreadId(request) : null;
  const owner = threadId ? threadOwners.get(threadId) : null;
  const currentRun = usePipelineState().run;
  const ownerNode = owner && currentRun?.id === owner.runId
    ? currentRun.nodes[owner.nodeId]
    : null;
  if (
    owner &&
    currentRun?.status === "needsAttention" &&
    ownerNode?.status === "waitingForApproval" &&
    !remaining.some((entry) => requestThreadId(entry) === threadId)
  ) {
    patchPipelineRunNode(owner.nodeId, { status: "running" }, owner.runId);
  }
  if (!remaining.length && currentRun?.status === "needsAttention") {
    patchPipelineRun({ status: "running" }, currentRun.id);
  }
}

function declineResponse(request: CodexServerRequest): unknown {
  if (request.method === "item/permissions/requestApproval") {
    return { permissions: {}, scope: "turn" };
  }
  if (request.method === "item/tool/requestUserInput") return { answers: {} };
  if (request.method === "mcpServer/elicitation/request") {
    return { action: "decline", content: null, _meta: null };
  }
  if (request.method === "applyPatchApproval" || request.method === "execCommandApproval") {
    return { decision: "denied" };
  }
  if (
    request.method === "item/commandExecution/requestApproval" ||
    request.method === "item/fileChange/requestApproval"
  ) return { decision: "decline" };
  return { decision: "cancel" };
}

async function declineRequest(request: CodexServerRequest) {
  await codexRespondServerRequest(request.id, declineResponse(request)).catch(() => undefined);
  removeRequest(request.id);
}

subscribeCodexServerRequests((request) => {
  const threadId = requestThreadId(request);
  const owner = threadId ? threadOwners.get(threadId) : null;
  const turnId = requestTurnId(request);
  const run = usePipelineState().run;
  if (
    !threadId ||
    !owner ||
    !owner.active ||
    !run ||
    run.id !== owner.runId ||
    (owner.generation !== null && request.generation !== owner.generation) ||
    (turnId !== null && owner.turnId !== null && turnId !== owner.turnId)
  ) return;
  if (turnId !== null && owner.turnId === null) owner.turnId = turnId;
  if (stopRequested) {
    void declineRequest(request);
    return;
  }
  const state = usePipelineState();
  if (!state.pendingRequests.some((entry) => entry.id === request.id)) {
    setPipelineRequests([...state.pendingRequests, request]);
  }
  patchPipelineRunNode(owner.nodeId, { status: "waitingForApproval" }, owner.runId);
  patchPipelineRun({ status: "needsAttention" }, owner.runId);
});

subscribeCodexEvents((event) => {
  if (event.method !== "serverRequest/resolved") return;
  const params = asRecord(event.params);
  const requestId = params.requestId;
  if (typeof requestId === "string" || typeof requestId === "number") removeRequest(requestId);
});

subscribeCodexStatus((status) => {
  if (
    lastStopError &&
    (!status.running || (lastStopGeneration !== null && status.generation !== lastStopGeneration))
  ) {
    lastStopError = null;
    lastStopGeneration = null;
    setPipelineError(null);
  }
});

function markUnfinished(status: "cancelled" | "skipped", runId: string) {
  const run = usePipelineState().run;
  if (!run || run.id !== runId) return;
  for (const node of Object.values(run.nodes)) {
    if (["pending", "ready", "starting", "running", "waitingForApproval"].includes(node.status)) {
      patchPipelineRunNode(node.nodeId, { status, completedAt: Date.now() }, runId);
    }
  }
  for (const edge of Object.values(run.edges)) {
    if (edge.status === "pending" || edge.status === "waitingForApproval") {
      patchPipelineRunEdge(edge.edgeId, { status, completedAt: Date.now() }, runId);
    }
  }
}

export async function startPipelineRun(cwd: string, taskId: string): Promise<void> {
  const state = usePipelineState();
  const agents = useAgentState();
  const task = state.tasks.find((entry) => entry.id === taskId);
  const definition = state.pipelines.find((entry) => entry.id === task?.pipelineId);
  const prompt = task ? `# ${task.title.trim()}\n\n${task.description.trim()}` : "";
  if (pipelineRunIsActive() || activeExecution) return;
  if (lastStopError) {
    setPipelineError(`${lastStopError.message} Restart Codex before starting another run.`);
    return;
  }
  if (!task || !definition || state.cwd !== cwd) {
    setPipelineError("Select a task with an available pipeline template first.");
    return;
  }
  if (!prompt) {
    setPipelineError("Describe the task this pipeline should complete.");
    return;
  }
  const requiresCodex = definition.nodes.some((node) => node.type === "agent");
  if (requiresCodex && (!agents.server?.ready || !agents.account?.account)) {
    setPipelineError("Connect your ChatGPT account in Agents before running a pipeline.");
    return;
  }

  const run = createPipelineRun(definition, cwd, prompt, task.id);
  const controller = new AbortController();
  threadOwners.clear();
  stopRequested = false;
  lastStopError = null;
  lastStopGeneration = null;
  activeController = controller;
  activeRunId = run.id;
  setPipelineError(null);
  setPipelineRun(run);
  patchPipelineTaskRun(task.id, {
    runCount: task.runCount + 1,
    lastRunId: run.id,
    lastRunStatus: "queued",
    lastRunAt: run.createdAt,
    lastOutput: null,
    lastError: null,
  });

  const execution = (async () => {
    try {
      await executePipelineRun(run, {
        signal: controller.signal,
        abortPeers: (reason) => {
          if (!controller.signal.aborted) controller.abort(reason);
        },
        fallbackModel: agents.model,
        fallbackEffort: agents.effort,
        requestApproval: (node) => waitForPipelineApproval(run.id, node.id, "node", controller.signal),
        requestConnectionApproval: (edge) =>
          waitForPipelineApproval(run.id, edge.id, "edge", controller.signal),
        callbacks: {
          onRunStatus: (status, error = null, output = null) => {
            const terminal = status === "completed" || status === "failed" || status === "cancelled";
            patchPipelineRun(
              { status, error, output, completedAt: terminal ? Date.now() : null },
              run.id,
            );
            patchPipelineTaskRun(task.id, {
              lastRunStatus: status,
              lastOutput: output,
              lastError: error,
            });
          },
          onNodePatch: (nodeId, patch) => patchPipelineRunNode(nodeId, patch, run.id),
          onEdgePatch: (edgeId, patch) => patchPipelineRunEdge(edgeId, patch, run.id),
          onThreadOwned: (threadId, nodeId) => {
            if (usePipelineState().run?.id !== run.id) return;
            threadOwners.set(threadId, {
              runId: run.id,
              nodeId,
              generation: useAgentState().server?.generation ?? null,
              turnId: null,
              active: true,
            });
          },
          onTurnOwned: (threadId, turnId, nodeId) => {
            if (usePipelineState().run?.id !== run.id) return;
            const owner = threadOwners.get(threadId);
            if (!owner || owner.runId !== run.id || owner.nodeId !== nodeId || !owner.active) return;
            owner.turnId = turnId;
            patchPipelineRunNode(nodeId, { threadId, turnId }, run.id);
          },
          onAttemptSettled: (threadId, turnId, nodeId) => {
            releaseThreadOwner(threadId, turnId, run.id, nodeId);
          },
          onDelta: (nodeId, delta) => {
            const currentRun = usePipelineState().run;
            const node = currentRun?.id === run.id ? currentRun.nodes[nodeId] : null;
            if (!node || node.status === "completed") return;
            const preview = `${node.output ?? ""}${delta}`.slice(-8_000);
            patchPipelineRunNode(nodeId, { output: preview, status: "running" }, run.id);
          },
        },
      });
    } catch (error) {
      const safeCancellation = error instanceof DOMException && error.name === "AbortError";
      const cancelled = stopRequested && safeCancellation;
      if (error instanceof PipelineTurnCleanupError) {
        lastStopError = error;
        lastStopGeneration = agents.server?.generation ?? null;
      }
      if (!controller.signal.aborted) controller.abort(error);
      markUnfinished(cancelled ? "cancelled" : "skipped", run.id);
      patchPipelineRun({
        status: cancelled ? "cancelled" : "failed",
        error: cancelled ? null : messageOf(error),
        completedAt: Date.now(),
      }, run.id);
      patchPipelineTaskRun(task.id, {
        lastRunStatus: cancelled ? "cancelled" : "failed",
        lastError: cancelled ? null : messageOf(error),
      });
    } finally {
      if (activeRunId === run.id) {
        for (const [threadId, owner] of threadOwners) {
          if (owner.runId === run.id) threadOwners.delete(threadId);
        }
        activeController = null;
        for (const gate of [...pendingApprovalGates.values()]) {
          if (gate.runId === run.id) gate.cancel();
        }
        setPipelineRequests([]);
        activeExecution = null;
        activeRunId = null;
        stopRequested = false;
      }
    }
  })();
  activeExecution = execution;
  await execution;
}

export async function stopPipelineRun(requireSafeStop = false): Promise<void> {
  if (!pipelineRunIsActive() && !activeExecution) {
    if (lastStopError) {
      setPipelineError(`${lastStopError.message} Restart Codex before continuing.`);
      if (requireSafeStop) throw lastStopError;
    }
    return;
  }
  stopRequested = true;
  patchPipelineRun({ status: "cancelling" });
  activeController?.abort();
  const requests = [...usePipelineState().pendingRequests];
  await Promise.all(requests.map(declineRequest));
  await activeExecution?.catch(() => undefined);
  if (lastStopError) {
    setPipelineError(lastStopError.message);
    if (requireSafeStop) throw lastStopError;
  }
}

export async function respondToPipelineRequest(
  requestId: string | number,
  response: unknown,
): Promise<void> {
  const request = usePipelineState().pendingRequests.find((entry) => entry.id === requestId);
  if (!request) return;
  await codexRespondServerRequest(requestId, response);
  removeRequest(requestId);
}

export function respondToPipelineApproval(
  nodeId: string,
  decision: PipelineApprovalDecision,
): void {
  const gate = pendingApprovalGates.get(`node:${nodeId}`);
  const run = usePipelineState().run;
  if (!gate || run?.id !== gate.runId || run.nodes[nodeId]?.status !== "waitingForApproval") return;
  gate.respond(decision);
}

export function respondToPipelineConnectionApproval(
  edgeId: string,
  decision: PipelineApprovalDecision,
): void {
  const gate = pendingApprovalGates.get(`edge:${edgeId}`);
  const run = usePipelineState().run;
  if (!gate || run?.id !== gate.runId || run.edges[edgeId]?.status !== "waitingForApproval") return;
  gate.respond(decision);
}

registerWorkspaceSwitchGuard(async () => {
  if (!pipelineRunIsActive() && !activeExecution && !lastStopError) return true;
  if (!window.confirm("Stop the active agent pipeline before switching projects?")) return false;
  await stopPipelineRun(true);
  return true;
});

registerAppCloseGuard({
  reason: () => pipelineRunIsActive() || activeExecution || lastStopError
    ? "an agent pipeline is still running or has not safely stopped"
    : null,
  prepare: () => stopPipelineRun(true),
});
