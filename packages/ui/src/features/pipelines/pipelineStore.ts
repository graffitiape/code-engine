import { createStore } from "solid-js/store";
import type { CodexModel, CodexServerRequest } from "../../bridge/tauri";
import { validatePipelineConnection } from "./graph";
import { pipelineAgentPreset, type PipelineAgentPresetId } from "./agentPresets";
import {
  createStarterPipeline,
  duplicatePipeline as clonePipeline,
  loadPipelines,
  newPipelineId,
  savePipelines,
} from "./pipelinePersistence";
import {
  createPipelineTask as createTaskRecord,
  loadPipelineTasks,
  savePipelineTasks,
} from "./pipelineTaskPersistence";
import type {
  PipelineAgentNode,
  PipelineConnectionMode,
  PipelineDefinition,
  PipelineEdge,
  PipelineEdgeRunState,
  PipelineIntegrationNode,
  PipelineNode,
  PipelineNodeRunState,
  PipelinePoint,
  PipelineRun,
  PipelineRunStatus,
  PipelineTask,
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
  tasks: PipelineTask[];
  selectedTaskId: string | null;
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
  tasks: [],
  selectedTaskId: null,
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
  const size = node.type === "agent" || node.type === "integration" || node.type === "approval"
    ? AGENT_NODE_SIZE
    : TERMINAL_NODE_SIZE;
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

export function selectedPipelineTask(): PipelineTask | null {
  return pipelineState.tasks.find((task) => task.id === pipelineState.selectedTaskId) ?? null;
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

function persistTasks() {
  if (
    pipelineState.cwd &&
    !savePipelineTasks(pipelineState.cwd, pipelineState.tasks, pipelineState.selectedTaskId)
  ) {
    setPipelineState("error", "Pipeline tasks could not be saved in this webview.");
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
      tasks: [],
      selectedTaskId: null,
      run: null,
      pendingRequests: [],
      error: null,
    });
    return;
  }
  const loaded = loadPipelines(cwd, createStarterPipeline("Development pipeline", model, effort));
  const taskState = loadPipelineTasks(cwd, new Set(loaded.pipelines.map((pipeline) => pipeline.id)));
  setPipelineState({
    cwd,
    pipelines: loaded.pipelines,
    selectedId: loaded.selectedId,
    selectedNodeId: null,
    selectedEdgeId: null,
    connectionSource: null,
    tasks: taskState.tasks,
    selectedTaskId: taskState.selectedId,
    run: null,
    pendingRequests: [],
    error: null,
  });
  persist();
  persistTasks();
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
  setPipelineState(
    "tasks",
    pipelineState.tasks.map((task) => task.pipelineId === current.id
      ? { ...task, pipelineId: pipelines[0].id, updatedAt: Date.now() }
      : task),
  );
  setPipelineState({ selectedId: pipelines[0].id, selectedNodeId: null, selectedEdgeId: null });
  persist();
  persistTasks();
}

export function renameSelectedPipeline(name: string) {
  const clean = name.trim();
  if (clean) replaceSelected((pipeline) => ({ ...pipeline, name: clean }));
}

export function addAgentNode(
  model: string,
  effort: string,
  canvasSize?: PipelineCanvasSize,
  presetId: PipelineAgentPresetId = "custom",
): string | null {
  const pipeline = selectedPipeline();
  if (!pipeline || !mayEdit()) return null;
  if (pipeline.nodes.length >= PIPELINE_MAX_NODES) {
    setPipelineState("error", `Pipelines support at most ${PIPELINE_MAX_NODES} nodes.`);
    return null;
  }
  const agents = pipeline.nodes.filter((node) => node.type === "agent");
  const preset = pipelineAgentPreset(presetId);
  const matchingNames = agents.filter((agent) => agent.name === preset.name || agent.name.startsWith(`${preset.name} `));
  const node: PipelineAgentNode = {
    id: newPipelineId("node"),
    type: "agent",
    name: matchingNames.length ? `${preset.name} ${matchingNames.length + 1}` : preset.name,
    position: visibleAgentPosition(pipeline, canvasSize),
    instructions: preset.instructions,
    model,
    effort,
    permission: preset.permission,
    retryCount: 1,
    color: preset.color,
  };
  replaceSelected((definition) => ({ ...definition, nodes: [...definition.nodes, node] }));
  setPipelineState({ selectedNodeId: node.id, selectedEdgeId: null });
  return node.id;
}

export function addIntegrationNode(canvasSize?: PipelineCanvasSize): string | null {
  const pipeline = selectedPipeline();
  if (!pipeline || !mayEdit()) return null;
  if (pipeline.nodes.length >= PIPELINE_MAX_NODES) {
    setPipelineState("error", `Pipelines support at most ${PIPELINE_MAX_NODES} nodes.`);
    return null;
  }
  const integrations = pipeline.nodes.filter((node) => node.type === "integration");
  const node: PipelineIntegrationNode = {
    id: newPipelineId("node"),
    type: "integration",
    name: integrations.length ? `Git ${integrations.length + 1}` : "Commit & push",
    position: visibleAgentPosition(pipeline, canvasSize),
    provider: "git",
    action: "commit-push",
    stageAll: true,
    commitMessage: "feat: {{task}}",
    color: "orange",
  };
  replaceSelected((definition) => ({ ...definition, nodes: [...definition.nodes, node] }));
  setPipelineState({ selectedNodeId: node.id, selectedEdgeId: null });
  return node.id;
}

export interface PipelineNodePatch {
  name?: string;
  instructions?: string;
  model?: string;
  effort?: string;
  permission?: PipelineAgentNode["permission"];
  retryCount?: number;
  color?: string;
  provider?: PipelineIntegrationNode["provider"];
  action?: PipelineIntegrationNode["action"];
  stageAll?: boolean;
  commitMessage?: string;
  message?: string;
}

export function updateNode(nodeId: string, patch: PipelineNodePatch) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.map((node): PipelineNode => {
      if (node.id !== nodeId) return node;
      if (node.type === "agent") {
        return { ...node, ...patch, id: node.id, type: "agent", position: node.position };
      }
      if (node.type === "integration") {
        return { ...node, ...patch, id: node.id, type: "integration", position: node.position };
      }
      if (node.type === "approval") {
        return { ...node, ...patch, id: node.id, type: "approval", position: node.position };
      }
      return { ...node, name: patch.name ?? node.name };
    }),
  }));
}

export function moveNode(nodeId: string, position: PipelinePoint) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.map((node) =>
      node.id === nodeId ? { ...node, position } : node,
    ),
  }));
}

export function deleteNode(nodeId: string) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    nodes: pipeline.nodes.filter(
      (node) => node.id !== nodeId || (
        node.type !== "agent" && node.type !== "integration" && node.type !== "approval"
      ),
    ),
    edges: pipeline.edges.filter((edge) => edge.source !== nodeId && edge.target !== nodeId),
  }));
  setPipelineState({ selectedNodeId: null, connectionSource: null });
}

function approvalMessageFor(pipeline: PipelineDefinition, source: string, target: string): string {
  const sourceName = pipeline.nodes.find((node) => node.id === source)?.name ?? "upstream step";
  const targetName = pipeline.nodes.find((node) => node.id === target)?.name ?? "downstream step";
  return `Review ${sourceName}'s result before allowing ${targetName} to start.`;
}

export function connectNodes(
  source: string,
  target: string,
  mode: PipelineConnectionMode = "automatic",
): boolean {
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
  const edge: PipelineEdge = {
    id: newPipelineId("edge"),
    source,
    target,
    order,
    mode,
    approvalMessage: mode === "approval" ? approvalMessageFor(pipeline, source, target) : "",
  };
  replaceSelected((definition) => ({ ...definition, edges: [...definition.edges, edge] }));
  setPipelineState({ connectionSource: null, selectedEdgeId: edge.id, selectedNodeId: null, announcement: "Nodes connected." });
  return true;
}

export interface PipelineEdgePatch {
  mode?: PipelineConnectionMode;
  approvalMessage?: string;
}

export function updateEdge(edgeId: string, patch: PipelineEdgePatch) {
  replaceSelected((pipeline) => ({
    ...pipeline,
    edges: pipeline.edges.map((edge) => {
      if (edge.id !== edgeId) return edge;
      const mode = patch.mode ?? edge.mode;
      const approvalMessage = patch.approvalMessage ?? (
        mode === "approval" && !edge.approvalMessage.trim()
          ? approvalMessageFor(pipeline, edge.source, edge.target)
          : edge.approvalMessage
      );
      return {
        ...edge,
        ...patch,
        mode,
        approvalMessage: mode === "approval" ? approvalMessage : "",
      };
    }),
  }));
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

export function selectPipelineTask(id: string) {
  if (!pipelineState.tasks.some((task) => task.id === id)) return;
  if (pipelineRunIsActive() && pipelineState.run?.taskId !== id) return;
  setPipelineState("selectedTaskId", id);
  persistTasks();
}

export function addPipelineTask(title: string, description: string, pipelineId: string): string | null {
  if (pipelineRunIsActive()) {
    setPipelineState("error", "Stop the active run before adding another task.");
    return null;
  }
  const pipeline = pipelineState.pipelines.find((entry) => entry.id === pipelineId);
  const cleanTitle = title.trim();
  const cleanDescription = description.trim();
  if (!pipeline || !cleanTitle || !cleanDescription) {
    setPipelineState("error", "A task needs a title, description, and pipeline template.");
    return null;
  }
  const task = createTaskRecord(cleanTitle, cleanDescription, pipelineId);
  setPipelineState("tasks", [task, ...pipelineState.tasks]);
  setPipelineState("selectedTaskId", task.id);
  persistTasks();
  return task.id;
}

export function updatePipelineTask(
  taskId: string,
  patch: Partial<Pick<PipelineTask, "title" | "description" | "pipelineId">>,
) {
  if (pipelineRunIsActive()) return;
  const pipelineExists = patch.pipelineId === undefined || pipelineState.pipelines.some(
    (pipeline) => pipeline.id === patch.pipelineId,
  );
  if (!pipelineExists) return;
  setPipelineState(
    "tasks",
    pipelineState.tasks.map((task) => task.id === taskId
      ? { ...task, ...patch, updatedAt: Date.now() }
      : task),
  );
  persistTasks();
}

export function deletePipelineTask(taskId: string) {
  if (pipelineRunIsActive()) return;
  const task = pipelineState.tasks.find((entry) => entry.id === taskId);
  if (!task || !window.confirm(`Delete “${task.title}”?`)) return;
  const tasks = pipelineState.tasks.filter((entry) => entry.id !== taskId);
  setPipelineState({
    tasks,
    selectedTaskId: pipelineState.selectedTaskId === taskId ? tasks[0]?.id ?? null : pipelineState.selectedTaskId,
  });
  persistTasks();
}

export function patchPipelineTaskRun(
  taskId: string,
  patch: Partial<Pick<PipelineTask,
    "runCount" | "lastRunId" | "lastRunStatus" | "lastRunAt" | "lastOutput" | "lastError"
  >>,
) {
  setPipelineState(
    "tasks",
    pipelineState.tasks.map((task) => task.id === taskId
      ? { ...task, ...patch, updatedAt: Date.now() }
      : task),
  );
  persistTasks();
}

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

export function patchPipelineRunEdge(
  edgeId: string,
  patch: Partial<PipelineEdgeRunState>,
  expectedRunId?: string,
) {
  const run = pipelineState.run;
  if (expectedRunId && run?.id !== expectedRunId) return;
  const edge = run?.edges[edgeId];
  if (!run || !edge) return;
  setPipelineState("run", {
    ...run,
    updatedAt: Date.now(),
    edges: { ...run.edges, [edgeId]: { ...edge, ...patch, edgeId } },
  });
}

export const setPipelineRequests = (requests: CodexServerRequest[]) => setPipelineState("pendingRequests", requests);
export const setPipelineError = (error: string | null) => setPipelineState("error", error);
export function usePipelineState() { return pipelineState; }
