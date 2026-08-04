import { describe, expect, it } from "vitest";
import {
  buildTopologicalLayers,
  orderedIncomingEdges,
  validatePipelineConnection,
  validatePipelineGraph,
  wouldCreateCycle,
} from "./graph";
import {
  PIPELINE_MAX_EDGES,
  PIPELINE_MAX_NODES,
  type PipelineAgentNode,
  type PipelineDefinition,
  type PipelineEdge,
  type PipelineNode,
} from "./types";

function agent(id: string, name = id): PipelineAgentNode {
  return {
    id,
    type: "agent",
    name,
    position: { x: 100, y: 100 },
    instructions: `Do ${name}`,
    model: "gpt-test",
    effort: "medium",
    permission: "read-only",
    retryCount: 1,
    color: "#7dcfff",
  };
}

function edge(id: string, source: string, target: string, order = 0): PipelineEdge {
  return { id, source, target, order };
}

function graph(nodes: PipelineNode[], edges: PipelineEdge[]): PipelineDefinition {
  return {
    schemaVersion: 1,
    id: "pipeline-1",
    name: "Test pipeline",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges,
  };
}

function diamond(): PipelineDefinition {
  return graph(
    [
      { id: "result", type: "output", name: "Result", position: { x: 300, y: 0 } },
      agent("beta", "Beta"),
      { id: "task", type: "input", name: "Task", position: { x: 0, y: 0 } },
      agent("alpha", "Alpha"),
    ],
    [
      edge("beta-result", "beta", "result", 2),
      edge("task-beta", "task", "beta", 1),
      edge("alpha-result", "alpha", "result", 1),
      edge("task-alpha", "task", "alpha", 0),
    ],
  );
}

function codes(definition: PipelineDefinition): string[] {
  return validatePipelineGraph(definition).issues.map((entry) => entry.code);
}

describe("pipeline graph validation", () => {
  it("accepts a valid diamond and returns stable Kahn layers", () => {
    const definition = diamond();
    expect(validatePipelineGraph(definition)).toEqual({
      valid: true,
      issues: [],
      layers: [["task"], ["alpha", "beta"], ["result"]],
    });
    expect(buildTopologicalLayers({
      ...definition,
      nodes: [...definition.nodes].reverse(),
      edges: [...definition.edges].reverse(),
    })).toEqual([["task"], ["alpha", "beta"], ["result"]]);
  });

  it("requires one input, one output, and at least one agent", () => {
    const definition = graph(
      [
        { id: "task-a", type: "input", name: "A", position: { x: 0, y: 0 } },
        { id: "task-b", type: "input", name: "B", position: { x: 0, y: 0 } },
      ],
      [],
    );
    expect(codes(definition)).toEqual(expect.arrayContaining([
      "input_count",
      "agent_count",
      "output_count",
    ]));
  });

  it("enforces node/edge caps and valid agent configuration", () => {
    const definition = diamond();
    definition.nodes = Array.from({ length: PIPELINE_MAX_NODES + 1 }, (_, index) =>
      agent(`agent-${index}`),
    );
    definition.edges = Array.from({ length: PIPELINE_MAX_EDGES + 1 }, (_, index) =>
      edge(`edge-${index}`, "agent-0", "agent-1", index),
    );
    expect(codes(definition)).toEqual(expect.arrayContaining(["node_limit", "edge_limit"]));

    const invalidAgent = diamond();
    const alpha = invalidAgent.nodes.find((node) => node.id === "alpha") as PipelineAgentNode;
    alpha.retryCount = 4;
    alpha.color = "";
    expect(codes(invalidAgent)).toContain("invalid_agent");
  });

  it("rejects duplicate ids, missing endpoints, self edges, and duplicate connections", () => {
    const definition = diamond();
    definition.nodes.push({ ...agent("alpha"), name: "Duplicate Alpha" });
    definition.edges.push(
      edge("task-alpha", "missing", "alpha", 3),
      edge("self", "beta", "beta", 4),
      edge("duplicate", "task", "alpha", 5),
    );
    expect(codes(definition)).toEqual(expect.arrayContaining([
      "duplicate_node_id",
      "duplicate_edge_id",
      "missing_edge_endpoint",
      "self_edge",
      "duplicate_connection",
    ]));
  });

  it("rejects cycles and nodes outside the input-to-output path", () => {
    const cyclic = graph(
      [
        { id: "task", type: "input", name: "Task", position: { x: 0, y: 0 } },
        agent("alpha"),
        agent("beta"),
        { id: "result", type: "output", name: "Result", position: { x: 300, y: 0 } },
      ],
      [
        edge("one", "task", "alpha"),
        edge("two", "alpha", "beta"),
        edge("three", "beta", "alpha"),
        edge("four", "beta", "result"),
      ],
    );
    expect(buildTopologicalLayers(cyclic)).toBeNull();
    expect(codes(cyclic)).toContain("cycle");

    const disconnected = graph(
      [
        { id: "task", type: "input", name: "Task", position: { x: 0, y: 0 } },
        agent("main"),
        agent("orphan"),
        { id: "result", type: "output", name: "Result", position: { x: 300, y: 0 } },
      ],
      [edge("one", "task", "main"), edge("two", "main", "result")],
    );
    const validation = validatePipelineGraph(disconnected);
    expect(validation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unreachable_from_input", nodeId: "orphan" }),
      expect.objectContaining({ code: "cannot_reach_output", nodeId: "orphan" }),
    ]));
  });
});

describe("pipeline connection helpers", () => {
  it("checks endpoint semantics, duplicates, and cycles without mutation", () => {
    const definition = graph(
      [
        { id: "task", type: "input", name: "Task", position: { x: 0, y: 0 } },
        agent("alpha"),
        agent("beta"),
        { id: "result", type: "output", name: "Result", position: { x: 300, y: 0 } },
      ],
      [
        edge("one", "task", "alpha"),
        edge("two", "alpha", "beta"),
        edge("three", "beta", "result"),
      ],
    );

    expect(validatePipelineConnection(definition, "missing", "alpha").issue?.code)
      .toBe("missing_edge_endpoint");
    expect(validatePipelineConnection(definition, "alpha", "alpha").issue?.code)
      .toBe("self_edge");
    expect(validatePipelineConnection(definition, "result", "alpha").issue?.code)
      .toBe("invalid_connection");
    expect(validatePipelineConnection(definition, "alpha", "task").issue?.code)
      .toBe("invalid_connection");
    expect(validatePipelineConnection(definition, "task", "result").issue?.code)
      .toBe("invalid_connection");
    expect(validatePipelineConnection(definition, "task", "alpha").issue?.code)
      .toBe("duplicate_connection");
    expect(wouldCreateCycle(definition, "beta", "alpha")).toBe(true);
    expect(validatePipelineConnection(definition, "beta", "alpha").issue?.code).toBe("cycle");
  });

  it("accepts a safe connection and orders join inputs deterministically", () => {
    const definition = diamond();
    expect(validatePipelineConnection(definition, "alpha", "beta")).toEqual({
      valid: true,
      issue: null,
    });
    expect(wouldCreateCycle(definition, "alpha", "beta")).toBe(false);
    expect(orderedIncomingEdges(definition, "result").map((entry) => entry.id)).toEqual([
      "alpha-result",
      "beta-result",
    ]);
  });
});
