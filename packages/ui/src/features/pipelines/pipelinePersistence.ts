import {
  PIPELINE_MAX_EDGES,
  PIPELINE_MAX_NODES,
  PIPELINE_SCHEMA_VERSION,
  type PipelineApprovalNode,
  type PipelineDefinition,
  type PipelineEdge,
  type PipelineIntegrationAction,
  type PipelineNode,
  type PipelinePermission,
  type PipelinePoint,
} from "./types";

const STORAGE_PREFIX = "ce.pipelines.v1:";

interface PersistedPipelines {
  schemaVersion: 1;
  selectedId: string | null;
  pipelines: PipelineDefinition[];
}

export function newPipelineId(prefix: string): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `${prefix}:${suffix}`;
}

export function createStarterPipeline(
  name = "Development pipeline",
): PipelineDefinition {
  const input: PipelineNode = {
    id: newPipelineId("node"),
    type: "input",
    name: "Task Input",
    position: { x: 80, y: 220 },
  };
  const output: PipelineNode = {
    id: newPipelineId("node"),
    type: "output",
    name: "Result",
    position: { x: 1180, y: 220 },
  };
  return {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    id: newPipelineId("pipeline"),
    name,
    viewport: { x: 24, y: 70, zoom: 0.55 },
    nodes: [input, output],
    edges: [],
  };
}

export function duplicatePipeline(source: PipelineDefinition): PipelineDefinition {
  const nodeIds = new Map(source.nodes.map((node) => [node.id, newPipelineId("node")]));
  return {
    ...source,
    id: newPipelineId("pipeline"),
    name: `${source.name} copy`,
    viewport: { ...source.viewport },
    nodes: source.nodes.map((node) => ({
      ...node,
      id: nodeIds.get(node.id)!,
      position: { ...node.position },
    })),
    edges: source.edges.map((edge) => ({
      ...edge,
      id: newPipelineId("edge"),
      source: nodeIds.get(edge.source)!,
      target: nodeIds.get(edge.target)!,
    })),
  };
}

function point(value: unknown): PipelinePoint | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PipelinePoint>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
    ? { x: candidate.x!, y: candidate.y! }
    : null;
}

function isPermission(value: unknown): value is PipelinePermission {
  return value === "read-only" || value === "workspace-write" || value === "full-access";
}

function isIntegrationAction(value: unknown): value is PipelineIntegrationAction {
  return value === "commit" || value === "commit-push";
}

function parseNode(value: unknown): PipelineNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  const position = point(node.position);
  if (typeof node.id !== "string" || typeof node.name !== "string" || !position) return null;
  if (node.type === "input" || node.type === "output") {
    return { id: node.id, type: node.type, name: node.name, position };
  }
  if (node.type === "integration") {
    if (
      (node.provider !== "git" && node.provider !== "github") ||
      !isIntegrationAction(node.action) ||
      typeof node.stageAll !== "boolean" ||
      typeof node.commitMessage !== "string"
    ) return null;
    return {
      id: node.id,
      type: "integration",
      name: node.name,
      position,
      provider: "git",
      action: node.action,
      stageAll: node.stageAll,
      commitMessage: node.commitMessage,
      color: typeof node.color === "string" && node.color ? node.color : "orange",
    };
  }
  if (node.type === "approval") {
    if (typeof node.message !== "string") return null;
    const approval: PipelineApprovalNode = {
      id: node.id,
      type: "approval",
      name: node.name,
      position,
      message: node.message,
      color: typeof node.color === "string" && node.color ? node.color : "orange",
    };
    return approval;
  }
  if (
    node.type !== "agent" ||
    typeof node.instructions !== "string" ||
    typeof node.model !== "string" ||
    typeof node.effort !== "string" ||
    !isPermission(node.permission)
  ) return null;
  return {
    id: node.id,
    type: "agent",
    name: node.name,
    position,
    instructions: node.instructions,
    model: node.model,
    effort: node.effort,
    permission: node.permission,
    retryCount: Number.isInteger(node.retryCount) ? Math.min(3, Math.max(0, Number(node.retryCount))) : 1,
    color: typeof node.color === "string" && node.color ? node.color : "purple",
  };
}

export function parsePipelineDefinition(value: unknown): PipelineDefinition | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== PIPELINE_SCHEMA_VERSION ||
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    !Array.isArray(item.nodes) ||
    !Array.isArray(item.edges) ||
    item.nodes.length > PIPELINE_MAX_NODES ||
    item.edges.length > PIPELINE_MAX_EDGES
  ) return null;
  const viewport = item.viewport as Record<string, unknown> | undefined;
  const nodes = item.nodes.map(parseNode);
  if (nodes.some((node) => !node)) return null;
  const edges = item.edges.map((edge): PipelineEdge | null => {
    if (!edge || typeof edge !== "object") return null;
    const candidate = edge as Partial<PipelineEdge>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.source !== "string" ||
      typeof candidate.target !== "string" ||
      !Number.isFinite(candidate.order)
    ) return null;
    const mode = candidate.mode === "approval" ? "approval" : "automatic";
    return {
      id: candidate.id,
      source: candidate.source,
      target: candidate.target,
      order: candidate.order!,
      mode,
      approvalMessage: mode === "approval" && typeof candidate.approvalMessage === "string"
        ? candidate.approvalMessage
        : "",
    };
  });
  if (edges.some((edge) => !edge)) return null;
  let normalizedNodes = nodes as PipelineNode[];
  let normalizedEdges = edges as PipelineEdge[];
  for (const node of normalizedNodes.filter(
    (entry): entry is PipelineApprovalNode => entry.type === "approval",
  )) {
    const incoming = normalizedEdges.filter((edge) => edge.target === node.id);
    const outgoing = normalizedEdges.filter((edge) => edge.source === node.id);
    if (
      incoming.length !== 1 ||
      outgoing.length !== 1 ||
      normalizedEdges.some(
        (edge) => edge.source === incoming[0].source && edge.target === outgoing[0].target,
      )
    ) continue;
    normalizedNodes = normalizedNodes.filter((entry) => entry.id !== node.id);
    normalizedEdges = [
      ...normalizedEdges.filter((edge) => edge.source !== node.id && edge.target !== node.id),
      {
        id: outgoing[0].id,
        source: incoming[0].source,
        target: outgoing[0].target,
        order: outgoing[0].order,
        mode: "approval",
        approvalMessage: node.message,
      },
    ];
  }
  return {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    id: item.id,
    name: item.name,
    viewport: {
      x: typeof viewport?.x === "number" ? viewport.x : 0,
      y: typeof viewport?.y === "number" ? viewport.y : 0,
      zoom: typeof viewport?.zoom === "number" ? viewport.zoom : 1,
    },
    nodes: normalizedNodes,
    edges: normalizedEdges,
  };
}

export function loadPipelines(cwd: string, fallback: PipelineDefinition): PersistedPipelines {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${cwd}`) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("No saved pipelines");
    const value = parsed as Record<string, unknown>;
    const pipelines = Array.isArray(value.pipelines)
      ? value.pipelines.map(parsePipelineDefinition).filter((item): item is PipelineDefinition => Boolean(item))
      : [];
    if (!pipelines.length) throw new Error("No usable pipelines");
    const selectedId = typeof value.selectedId === "string" && pipelines.some((p) => p.id === value.selectedId)
      ? value.selectedId
      : pipelines[0].id;
    return { schemaVersion: 1, selectedId, pipelines };
  } catch {
    return { schemaVersion: 1, selectedId: fallback.id, pipelines: [fallback] };
  }
}

export function savePipelines(
  cwd: string,
  pipelines: readonly PipelineDefinition[],
  selectedId: string | null,
): boolean {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${cwd}`,
      JSON.stringify({ schemaVersion: 1, selectedId, pipelines }),
    );
    return true;
  } catch {
    return false;
  }
}
