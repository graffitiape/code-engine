import { parsePipelineDefinition } from "./pipelinePersistence";
import { normalizeImageAttachments } from "./pipelineTaskPersistence";
import type {
  PipelineEdgeRunState,
  PipelineNodeRunState,
  PipelineRun,
  PipelineRunStatus,
} from "./types";

const STORAGE_PREFIX = "ce.pipeline-runs.v1:";
const RUN_STATUSES = new Set<PipelineRunStatus>([
  "queued", "validating", "running", "needsAttention", "cancelling",
  "completed", "failed", "cancelled",
]);
const NODE_STATUSES = new Set<PipelineNodeRunState["status"]>([
  "pending", "ready", "starting", "running", "waitingForApproval",
  "completed", "failed", "cancelled", "skipped",
]);
const EDGE_STATUSES = new Set<PipelineEdgeRunState["status"]>([
  "pending", "waitingForApproval", "approved", "rejected", "cancelled", "skipped",
]);
const ACTIVE_STATUSES = new Set<PipelineRunStatus>([
  "queued", "validating", "running", "needsAttention", "cancelling",
]);
const INTERRUPTED_ERROR = "This run was interrupted when Code Engine closed.";

export interface PersistedPipelineRuns {
  schemaVersion: 1;
  runs: PipelineRun[];
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function integrationCommit(value: unknown): PipelineNodeRunState["integrationCommit"] | undefined {
  if (value === undefined || value === null) return value ?? undefined;
  if (!value || typeof value !== "object") return undefined;
  const checkpoint = value as Record<string, unknown>;
  return typeof checkpoint.shortId === "string" && typeof checkpoint.summary === "string"
    ? { shortId: checkpoint.shortId, summary: checkpoint.summary }
    : undefined;
}

function parseNodeState(value: unknown, nodeId: string): PipelineNodeRunState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<PipelineNodeRunState>;
  if (state.nodeId !== nodeId || !NODE_STATUSES.has(state.status!) ||
      !Number.isInteger(state.attempt) || !nullableString(state.threadId) ||
      !nullableString(state.turnId) || !nullableNumber(state.generation) ||
      !nullableNumber(state.startedAt) || !nullableNumber(state.completedAt) ||
      !nullableString(state.output) || !nullableString(state.error)) return null;
  const checkpoint = integrationCommit(state.integrationCommit);
  if (state.integrationCommit !== undefined && state.integrationCommit !== null && !checkpoint) return null;
  return { ...state, integrationCommit: checkpoint ?? null } as PipelineNodeRunState;
}

function parseEdgeState(value: unknown, edgeId: string): PipelineEdgeRunState | null {
  if (!value || typeof value !== "object") return null;
  const state = value as Partial<PipelineEdgeRunState>;
  if (state.edgeId !== edgeId || !EDGE_STATUSES.has(state.status!) ||
      !nullableNumber(state.startedAt) || !nullableNumber(state.completedAt) ||
      !nullableString(state.error)) return null;
  return state as PipelineEdgeRunState;
}

function parseRun(value: unknown, cwd: string): PipelineRun | null {
  if (!value || typeof value !== "object") return null;
  const run = value as Record<string, unknown>;
  const definition = parsePipelineDefinition(run.definition);
  if (!definition || typeof run.id !== "string" || typeof run.pipelineId !== "string" ||
      !nullableString(run.taskId) || run.cwd !== cwd || typeof run.input !== "string" ||
      !Array.isArray(run.attachments) || !RUN_STATUSES.has(run.status as PipelineRunStatus) ||
      typeof run.nodes !== "object" || !run.nodes || typeof run.edges !== "object" || !run.edges ||
      !nullableNumber(run.createdAt) || run.createdAt === null || !nullableNumber(run.updatedAt) ||
      run.updatedAt === null || !nullableNumber(run.completedAt) || !nullableString(run.output) ||
      !nullableString(run.error)) return null;
  const attachments = normalizeImageAttachments(run.attachments);
  if (attachments.length !== run.attachments.length) return null;
  const rawNodes = run.nodes as Record<string, unknown>;
  const nodes = Object.fromEntries(definition.nodes.map((node) => [node.id, parseNodeState(rawNodes[node.id], node.id)]));
  if (Object.values(nodes).some((node) => !node)) return null;
  const approvalEdges = definition.edges.filter((edge) => edge.mode === "approval");
  const rawEdges = run.edges as Record<string, unknown>;
  const edges = Object.fromEntries(approvalEdges.map((edge) => [edge.id, parseEdgeState(rawEdges[edge.id], edge.id)]));
  if (Object.values(edges).some((edge) => !edge)) return null;
  return { ...(run as unknown as PipelineRun), definition, attachments,
    nodes: nodes as Record<string, PipelineNodeRunState>,
    edges: edges as Record<string, PipelineEdgeRunState> };
}

function interrupt(run: PipelineRun): PipelineRun {
  if (!ACTIVE_STATUSES.has(run.status)) return run;
  const now = Date.now();
  return {
    ...run, status: "failed", error: INTERRUPTED_ERROR, updatedAt: now, completedAt: now,
    nodes: Object.fromEntries(Object.entries(run.nodes).map(([id, node]) => [id,
      ["completed", "failed", "cancelled", "skipped"].includes(node.status) ? node : {
        ...node, status: "failed", error: INTERRUPTED_ERROR, completedAt: now,
      },
    ])),
    edges: Object.fromEntries(Object.entries(run.edges).map(([id, edge]) => [id,
      ["approved", "rejected", "cancelled", "skipped"].includes(edge.status) ? edge : {
        ...edge, status: "cancelled", error: INTERRUPTED_ERROR, completedAt: now,
      },
    ])),
  };
}

export function loadPipelineRuns(cwd: string): PersistedPipelineRuns {
  try {
    const value = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${cwd}`) ?? "null") as Record<string, unknown> | null;
    if (value?.schemaVersion !== 1 || !Array.isArray(value.runs)) return { schemaVersion: 1, runs: [] };
    return { schemaVersion: 1, runs: value.runs.map((run) => parseRun(run, cwd)).filter((run): run is PipelineRun => Boolean(run)).map(interrupt) };
  } catch {
    return { schemaVersion: 1, runs: [] };
  }
}

export function savePipelineRuns(cwd: string, runs: readonly PipelineRun[]): boolean {
  try {
    localStorage.setItem(`${STORAGE_PREFIX}${cwd}`, JSON.stringify({ schemaVersion: 1, runs }));
    return true;
  } catch {
    return false;
  }
}
