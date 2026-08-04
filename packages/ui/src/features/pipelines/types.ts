export const PIPELINE_SCHEMA_VERSION = 1 as const;
export const PIPELINE_MAX_NODES = 32;
export const PIPELINE_MAX_EDGES = 128;

export interface PipelinePoint {
  x: number;
  y: number;
}

export interface PipelineViewport extends PipelinePoint {
  zoom: number;
}

export type PipelinePermission = "read-only" | "workspace-write" | "full-access";

export interface PipelineNodeBase {
  id: string;
  name: string;
  position: PipelinePoint;
}

/** The single source node. Its value is the task entered when a run starts. */
export interface PipelineInputNode extends PipelineNodeBase {
  type: "input";
}

/** One independently configured Codex thread and turn in a pipeline run. */
export interface PipelineAgentNode extends PipelineNodeBase {
  type: "agent";
  instructions: string;
  model: string;
  effort: string;
  permission: PipelinePermission;
  retryCount: number;
  color: string;
}

/** The single result sink. It collects its predecessors without running Codex. */
export interface PipelineOutputNode extends PipelineNodeBase {
  type: "output";
}

export type PipelineNode = PipelineInputNode | PipelineAgentNode | PipelineOutputNode;

export interface PipelineEdge {
  id: string;
  source: string;
  target: string;
  /** Stable ordering for composing a join node's upstream context. */
  order: number;
}

export interface PipelineDefinition {
  schemaVersion: typeof PIPELINE_SCHEMA_VERSION;
  id: string;
  name: string;
  viewport: PipelineViewport;
  nodes: PipelineNode[];
  edges: PipelineEdge[];
}

export type PipelineRunStatus =
  | "queued"
  | "validating"
  | "running"
  | "needsAttention"
  | "cancelling"
  | "completed"
  | "failed"
  | "cancelled";

export type PipelineNodeRunStatus =
  | "pending"
  | "ready"
  | "starting"
  | "running"
  | "waitingForApproval"
  | "completed"
  | "failed"
  | "cancelled"
  | "skipped";

export interface PipelineNodeRunState {
  nodeId: string;
  status: PipelineNodeRunStatus;
  attempt: number;
  threadId: string | null;
  turnId: string | null;
  generation: number | null;
  startedAt: number | null;
  completedAt: number | null;
  output: string | null;
  error: string | null;
}

export interface PipelineRun {
  id: string;
  pipelineId: string;
  /** Canonical project root captured at run creation. */
  cwd: string;
  input: string;
  /** Immutable graph snapshot used by this run. */
  definition: PipelineDefinition;
  status: PipelineRunStatus;
  nodes: Record<string, PipelineNodeRunState>;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  output: string | null;
  error: string | null;
}

export type PipelineGraphIssueCode =
  | "unsupported_schema"
  | "invalid_graph_metadata"
  | "node_limit"
  | "edge_limit"
  | "invalid_node"
  | "duplicate_node_id"
  | "invalid_agent"
  | "input_count"
  | "agent_count"
  | "output_count"
  | "invalid_edge"
  | "duplicate_edge_id"
  | "missing_edge_endpoint"
  | "self_edge"
  | "duplicate_connection"
  | "invalid_connection"
  | "cycle"
  | "unreachable_from_input"
  | "cannot_reach_output";

export interface PipelineGraphIssue {
  code: PipelineGraphIssueCode;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface PipelineGraphValidation {
  valid: boolean;
  issues: PipelineGraphIssue[];
  /** Stable Kahn layers when the graph is acyclic, otherwise null. */
  layers: string[][] | null;
}

export interface PipelineConnectionValidation {
  valid: boolean;
  issue: PipelineGraphIssue | null;
}

export interface PipelineUpstreamOutput {
  nodeId: string;
  nodeName: string;
  edgeOrder: number;
  output: string;
}

export interface PipelinePromptInput {
  pipelineName: string;
  runId: string;
  originalTask: string;
  node: PipelineAgentNode;
  upstreamOutputs: PipelineUpstreamOutput[];
}

/** Structural subset accepted from current or future Codex thread item types. */
export interface PipelineMessageItemLike {
  type?: unknown;
  text?: unknown;
  phase?: unknown;
}
