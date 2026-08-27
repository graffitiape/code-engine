import { useAgentState } from "../agents/agentStore";
import { gitCommit, gitPush, gitStageAll, gitStatus } from "../../bridge/tauri";
import { orderedIncomingEdges, validatePipelineGraph } from "./graph";
import { composePipelinePrompt } from "./prompt";
import { executePipelineAgent, PipelineTurnCleanupError } from "./codexRuntime";
import { newPipelineId } from "./pipelinePersistence";
import { DEFAULT_PIPELINE_AGENT_INSTRUCTIONS } from "./pipelineAgentDefaults";
import type {
  PipelineAgentNode,
  PipelineApprovalDecision,
  PipelineApprovalNode,
  PipelineDefinition,
  PipelineEdge,
  PipelineEdgeRunState,
  PipelineIntegrationNode,
  PipelineNode,
  PipelineNodeRunState,
  PipelineRun,
  PipelineRunStatus,
  PipelineUpstreamOutput,
} from "./types";

export type PipelineNodeRunPatch = Partial<Omit<PipelineNodeRunState, "nodeId">>;
export type PipelineEdgeRunPatch = Partial<Omit<PipelineEdgeRunState, "edgeId">>;

export interface PipelineRunnerCallbacks {
  onRunStatus: (status: PipelineRunStatus, error?: string | null, output?: string | null) => void;
  onNodePatch: (nodeId: string, patch: PipelineNodeRunPatch) => void;
  onEdgePatch: (edgeId: string, patch: PipelineEdgeRunPatch) => void;
  onThreadOwned: (threadId: string, nodeId: string) => void;
  onTurnOwned: (threadId: string, turnId: string, nodeId: string) => void;
  onAttemptSettled: (threadId: string | null, turnId: string | null, nodeId: string) => void;
  onDelta: (nodeId: string, delta: string) => void;
}

export interface PipelineRunnerOptions {
  signal: AbortSignal;
  abortPeers: (reason: unknown) => void;
  fallbackModel: string;
  fallbackEffort: string;
  pipelineAgentInstructions?: string;
  requestApproval?: (node: PipelineApprovalNode) => Promise<PipelineApprovalDecision>;
  requestConnectionApproval?: (
    edge: PipelineEdge,
    source: PipelineNode,
    target: PipelineNode,
  ) => Promise<PipelineApprovalDecision>;
  callbacks: PipelineRunnerCallbacks;
}

function cloneDefinition(definition: PipelineDefinition): PipelineDefinition {
  return JSON.parse(JSON.stringify(definition)) as PipelineDefinition;
}

function initialNodeState(nodeId: string): PipelineNodeRunState {
  return {
    nodeId,
    status: "pending",
    attempt: 0,
    threadId: null,
    turnId: null,
    generation: null,
    startedAt: null,
    completedAt: null,
    output: null,
    error: null,
    integrationCommit: null,
  };
}

function initialEdgeState(edgeId: string): PipelineEdgeRunState {
  return {
    edgeId,
    status: "pending",
    startedAt: null,
    completedAt: null,
    error: null,
  };
}

export function createPipelineRun(
  definition: PipelineDefinition,
  cwd: string,
  input: string,
  taskId: string | null = null,
  attachments: PipelineRun["attachments"] = [],
): PipelineRun {
  const now = Date.now();
  const snapshot = cloneDefinition(definition);
  return {
    id: newPipelineId("run"),
    pipelineId: definition.id,
    taskId,
    cwd,
    input,
    attachments: attachments.map((attachment) => ({ ...attachment })),
    definition: snapshot,
    status: "queued",
    nodes: Object.fromEntries(snapshot.nodes.map((node) => [node.id, initialNodeState(node.id)])),
    edges: Object.fromEntries(
      snapshot.edges
        .filter((edge) => edge.mode === "approval")
        .map((edge) => [edge.id, initialEdgeState(edge.id)]),
    ),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    output: null,
    error: null,
  };
}

export function pipelineNodeCanRetry(run: PipelineRun, nodeId: string): boolean {
  const node = run.definition.nodes.find((entry) => entry.id === nodeId);
  return run.status === "failed" &&
    Boolean(node && node.type !== "input" && node.type !== "output") &&
    run.nodes[nodeId]?.status === "failed";
}

/**
 * Create a new history entry that resumes a failed execution. Completed nodes
 * retain their exact outputs and chat ownership; every unfinished branch is
 * reset so the graph can safely converge on Result again.
 */
export function createPipelineRetryRun(previous: PipelineRun, nodeId: string): PipelineRun {
  if (!pipelineNodeCanRetry(previous, nodeId)) {
    throw new Error("Only a failed executable step from a failed run can be retried.");
  }
  const retry = createPipelineRun(
    previous.definition,
    previous.cwd,
    previous.input,
    previous.taskId,
    previous.attachments,
  );
  retry.nodes = Object.fromEntries(previous.definition.nodes.map((node) => {
    const state = previous.nodes[node.id];
    if (state?.status === "completed") return [node.id, { ...state }];
    return [node.id, {
      ...retry.nodes[node.id],
      attempt: state?.attempt ?? 0,
      ...(node.type === "integration" && state?.integrationCommit ? {
        output: state.output,
        integrationCommit: { ...state.integrationCommit },
      } : {}),
    }];
  }));
  retry.edges = Object.fromEntries(Object.entries(retry.edges).map(([edgeId, state]) => {
    const previousState = previous.edges[edgeId];
    return [edgeId, previousState?.status === "approved" ? { ...previousState } : state];
  }));
  return retry;
}

function commitMessageFor(node: PipelineIntegrationNode, task: string): string {
  const taskSubject = task
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean) ?? "pipeline task";
  const message = node.commitMessage.replaceAll("{{task}}", taskSubject).trim();
  const [subject, ...body] = message.split(/\r?\n/);
  const cleanSubject = subject.trim().slice(0, 72);
  return [cleanSubject, ...body].join("\n").trim();
}

async function runIntegration(
  run: PipelineRun,
  node: PipelineIntegrationNode,
  outputs: Map<string, string>,
  options: PipelineRunnerOptions,
): Promise<void> {
  if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
  options.callbacks.onNodePatch(node.id, {
    status: "running",
    attempt: (run.nodes[node.id]?.attempt ?? 0) + 1,
    startedAt: Date.now(),
    completedAt: null,
    output: null,
    error: null,
  });
  try {
    if (node.provider !== "git") throw new Error(`Unsupported integration: ${node.provider}`);
    const checkpoint = run.nodes[node.id]?.integrationCommit;
    let output: string;
    if (checkpoint) {
      output = `Committed ${checkpoint.shortId}: ${checkpoint.summary}`;
    } else {
      const status = node.stageAll ? await gitStageAll(run.cwd) : await gitStatus(run.cwd);
      if (!status.staged.length) {
        throw new Error(node.stageAll
          ? "There are no project changes to commit."
          : "There are no staged changes to commit.");
      }
      const commit = await gitCommit(run.cwd, commitMessageFor(node, run.input));
      output = `Committed ${commit.shortId}: ${commit.summary}`;
      options.callbacks.onNodePatch(node.id, {
        output,
        integrationCommit: { shortId: commit.shortId, summary: commit.summary },
      });
    }
    if (node.action === "commit-push") {
      const branch = await gitPush(run.cwd);
      output += `\nPushed ${branch} to its configured upstream.`;
    }
    const status = await gitStatus(run.cwd);
    output += `\nWorking tree: ${status.staged.length + status.unstaged.length + status.untracked.length} pending change(s).`;
    outputs.set(node.id, output);
    options.callbacks.onNodePatch(node.id, {
      status: "completed",
      output,
      completedAt: Date.now(),
    });
  } catch (error) {
    if (isAbort(error, options.signal)) {
      options.callbacks.onNodePatch(node.id, {
        status: "cancelled",
        error: "Stopped",
        completedAt: Date.now(),
      });
      throw error;
    }
    options.callbacks.onNodePatch(node.id, {
      status: "failed",
      error: messageOf(error),
      completedAt: Date.now(),
    });
    throw error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbort(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || isAbortException(error);
}

function isAbortException(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function preferredFailure(results: PromiseSettledResult<void>[]): unknown | null {
  const failures = results.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  return failures.find(
    (result) => result.reason instanceof PipelineTurnCleanupError,
  )?.reason ?? failures.find(
    (result) => !isAbortException(result.reason),
  )?.reason ?? failures[0]?.reason ?? null;
}

type PipelineAccessMode = "read" | "exclusive";

interface PipelineAccessRequest {
  mode: PipelineAccessMode;
  run: () => Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

/**
 * Run read-only Codex work concurrently while keeping every workspace writer
 * and deterministic integration exclusive. Queued writers are fair: later
 * readers do not continually jump ahead of them.
 */
function createPipelineAccessScheduler() {
  const queue: PipelineAccessRequest[] = [];
  let activeReaders = 0;
  let activeExclusive = false;

  const settle = (request: PipelineAccessRequest) => {
    void request.run().then(request.resolve, request.reject).finally(() => {
      if (request.mode === "read") activeReaders -= 1;
      else activeExclusive = false;
      pump();
    });
  };

  const pump = () => {
    if (activeExclusive || !queue.length) return;
    if (queue[0].mode === "exclusive") {
      if (activeReaders > 0) return;
      activeExclusive = true;
      settle(queue.shift()!);
      return;
    }
    while (queue[0]?.mode === "read" && !activeExclusive) {
      activeReaders += 1;
      settle(queue.shift()!);
    }
  };

  return (mode: PipelineAccessMode, run: () => Promise<void>): Promise<void> =>
    new Promise((resolve, reject) => {
      queue.push({ mode, run, resolve, reject });
      pump();
    });
}

function createPipelineApprovalScheduler() {
  const schedule = createPipelineAccessScheduler();
  return (run: () => Promise<void>) => schedule("exclusive", run);
}

function outputForJoin(
  graph: PipelineDefinition,
  nodeId: string,
  outputs: ReadonlyMap<string, string>,
): string {
  const incoming = orderedIncomingEdges(graph, nodeId);
  const handoffs = incoming.flatMap((edge) => {
    const output = outputs.get(edge.source);
    const source = graph.nodes.find((node) => node.id === edge.source);
    return output === undefined || !source ? [] : [{ name: source.name, output }];
  });
  if (handoffs.length === 1) return handoffs[0].output;
  return handoffs.map((handoff) => `## ${handoff.name}\n\n${handoff.output}`).join("\n\n");
}

function upstreamFor(
  graph: PipelineDefinition,
  nodeId: string,
  outputs: ReadonlyMap<string, string>,
): PipelineUpstreamOutput[] {
  return orderedIncomingEdges(graph, nodeId).flatMap((edge) => {
    const source = graph.nodes.find((node) => node.id === edge.source);
    const output = outputs.get(edge.source);
    return source && output !== undefined
      ? [{ nodeId: source.id, nodeName: source.name, edgeOrder: edge.order, output }]
      : [];
  });
}

async function runAgent(
  run: PipelineRun,
  node: PipelineAgentNode,
  outputs: Map<string, string>,
  options: PipelineRunnerOptions,
): Promise<void> {
  const { callbacks } = options;
  const maxAttempts = node.retryCount + 1;
  const previousAttempts = run.nodes[node.id]?.attempt ?? 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let ownedThreadId: string | null = null;
    let ownedTurnId: string | null = null;
    if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
    callbacks.onNodePatch(node.id, {
      status: "starting",
      attempt: previousAttempts + attempt,
      startedAt: Date.now(),
      completedAt: null,
      output: null,
      error: attempt > 1 ? `Retrying (${attempt}/${maxAttempts})…` : null,
      generation: useAgentState().server?.generation ?? null,
    });
    try {
      const prompt = composePipelinePrompt({
        definition: run.definition,
        runId: run.id,
        originalTask: run.input,
        node,
        globalInstructions:
          options.pipelineAgentInstructions ?? DEFAULT_PIPELINE_AGENT_INSTRUCTIONS,
        upstreamOutputs: upstreamFor(run.definition, node.id, outputs),
      });
      const result = await executePipelineAgent({
        cwd: run.cwd,
        pipelineName: run.definition.name,
        node,
        prompt,
        globalInstructions:
          options.pipelineAgentInstructions ?? DEFAULT_PIPELINE_AGENT_INSTRUCTIONS,
        attachments: run.attachments,
        fallbackModel: options.fallbackModel,
        fallbackEffort: options.fallbackEffort,
        signal: options.signal,
        onThreadStarted: (threadId) => {
          ownedThreadId = threadId;
          callbacks.onThreadOwned(threadId, node.id);
          callbacks.onNodePatch(node.id, { threadId, status: "starting" });
        },
        onTurnStarted: (threadId, turnId) => {
          ownedThreadId = threadId;
          ownedTurnId = turnId;
          callbacks.onTurnOwned(threadId, turnId, node.id);
          callbacks.onNodePatch(node.id, { turnId, status: "running", error: null });
        },
        onDelta: (delta) => callbacks.onDelta(node.id, delta),
      });
      outputs.set(node.id, result.output);
      callbacks.onNodePatch(node.id, {
        status: "completed",
        output: result.output,
        error: null,
        completedAt: Date.now(),
      });
      return;
    } catch (error) {
      if (isAbort(error, options.signal)) {
        callbacks.onNodePatch(node.id, {
          status: "cancelled",
          error: "Stopped",
          completedAt: Date.now(),
        });
        throw error;
      }
      const message = messageOf(error);
      if (error instanceof PipelineTurnCleanupError) {
        callbacks.onNodePatch(node.id, {
          status: "failed",
          error: message,
          completedAt: Date.now(),
        });
        throw error;
      }
      if (attempt === maxAttempts) {
        callbacks.onNodePatch(node.id, {
          status: "failed",
          error: message,
          completedAt: Date.now(),
        });
        throw error;
      }
      callbacks.onNodePatch(node.id, { status: "ready", error: message });
    } finally {
      callbacks.onAttemptSettled(ownedThreadId, ownedTurnId, node.id);
    }
  }
}

async function runApproval(
  run: PipelineRun,
  node: PipelineApprovalNode,
  outputs: Map<string, string>,
  options: PipelineRunnerOptions,
): Promise<void> {
  if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
  const requestApproval = options.requestApproval;
  options.callbacks.onNodePatch(node.id, {
    status: "waitingForApproval",
    attempt: (run.nodes[node.id]?.attempt ?? 0) + 1,
    startedAt: Date.now(),
    completedAt: null,
    output: node.message,
    error: null,
  });
  options.callbacks.onRunStatus("needsAttention");
  let rejectionRecorded = false;
  try {
    if (!requestApproval) throw new Error("This pipeline runner cannot request human approval.");
    const decision = await requestApproval(node);
    if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
    if (decision === "rejected") {
      const message = `Approval rejected at ${node.name}.`;
      options.callbacks.onNodePatch(node.id, {
        status: "failed",
        error: message,
        completedAt: Date.now(),
      });
      rejectionRecorded = true;
      throw new Error(message);
    }
    outputs.set(node.id, outputForJoin(run.definition, node.id, outputs));
    options.callbacks.onNodePatch(node.id, {
      status: "completed",
      output: `Approved: ${node.message}`,
      error: null,
      completedAt: Date.now(),
    });
    options.callbacks.onRunStatus("running");
  } catch (error) {
    if (isAbort(error, options.signal)) {
      options.callbacks.onNodePatch(node.id, {
        status: "cancelled",
        error: "Stopped",
        completedAt: Date.now(),
      });
    } else if (!rejectionRecorded) {
      options.callbacks.onNodePatch(node.id, {
        status: "failed",
        error: messageOf(error),
        completedAt: Date.now(),
      });
    }
    throw error;
  }
}

async function runApprovalConnection(
  edge: PipelineEdge,
  source: PipelineNode,
  target: PipelineNode,
  options: PipelineRunnerOptions,
): Promise<void> {
  if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
  const requestApproval = options.requestConnectionApproval;
  options.callbacks.onEdgePatch(edge.id, {
    status: "waitingForApproval",
    startedAt: Date.now(),
    completedAt: null,
    error: null,
  });
  options.callbacks.onRunStatus("needsAttention");
  let rejectionRecorded = false;
  try {
    if (!requestApproval) throw new Error("This pipeline runner cannot request connection approval.");
    const decision = await requestApproval(edge, source, target);
    if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
    if (decision === "rejected") {
      const message = `Approval rejected between ${source.name} and ${target.name}.`;
      options.callbacks.onEdgePatch(edge.id, {
        status: "rejected",
        error: message,
        completedAt: Date.now(),
      });
      rejectionRecorded = true;
      throw new Error(message);
    }
    options.callbacks.onEdgePatch(edge.id, {
      status: "approved",
      error: null,
      completedAt: Date.now(),
    });
    options.callbacks.onRunStatus("running");
  } catch (error) {
    if (isAbort(error, options.signal)) {
      options.callbacks.onEdgePatch(edge.id, {
        status: "cancelled",
        error: "Stopped",
        completedAt: Date.now(),
      });
    } else if (!rejectionRecorded) {
      options.callbacks.onEdgePatch(edge.id, {
        status: "rejected",
        error: messageOf(error),
        completedAt: Date.now(),
      });
    }
    throw error;
  }
}

export async function executePipelineRun(
  run: PipelineRun,
  options: PipelineRunnerOptions,
): Promise<string> {
  const { callbacks } = options;
  callbacks.onRunStatus("validating");
  const validation = validatePipelineGraph(run.definition);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(" "));

  callbacks.onRunStatus("running");
  const nodes = new Map(run.definition.nodes.map((node) => [node.id, node]));
  const outputs = new Map<string, string>();
  const executions = new Map<string, Promise<void>>();
  const scheduleAccess = createPipelineAccessScheduler();
  const scheduleApproval = createPipelineApprovalScheduler();
  const inputNode = run.definition.nodes.find((node) => node.type === "input")!;
  const outputNode = run.definition.nodes.find((node) => node.type === "output")!;
  for (const node of run.definition.nodes) {
    const state = run.nodes[node.id];
    if (state?.status !== "completed") continue;
    outputs.set(node.id, state.output ?? (node.type === "input" ? run.input : ""));
    executions.set(node.id, Promise.resolve());
  }
  if (!executions.has(inputNode.id)) {
    outputs.set(inputNode.id, run.input);
    callbacks.onNodePatch(inputNode.id, {
      status: "completed", output: run.input, startedAt: Date.now(), completedAt: Date.now(),
    });
    executions.set(inputNode.id, Promise.resolve());
  }

  const executeNode = (nodeId: string): Promise<void> => {
    const existing = executions.get(nodeId);
    if (existing) return existing;
    const node = nodes.get(nodeId);
    if (!node) return Promise.reject(new Error(`Pipeline node ${nodeId} is missing.`));
    const incoming = orderedIncomingEdges(run.definition, nodeId);
    const dependencies = incoming.map((edge) => executeNode(edge.source));
    const execution = Promise.allSettled(dependencies).then(async (results) => {
      const failure = preferredFailure(results);
      if (failure) throw failure;
      if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");

      for (const edge of incoming.filter((candidate) => candidate.mode === "approval")) {
        if (run.edges[edge.id]?.status === "approved") continue;
        const source = nodes.get(edge.source);
        if (source) {
          await scheduleApproval(() => runApprovalConnection(edge, source, node, options));
        }
      }

      try {
        if (node.type === "agent") {
          callbacks.onNodePatch(node.id, { status: "ready" });
          await scheduleAccess(
            node.permission === "read-only" ? "read" : "exclusive",
            () => runAgent(run, node, outputs, options),
          );
        } else if (node.type === "integration") {
          callbacks.onNodePatch(node.id, { status: "ready" });
          await scheduleAccess("exclusive", () => runIntegration(run, node, outputs, options));
        } else if (node.type === "approval") {
          callbacks.onNodePatch(node.id, { status: "ready" });
          await scheduleApproval(() => runApproval(run, node, outputs, options));
        } else if (node.type === "output") {
          const output = outputForJoin(run.definition, node.id, outputs);
          outputs.set(node.id, output);
          callbacks.onNodePatch(node.id, {
            status: "completed",
            output,
            startedAt: Date.now(),
            completedAt: Date.now(),
          });
        }
      } catch (error) {
        if (!isAbort(error, options.signal)) options.abortPeers(error);
        throw error;
      }
    });
    executions.set(nodeId, execution);
    return execution;
  };

  await executeNode(outputNode.id);
  const result = outputs.get(outputNode.id) ?? "";
  callbacks.onRunStatus("completed", null, result);
  return result;
}

export function markUnfinishedNodes(
  run: PipelineRun,
  status: "cancelled" | "skipped",
  callback: PipelineRunnerCallbacks["onNodePatch"],
): void {
  for (const node of Object.values(run.nodes)) {
    if (["pending", "ready", "starting", "running", "waitingForApproval"].includes(node.status)) {
      callback(node.nodeId, { status, completedAt: Date.now() });
    }
  }
}
