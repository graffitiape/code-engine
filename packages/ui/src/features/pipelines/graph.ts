import {
  PIPELINE_MAX_EDGES,
  PIPELINE_MAX_NODES,
  PIPELINE_SCHEMA_VERSION,
  type PipelineConnectionValidation,
  type PipelineDefinition,
  type PipelineEdge,
  type PipelineGraphIssue,
  type PipelineGraphValidation,
  type PipelineNode,
} from "./types";

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function issue(
  code: PipelineGraphIssue["code"],
  message: string,
  details: Pick<PipelineGraphIssue, "nodeId" | "edgeId"> = {},
): PipelineGraphIssue {
  return { code, message, ...details };
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasFinitePosition(node: PipelineNode): boolean {
  return Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y);
}

function nodeMap(graph: PipelineDefinition): Map<string, PipelineNode> {
  const nodes = new Map<string, PipelineNode>();
  for (const node of graph.nodes) {
    if (!nodes.has(node.id)) nodes.set(node.id, node);
  }
  return nodes;
}

function adjacency(
  graph: PipelineDefinition,
  reverse = false,
): Map<string, Set<string>> {
  const nodes = nodeMap(graph);
  const result = new Map<string, Set<string>>(
    [...nodes.keys()].map((id) => [id, new Set<string>()]),
  );
  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    const from = reverse ? edge.target : edge.source;
    const to = reverse ? edge.source : edge.target;
    result.get(from)?.add(to);
  }
  return result;
}

function reachable(adjacencyMap: Map<string, Set<string>>, start: string): Set<string> {
  const visited = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const next of adjacencyMap.get(current) ?? []) stack.push(next);
  }
  return visited;
}

/**
 * Build deterministic Kahn layers. Nodes within each concurrently runnable
 * layer are sorted by id so array insertion order never changes scheduling.
 */
export function buildTopologicalLayers(graph: PipelineDefinition): string[][] | null {
  const nodes = nodeMap(graph);
  const indegree = new Map<string, number>([...nodes.keys()].map((id) => [id, 0]));
  const outgoing = new Map<string, string[]>([...nodes.keys()].map((id) => [id, []]));

  for (const edge of graph.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    outgoing.get(edge.source)!.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }
  for (const targets of outgoing.values()) targets.sort(compareIds);

  let ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort(compareIds);
  const layers: string[][] = [];
  let processed = 0;

  while (ready.length) {
    const layer = ready;
    layers.push(layer);
    processed += layer.length;
    const next = new Set<string>();
    for (const source of layer) {
      for (const target of outgoing.get(source) ?? []) {
        const degree = (indegree.get(target) ?? 0) - 1;
        indegree.set(target, degree);
        if (degree === 0) next.add(target);
      }
    }
    ready = [...next].sort(compareIds);
  }

  return processed === nodes.size ? layers : null;
}

/** True when adding source -> target would close a directed cycle. */
export function wouldCreateCycle(
  graph: PipelineDefinition,
  sourceId: string,
  targetId: string,
): boolean {
  if (sourceId === targetId) return true;
  const nodes = nodeMap(graph);
  if (!nodes.has(sourceId) || !nodes.has(targetId)) return false;
  return reachable(adjacency(graph), targetId).has(sourceId);
}

/** Validate a proposed canvas connection without mutating the definition. */
export function validatePipelineConnection(
  graph: PipelineDefinition,
  sourceId: string,
  targetId: string,
): PipelineConnectionValidation {
  const nodes = nodeMap(graph);
  const source = nodes.get(sourceId);
  const target = nodes.get(targetId);
  if (!source || !target) {
    return {
      valid: false,
      issue: issue(
        "missing_edge_endpoint",
        "Connections must reference nodes in this pipeline.",
      ),
    };
  }
  if (sourceId === targetId) {
    return {
      valid: false,
      issue: issue("self_edge", "A node cannot connect to itself.", { nodeId: sourceId }),
    };
  }
  if (source.type === "output") {
    return {
      valid: false,
      issue: issue("invalid_connection", "The result node cannot have outgoing connections.", {
        nodeId: sourceId,
      }),
    };
  }
  if (target.type === "input") {
    return {
      valid: false,
      issue: issue("invalid_connection", "The task input cannot have incoming connections.", {
        nodeId: targetId,
      }),
    };
  }
  if (source.type === "input" && target.type === "output") {
    return {
      valid: false,
      issue: issue(
        "invalid_connection",
        "Task input must pass through at least one agent before reaching the result.",
      ),
    };
  }
  if (graph.edges.some((edge) => edge.source === sourceId && edge.target === targetId)) {
    return {
      valid: false,
      issue: issue("duplicate_connection", "These nodes are already connected."),
    };
  }
  if (wouldCreateCycle(graph, sourceId, targetId)) {
    return {
      valid: false,
      issue: issue("cycle", "This connection would create a cycle."),
    };
  }
  return { valid: true, issue: null };
}

/** Incoming edges in the exact order used for prompt/context composition. */
export function orderedIncomingEdges(
  graph: PipelineDefinition,
  nodeId: string,
): PipelineEdge[] {
  return graph.edges
    .filter((edge) => edge.target === nodeId)
    .sort(
      (left, right) =>
        left.order - right.order ||
        compareIds(left.source, right.source) ||
        compareIds(left.id, right.id),
    );
}

export function validatePipelineGraph(graph: PipelineDefinition): PipelineGraphValidation {
  const issues: PipelineGraphIssue[] = [];
  if (graph.schemaVersion !== PIPELINE_SCHEMA_VERSION) {
    issues.push(issue("unsupported_schema", "Only pipeline schema version 1 is supported."));
  }
  if (
    !isNonEmpty(graph.id) ||
    !isNonEmpty(graph.name) ||
    !Number.isFinite(graph.viewport?.x) ||
    !Number.isFinite(graph.viewport?.y) ||
    !Number.isFinite(graph.viewport?.zoom) ||
    graph.viewport.zoom <= 0
  ) {
    issues.push(issue("invalid_graph_metadata", "Pipeline metadata or viewport is invalid."));
  }
  if (graph.nodes.length > PIPELINE_MAX_NODES) {
    issues.push(issue("node_limit", `Pipelines support at most ${PIPELINE_MAX_NODES} nodes.`));
  }
  if (graph.edges.length > PIPELINE_MAX_EDGES) {
    issues.push(issue("edge_limit", `Pipelines support at most ${PIPELINE_MAX_EDGES} edges.`));
  }

  const seenNodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!isNonEmpty(node.id) || !isNonEmpty(node.name) || !hasFinitePosition(node)) {
      issues.push(issue("invalid_node", "Every node needs an id, name, and finite position.", {
        nodeId: node.id,
      }));
    }
    if (seenNodeIds.has(node.id)) {
      issues.push(issue("duplicate_node_id", `Node id "${node.id}" is duplicated.`, {
        nodeId: node.id,
      }));
    }
    seenNodeIds.add(node.id);
    if (node.type === "agent") {
      if (
        !isNonEmpty(node.instructions) ||
        !isNonEmpty(node.model) ||
        !isNonEmpty(node.effort) ||
        !isNonEmpty(node.color) ||
        !Number.isInteger(node.retryCount) ||
        node.retryCount < 0 ||
        node.retryCount > 3
      ) {
        issues.push(issue(
          "invalid_agent",
          "Agent nodes require instructions, model, effort, color, and a retry count from 0 to 3.",
          { nodeId: node.id },
        ));
      }
    }
  }

  const inputs = graph.nodes.filter((node) => node.type === "input");
  const agents = graph.nodes.filter((node) => node.type === "agent");
  const outputs = graph.nodes.filter((node) => node.type === "output");
  if (inputs.length !== 1) {
    issues.push(issue("input_count", "A pipeline must contain exactly one task input node."));
  }
  if (agents.length < 1) {
    issues.push(issue("agent_count", "A pipeline must contain at least one agent node."));
  }
  if (outputs.length !== 1) {
    issues.push(issue("output_count", "A pipeline must contain exactly one result node."));
  }

  const nodes = nodeMap(graph);
  const seenEdgeIds = new Set<string>();
  const seenConnections = new Set<string>();
  for (const edge of graph.edges) {
    if (!isNonEmpty(edge.id) || !Number.isInteger(edge.order) || edge.order < 0) {
      issues.push(issue("invalid_edge", "Every edge needs an id and non-negative integer order.", {
        edgeId: edge.id,
      }));
    }
    if (seenEdgeIds.has(edge.id)) {
      issues.push(issue("duplicate_edge_id", `Edge id "${edge.id}" is duplicated.`, {
        edgeId: edge.id,
      }));
    }
    seenEdgeIds.add(edge.id);

    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (!source || !target) {
      issues.push(issue("missing_edge_endpoint", "An edge references a missing node.", {
        edgeId: edge.id,
      }));
      continue;
    }
    if (edge.source === edge.target) {
      issues.push(issue("self_edge", "A node cannot connect to itself.", {
        nodeId: edge.source,
        edgeId: edge.id,
      }));
    }
    const connectionKey = `${edge.source}\u0000${edge.target}`;
    if (seenConnections.has(connectionKey)) {
      issues.push(issue("duplicate_connection", "Two edges connect the same node pair.", {
        edgeId: edge.id,
      }));
    }
    seenConnections.add(connectionKey);

    if (
      source.type === "output" ||
      target.type === "input" ||
      (source.type === "input" && target.type === "output")
    ) {
      issues.push(issue("invalid_connection", "The edge violates input/result node semantics.", {
        edgeId: edge.id,
      }));
    }
  }

  const layers = buildTopologicalLayers(graph);
  if (layers === null) issues.push(issue("cycle", "Pipeline connections must form a DAG."));

  if (inputs.length === 1 && outputs.length === 1) {
    const fromInput = reachable(adjacency(graph), inputs[0].id);
    const toOutput = reachable(adjacency(graph, true), outputs[0].id);
    for (const node of graph.nodes) {
      if (!fromInput.has(node.id)) {
        issues.push(issue(
          "unreachable_from_input",
          `Node "${node.name}" is not reachable from the task input.`,
          { nodeId: node.id },
        ));
      }
      if (!toOutput.has(node.id)) {
        issues.push(issue(
          "cannot_reach_output",
          `Node "${node.name}" cannot reach the result node.`,
          { nodeId: node.id },
        ));
      }
    }
  }

  return { valid: issues.length === 0, issues, layers };
}
