import { useAgentState } from "../agents/agentStore";
import { buildTopologicalLayers, orderedIncomingEdges, validatePipelineGraph } from "./graph";
import { composePipelinePrompt } from "./prompt";
import { executePipelineAgent, PipelineTurnCleanupError } from "./codexRuntime";
import { newPipelineId } from "./pipelinePersistence";
import type {
  PipelineAgentNode,
  PipelineDefinition,
  PipelineNode,
  PipelineNodeRunState,
  PipelineRun,
  PipelineRunStatus,
  PipelineUpstreamOutput,
} from "./types";

export type PipelineNodeRunPatch = Partial<Omit<PipelineNodeRunState, "nodeId">>;

export interface PipelineRunnerCallbacks {
  onRunStatus: (status: PipelineRunStatus, error?: string | null, output?: string | null) => void;
  onNodePatch: (nodeId: string, patch: PipelineNodeRunPatch) => void;
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
  };
}

export function createPipelineRun(
  definition: PipelineDefinition,
  cwd: string,
  input: string,
): PipelineRun {
  const now = Date.now();
  const snapshot = cloneDefinition(definition);
  return {
    id: newPipelineId("run"),
    pipelineId: definition.id,
    cwd,
    input,
    definition: snapshot,
    status: "queued",
    nodes: Object.fromEntries(snapshot.nodes.map((node) => [node.id, initialNodeState(node.id)])),
    createdAt: now,
    updatedAt: now,
    completedAt: null,
    output: null,
    error: null,
  };
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
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let ownedThreadId: string | null = null;
    let ownedTurnId: string | null = null;
    if (options.signal.aborted) throw new DOMException("Pipeline run stopped", "AbortError");
    callbacks.onNodePatch(node.id, {
      status: "starting",
      attempt,
      startedAt: Date.now(),
      completedAt: null,
      output: null,
      error: attempt > 1 ? `Retrying (${attempt}/${maxAttempts})…` : null,
      generation: useAgentState().server?.generation ?? null,
    });
    try {
      const prompt = composePipelinePrompt({
        pipelineName: run.definition.name,
        runId: run.id,
        originalTask: run.input,
        node,
        upstreamOutputs: upstreamFor(run.definition, node.id, outputs),
      });
      const result = await executePipelineAgent({
        cwd: run.cwd,
        pipelineName: run.definition.name,
        node,
        prompt,
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

async function runExclusiveLayer(
  run: PipelineRun,
  nodes: PipelineAgentNode[],
  outputs: Map<string, string>,
  options: PipelineRunnerOptions,
): Promise<void> {
  const readers = nodes.filter((node) => node.permission === "read-only");
  const writers = nodes.filter((node) => node.permission !== "read-only");
  const readerResults = await Promise.allSettled(readers.map(async (node) => {
    try {
      await runAgent(run, node, outputs, options);
    } catch (error) {
      if (!isAbort(error, options.signal)) options.abortPeers(error);
      throw error;
    }
  }));
  const readerFailures = readerResults.filter(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  const readerFailure = readerFailures.find(
    (result) => result.reason instanceof PipelineTurnCleanupError,
  ) ?? readerFailures.find(
    (result) => !isAbortException(result.reason),
  ) ?? readerFailures[0];
  if (readerFailure) throw readerFailure.reason;
  for (const writer of writers) await runAgent(run, writer, outputs, options);
}

export async function executePipelineRun(
  run: PipelineRun,
  options: PipelineRunnerOptions,
): Promise<string> {
  const { callbacks } = options;
  callbacks.onRunStatus("validating");
  const validation = validatePipelineGraph(run.definition);
  if (!validation.valid) throw new Error(validation.issues.map((issue) => issue.message).join(" "));
  const layers = validation.layers ?? buildTopologicalLayers(run.definition);
  if (!layers) throw new Error("Pipeline contains a cycle");

  callbacks.onRunStatus("running");
  const nodes = new Map(run.definition.nodes.map((node) => [node.id, node]));
  const outputs = new Map<string, string>();
  const inputNode = run.definition.nodes.find((node) => node.type === "input")!;
  outputs.set(inputNode.id, run.input);
  callbacks.onNodePatch(inputNode.id, {
    status: "completed",
    output: run.input,
    startedAt: Date.now(),
    completedAt: Date.now(),
  });

  for (const layer of layers) {
    const layerNodes = layer.map((id) => nodes.get(id)!).filter(Boolean);
    const agents = layerNodes.filter((node): node is PipelineAgentNode => node.type === "agent");
    for (const agent of agents) callbacks.onNodePatch(agent.id, { status: "ready" });
    await runExclusiveLayer(run, agents, outputs, options);
    for (const outputNode of layerNodes.filter((node) => node.type === "output")) {
      const output = outputForJoin(run.definition, outputNode.id, outputs);
      outputs.set(outputNode.id, output);
      callbacks.onNodePatch(outputNode.id, {
        status: "completed",
        output,
        startedAt: Date.now(),
        completedAt: Date.now(),
      });
    }
  }

  const outputNode = run.definition.nodes.find((node) => node.type === "output")!;
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
