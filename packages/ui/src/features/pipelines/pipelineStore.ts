import { createStore } from "solid-js/store";
import type { CodexModel, CodexServerRequest } from "../../bridge/tauri";
import { validatePipelineConnection } from "./graph";
import {
  createStarterPipeline,
  duplicatePipeline as clonePipeline,
  loadPipelines,
  newPipelineId,
  savePipelines,
} from "./pipelinePersistence";
import type {
  PipelineAgentNode,
  PipelineDefinition,
  PipelineEdge,
  PipelineNode,
  PipelineNodeRunState,
  PipelinePoint,
  PipelineRun,
  PipelineRunStatus,
  PipelineViewport,
} from "./types";
import { PIPELINE_MAX_EDGES, PIPELINE_MAX_NODES } from "./types";

interface PipelineWorkspaceState {
  cwd: string | null;
  pipelines: PipelineDefinition[];
  selectedId: string | null;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  connectionSource: string | null;
  task: string;
  run: PipelineRun | null;
  pendingRequests: CodexServerRequest[];
  error: string | null;
  announcement: string;
}

const [pipelineState, setPipelineState] = createStore<PipelineWorkspaceState>({
  cwd: null,
  pipelines: [],
  selectedId: null,
  selectedNodeId: null,
  selectedEdgeId: null,
  connectionSource: null,
  task: "",
  run: null,
  pendingRequests: [],
  error: null,
  announcement: "",
});

const ACTIVE_RUN_STATUSES = new Set<PipelineRunStatus>([
  "queued",
  "validating",
  "running",
  "needsAttention",
  "cancelling",
]);
let viewportPersistTimer: number | undefined;
let pendingViewportPersist: (() => void) | null = null;

export interface PipelineCanvasSize {
  width: number;
  height: number;
}

const DEFAULT_CANVAS_SIZE: PipelineCanvasSize = { width: 800, height: 600 };
const AGENT_NODE_SIZE = { width: 264, height: 184 };
const TERMINAL_NODE_SIZE = { width: 208, height: 100 };
const PLACEMENT_PADDING = 24;

function finiteCanvasDimension(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function clampPlacement(value: number, minimum: number, maximum: number): number {
  if (minimum > maximum) return (minimum + maximum) / 2;
  return Math.min(maximum, Math.max(minimum, value));
}

function overlapsNode(
  candidate: PipelinePoint,
  node: PipelineNode,
  gap: number,
): boolean {
  const size = node.type === "agent" ? AGENT_NODE_SIZE : TERMINAL_NODE_SIZE;
  return !(
    candidate.x + AGENT_NODE_SIZE.width + gap <= node.position.x ||
    candidate.x >= node.position.x + size.width + gap ||
    candidate.y + AGENT_NODE_SIZE.height + gap <= node.position.y ||
    candidate.y >= node.position.y + size.height + gap
  );
}

function visibleAgentPosition(
  pipeline: PipelineDefinition,
  requestedSize?: PipelineCanvasSize,
): PipelinePoint {
  const width = finiteCanvasDimension(requestedSize?.width, DEFAULT_CANVAS_SIZE.width);
  const height = finiteCanvasDimension(requestedSize?.height, DEFAULT_CANVAS_SIZE.height);
  const zoom = Number.isFinite(pipeline.viewport.zoom) && pipeline.viewport.zoom > 0
    ? pipeline.viewport.zoom
    : 1;
  const minimumX = (PLACEMENT_PADDING - pipeline.viewport.x) / zoom;
  const maximumX = (width - PLACEMENT_PADDING - pipeline.viewport.x) / zoom - AGENT_NODE_SIZE.width;
  const minimumY = (PLACEMENT_PADDING - pipeline.viewport.y) / zoom;
  const maximumY = (height - PLACEMENT_PADDING - pipeline.viewport.y) / zoom - AGENT_NODE_SIZE.height;
  const center = {
    x: (width / 2 - pipeline.viewport.x) / zoom - AGENT_NODE_SIZE.width / 2,
    y: (height / 2 - pipeline.viewport.y) / zoom - AGENT_NODE_SIZE.height / 2,
  };
  const stepX = AGENT_NODE_SIZE.width + 32 / zoom;
  const stepY = AGENT_NODE_SIZE.height + 32 / zoom;
  const offsets = [
    [0, 0],
    [0, -stepY],
    [0, stepY],
    [-stepX, 0],
    [stepX, 0],
    [-stepX, -stepY],
    [stepX, -stepY],
    [-stepX, stepY],
    [stepX, stepY],
  ] as const;
  const candidates = offsets.map(([offsetX, offsetY]) => ({
    x: clampPlacement(center.x + offsetX, minimumX, maximumX),
    y: clampPlacement(center.y + offsetY, minimumY, maximumY),
  }));
  const gap = 16 / zoom;
  return candidates.find(
    (candidate) => pipeline.nodes.every((node) => !overlapsNode(candidate, node, gap)),
  ) ?? candidates[0];
}

export function pipelineRunIsActive(run = pipelineState.run): boolean {
  return Boolean(run && ACTIVE_RUN_STATUSES.has(run.status));
}

export function selectedPipeline(): PipelineDefinition | null {
  return pipelineState.pipelines.find((pipeline) => pipeline.id === pipelineState.selectedId) ?? null;
}

function persist() {
  if (viewportPersistTimer !== undefined) window.clearTimeout(viewportPersistTimer);
  viewportPersistTimer = undefined;
  pendingViewportPersist = null;
  if (pipelineState.cwd) {
    if (!savePipelines(pipelineState.cwd, pipelineState.pipelines, pipelineState.selectedId)) {
      setPipelineState("error", "Pipeline changes could not be saved in this webview.");
    }
  }
}

function flushViewportPersistence() {
  if (viewportPersistTimer !== undefined) window.clearTimeout(viewportPersistTimer);
  viewportPersistTimer = undefined;
  const save = pendingViewportPersist;
  pendingViewportPersist = null;
  save?.();
}

function mayEdit(): boolean {
  if (!pipelineRunIsActive()) return true;
  setPipelineState("error", "Stop the active run before editing its pipeline.");
  return false;
}

function replaceSelected(transform: (pipeline: PipelineDefinition) => PipelineDefinition) {
  if (!mayEdit()) return;
  const current = selectedPipeline();
  if (!current) return;
  setPipelineState(
    "pipelines",
    pipelineState.pipelines.map((pipeline) =>
      pipeline.id === current.id ? transform(pipeline) : pipeline,
    ),
  );
  persist();
}

export function initializePipelines(cwd: string | null, model = "", effort = "medium") {
  if (cwd === pipelineState.cwd) return;
  flushViewportPersistence();
  if (!cwd) {
    setPipelineState({
      cwd: null,
      pipelines: [],
      selectedId: null,
      selectedNodeId: null,
      selectedEdgeId: null,
      connectionSource: null,
      run: null,
      pendingRequests: [],
      error: null,
    });
    return;
  }
  const loaded = loadPipelines(cwd, createStarterPipeline("Development pipeline", model, effort));
  setPipelineState({
    cwd,
    pipelines: loaded.pipelines,
    selectedId: loaded.selectedId,
    selectedNodeId: null,
    selectedEdgeId: null,
    connectionSource: null,
    task: "",
    run: null,
    pendingRequests: [],
    error: null,
  });
  persist();
}

export function selectPipeline(id: string) {
  if (!pipelineState.pipelines.some((pipeline) => pipeline.id === id)) return;
  setPipelineState({ selectedId: id, selectedNodeId: null, selectedEdgeId: null, connectionSource: null });
  persist();
}

export function createPipeline(model = "", effort = "medium") {
  if (!mayEdit()) return;
  const pipeline = createStarterPipeline(`Pipeline ${pipelineState.pipelines.length + 1}`, model, effort);
  setPipelineState("pipelines", [...pipelineState.pipelines, pipeline]);
  setPipelineState({ selectedId: pipeline.id, selectedNodeId: null, selectedEdgeId: null });
  persist();
}

export function duplicateSelectedPipeline() {
  if (!mayEdit()) return;
  const current = selectedPipeline();
  if (!current) return;
  const pipeline = clonePipeline(current);
  setPipelineState("pipelines", [...pipelineState.pipelines, pipeline]);
  setPipelineState({ selectedId: pipeline.id, selectedNodeId: null, selectedEdgeId: null });
  persist();
}

export function deleteSelectedPipeline(model = "", effort = "medium") {
  if (!mayEdit()) return;
  const current = selectedPipeline();
  if (!current || !window.confirm(`Delete “${current.name}”?`)) return;
  let pipelines = pipelineState.pipelines.filter((pipeline) => pipeline.id !== current.id);
  if (!pipelines.length) pipelines = [createStarterPipeline("Development pipeline", model, effort)];
  setPipelineState("pipelines", pipelines);
  setPipelineState({ selectedId: pipelines[0].id, selectedNodeId: null, selectedEdgeId: null });
  persist();
}

export function renameSelectedPipeline(name: string) {
  const clean = name.trim();
  if (clean) replaceSelected((pipeline) => ({ ...pipeline, name: clean }));
}

export function addAgentNode(
  model: string,
  effort: string,
  canvasSize?: PipelineCanvasSize,
): string | null {
  const pipeline = selectedPipeline();
  if (!pipeline || !mayEdit()) return null;
  if (pipeline.nodes.length >= PIPELINE_MAX_NODES) {
    setPipelineState("error", `Pipelines support at most ${PIPELINE_MAX_NODES} nodes.`);
    return null;
  }
  const agents = pipeline.nodes.filter((node) => node.type === "agent");
  const node: PipelineAgentNode = {
    id: newPipelineId("node"),
    type: "agent",
    name: `Agent ${agents.length + 1}`,
    position: visibleAgentPosition(pipeline, canvasSize),
    instructions: "Complete this stage using the original task and upstream handoffs. Return a clear result for downstream agents.",
    model,
    effort,
    permission: "read-only",
    retryCount: 1,
    color: ["cyan", "purple", "green", "blue", "orange"][agents.length % 5],
  };
  replaceSelected((definition) => ({ ...definition, nodes: [...definition.nodes, node] }));
  setPipelineState({ selectedNodeId: node.id, selectedEdgeId: null });
  return node.id;
}

export function updateNode(nodeId: string, patch: Partial<PipelineAgentNode> & { name?: string }) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.map((node): PipelineNode => {
      if (node.id !== nodeId) return node;
      if (node.type !== "agent") return { ...node, name: patch.name ?? node.name };
      return { ...node, ...patch, id: node.id, type: "agent", position: node.position };
    }),
  }));
}

export function moveNode(nodeId: string, position: PipelinePoint) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.map((node) =>
      node.id === nodeId && node.type === "agent" ? { ...node, position } : node,
    ),
  }));
}

export function deleteNode(nodeId: string) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.filter((node) => node.id !== nodeId || node.type !== "agent"),
    edges: pipeline.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  }));
  setPipelineState({ selectedNodeId: null, connectionSource: null });
}

export function connectNodes(source: string, target: string): boolean {
  const pipeline = selectedPipeline();
  if (!pipeline || !mayEdit()) return false;
  if (pipeline.edges.length >= PIPELINE_MAX_EDGES) {
    setPipelineState("error", `Pipelines support at most ${PIPELINE_MAX_EDGES} connections.`);
    return false;
  }
  const validation = validatePipelineConnection(pipeline, source, target);
  if (!validation.valid) {
    setPipelineState({ error: validation.issue?.message ?? "Cannot connect these nodes.", announcement: validation.issue?.message ?? "Connection rejected." });
    return false;
  }
  const order = Math.max(-1, ...pipeline.edges.filter((edge) => edge.target === target).map((edge) => edge.order)) + 1;
  const edge: PipelineEdge = { id: newPipelineId("edge"), source, target, order };
  replaceSelected((definition) => ({ ...definition, edges: [...definition.edges, edge] }));
  setPipelineState({ connectionSource: null, selectedEdgeId: edge.id, selectedNodeId: null, announcement: "Nodes connected." });
  return true;
}

export function deleteEdge(edgeId: string) {
  replaceSelected((pipeline) => ({ ...pipeline, edges: pipeline.edges.filter((edge) => edge.id !== edgeId) }));
  setPipelineState("selectedEdgeId", null);
}

export function setViewport(viewport: PipelineViewport) {
  const current = selectedPipeline();
  if (!current) return;
  setPipelineState(
    "pipelines",
    pipelineState.pipelines.map((pipeline) =>
      pipeline.id === current.id ? { ...pipeline, viewport } : pipeline,
    ),
  );
  if (viewportPersistTimer !== undefined) window.clearTimeout(viewportPersistTimer);
  const cwd = pipelineState.cwd;
  const snapshot = JSON.parse(JSON.stringify(pipelineState.pipelines)) as PipelineDefinition[];
  const selectedId = pipelineState.selectedId;
  pendingViewportPersist = () => {
    if (cwd && !savePipelines(cwd, snapshot, selectedId) && pipelineState.cwd === cwd) {
      setPipelineState("error", "The latest pipeline viewport could not be saved.");
    }
  };
  viewportPersistTimer = window.setTimeout(() => {
    viewportPersistTimer = undefined;
    const save = pendingViewportPersist;
    pendingViewportPersist = null;
    save?.();
  }, 180);
}

export function syncPipelineModels(models: readonly CodexModel[]) {
  if (!models.length || pipelineRunIsActive()) return;
  const fallback = models.find((model) => model.isDefault) ?? models[0];
  let changed = false;
  const pipelines = pipelineState.pipelines.map((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.map((node) => {
      if (node.type !== "agent") return node;
      const match = models.find((model) => model.model === node.model) ?? fallback;
      const efforts = match.supportedReasoningEfforts.map((option) => option.reasoningEffort);
      const effort = efforts.includes(node.effort) ? node.effort : match.defaultReasoningEffort;
      changed ||= match.model !== node.model || effort !== node.effort;
      return { ...node, model: match.model, effort };
    }),
  }));
  if (changed) {
    setPipelineState("pipelines", pipelines);
    persist();
  }
}

export const selectPipelineNode = (id: string | null) => setPipelineState({ selectedNodeId: id, selectedEdgeId: null });
export const selectPipelineEdge = (id: string | null) => setPipelineState({ selectedEdgeId: id, selectedNodeId: null });
export const setConnectionSource = (id: string | null) => setPipelineState("connectionSource", id);
export const setPipelineTask = (task: string) => setPipelineState("task", task);
export function clearPipelineError() {
  setPipelineState("error", null);
  if (pipelineState.run?.error) patchPipelineRun({ error: null }, pipelineState.run.id);
}
export const announcePipeline = (message: string) => setPipelineState("announcement", message);

export function setPipelineRun(run: PipelineRun | null) {
  setPipelineState({
    run,
    pendingRequests: [],
    connectionSource: run ? null : pipelineState.connectionSource,
  });
}

export function patchPipelineRun(patch: Partial<PipelineRun>, expectedRunId?: string) {
  if (!pipelineState.run || (expectedRunId && pipelineState.run.id !== expectedRunId)) return;
  setPipelineState("run", { ...pipelineState.run, ...patch, updatedAt: Date.now() });
}

export function patchPipelineRunNode(
  nodeId: string,
  patch: Partial<PipelineNodeRunState>,
  expectedRunId?: string,
) {
  const run = pipelineState.run;
  if (expectedRunId && run?.id !== expectedRunId) return;
  const node = run?.nodes[nodeId];
  if (!run || !node) return;
  setPipelineState("run", {
    ...run,
    updatedAt: Date.now(),
    nodes: { ...run.nodes, [nodeId]: { ...node, ...patch, nodeId } },
  });
}

export const setPipelineRequests = (requests: CodexServerRequest[]) => setPipelineState("pendingRequests", requests);
export const setPipelineError = (error: string | null) => setPipelineState("error", error);
export function usePipelineState() { return pipelineState; }
