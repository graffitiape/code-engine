import {
  PIPELINE_MAX_EDGES,
  PIPELINE_MAX_NODES,
  PIPELINE_SCHEMA_VERSION,
  type PipelineAgentNode,
  type PipelineDefinition,
  type PipelineEdge,
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

function starterAgent(
  name: string,
  x: number,
  instructions: string,
  model: string,
  effort: string,
  permission: PipelinePermission,
  color: string,
): PipelineAgentNode {
  return {
    id: newPipelineId("node"),
    type: "agent",
    name,
    position: { x, y: 220 },
    instructions,
    model,
    effort,
    permission,
    retryCount: 1,
    color,
  };
}

export function createStarterPipeline(
  name = "Development pipeline",
  model = "",
  effort = "medium",
): PipelineDefinition {
  const input: PipelineNode = {
    id: newPipelineId("node"),
    type: "input",
    name: "Task input",
    position: { x: 80, y: 220 },
  };
  const research = starterAgent(
    "Researcher",
    340,
    "Inspect the project and task. Identify relevant files, constraints, risks, and a concrete implementation plan. Do not modify files.",
    model,
    effort,
    "read-only",
    "cyan",
  );
  const builder = starterAgent(
    "Builder",
    620,
    "Implement the task completely in the active project. Use the upstream research as context, preserve existing work, and verify your changes.",
    model,
    effort,
    "workspace-write",
    "purple",
  );
  const reviewer = starterAgent(
    "Reviewer",
    900,
    "Review the implementation against the original task and upstream handoffs. Run focused checks, fix only when permitted, and give a clear final result.",
    model,
    effort,
    "read-only",
    "green",
  );
  const output: PipelineNode = {
    id: newPipelineId("node"),
    type: "output",
    name: "Result",
    position: { x: 1180, y: 220 },
  };
  const nodes = [input, research, builder, reviewer, output];
  const edges: PipelineEdge[] = nodes.slice(0, -1).map((node, index) => ({
    id: newPipelineId("edge"),
    source: node.id,
    target: nodes[index + 1].id,
    order: index,
  }));
  return {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    id: newPipelineId("pipeline"),
    name,
    viewport: { x: 24, y: 70, zoom: 0.55 },
    nodes,
    edges,
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

function parseNode(value: unknown): PipelineNode | null {
  if (!value || typeof value !== "object") return null;
  const node = value as Record<string, unknown>;
  const position = point(node.position);
  if (typeof node.id !== "string" || typeof node.name !== "string" || !position) return null;
  if (node.type === "input" || node.type === "output") {
    return { id: node.id, type: node.type, name: node.name, position };
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

function parseDefinition(value: unknown): PipelineDefinition | null {
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
  const edges = item.edges.filter((edge): edge is PipelineEdge => {
    if (!edge || typeof edge !== "object") return false;
    const candidate = edge as Partial<PipelineEdge>;
    return typeof candidate.id === "string" && typeof candidate.source === "string" &&
      typeof candidate.target === "string" && Number.isFinite(candidate.order);
  });
  if (edges.length !== item.edges.length) return null;
  return {
    schemaVersion: PIPELINE_SCHEMA_VERSION,
    id: item.id,
    name: item.name,
    viewport: {
      x: typeof viewport?.x === "number" ? viewport.x : 0,
      y: typeof viewport?.y === "number" ? viewport.y : 0,
      zoom: typeof viewport?.zoom === "number" ? viewport.zoom : 1,
    },
    nodes: nodes as PipelineNode[],
    edges,
  };
}

export function loadPipelines(cwd: string, fallback: PipelineDefinition): PersistedPipelines {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${cwd}`) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("No saved pipelines");
    const value = parsed as Record<string, unknown>;
    const pipelines = Array.isArray(value.pipelines)
      ? value.pipelines.map(parseDefinition).filter((item): item is PipelineDefinition => Boolean(item))
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
