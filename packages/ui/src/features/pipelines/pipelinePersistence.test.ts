import { beforeEach, describe, expect, it } from "vitest";
import {
  createStarterPipeline,
  loadPipelines,
  newPipelineId,
  savePipelines,
} from "./pipelinePersistence";
import { pipelineAgentPreset } from "./agentPresets";
import type { PipelineDefinition } from "./types";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

function addAgentStep(pipeline: PipelineDefinition) {
  const input = pipeline.nodes.find((node) => node.type === "input")!;
  const output = pipeline.nodes.find((node) => node.type === "output")!;
  const agent = {
    id: newPipelineId("node"),
    type: "agent" as const,
    name: "Builder",
    position: { x: 620, y: 220 },
    instructions: "Implement the task.",
    model: "gpt-test",
    effort: "medium",
    permission: "workspace-write" as const,
    retryCount: 1,
    color: "purple",
  };
  pipeline.nodes.splice(1, 0, agent);
  pipeline.edges = [
    {
      id: newPipelineId("edge"),
      source: input.id,
      target: agent.id,
      order: 0,
      mode: "automatic",
      approvalMessage: "",
    },
    {
      id: newPipelineId("edge"),
      source: agent.id,
      target: output.id,
      order: 0,
      mode: "automatic",
      approvalMessage: "",
    },
  ];
}

describe("pipeline persistence", () => {
  it("creates an empty pipeline with only its terminal nodes", () => {
    const pipeline = createStarterPipeline("Empty pipeline");

    expect(pipeline.nodes.map(({ type, name }) => ({ type, name }))).toEqual([
      { type: "input", name: "Task Input" },
      { type: "output", name: "Result" },
    ]);
    expect(pipeline.edges).toEqual([]);
  });

  it("round-trips approval connections with their reviewer message", () => {
    const pipeline = createStarterPipeline("Guarded pipeline");
    addAgentStep(pipeline);
    const approval = pipeline.edges.at(-1)!;
    approval.mode = "approval";
    approval.approvalMessage = "Check the implementation and tests before continuing.";

    expect(savePipelines("/project", [pipeline], pipeline.id)).toBe(true);
    const loaded = loadPipelines("/project", createStarterPipeline());
    expect(loaded.pipelines[0].edges.find((edge) => edge.id === approval.id)).toMatchObject({
      mode: "approval",
      approvalMessage: "Check the implementation and tests before continuing.",
    });
  });

  it("loads legacy connections as automatic handoffs", () => {
    const pipeline = createStarterPipeline("Legacy pipeline");
    addAgentStep(pipeline);
    const legacy = JSON.parse(JSON.stringify(pipeline)) as Record<string, unknown>;
    for (const edge of legacy.edges as Array<Record<string, unknown>>) {
      delete edge.mode;
      delete edge.approvalMessage;
    }
    values.set("ce.pipelines.v1:/legacy", JSON.stringify({
      schemaVersion: 1,
      selectedId: pipeline.id,
      pipelines: [legacy],
    }));
    const loaded = loadPipelines("/legacy", createStarterPipeline());
    expect(loaded.pipelines[0].edges.every(
      (edge) => edge.mode === "automatic" && edge.approvalMessage === "",
    )).toBe(true);
  });

  it("loads saved default agents with non-overlapping current instructions", () => {
    const pipeline = createStarterPipeline("Legacy agents");
    addAgentStep(pipeline);
    const agent = pipeline.nodes.find((node) => node.type === "agent")!;
    agent.name = "Implement";
    agent.instructions = "Implement the task completely in the active project. Use upstream research and plans as context, preserve existing work, follow project conventions, and run focused verification for the changes you make.";

    savePipelines("/legacy-agents", [pipeline], pipeline.id);
    const loaded = loadPipelines(
      "/legacy-agents",
      createStarterPipeline(),
    ).pipelines[0].nodes.find((node) => node.type === "agent")!;

    expect(loaded.instructions).toBe(pipelineAgentPreset("implement").instructions);
    expect(loaded.instructions).toContain("Do not run tests");
  });

  it("migrates a simple legacy approval node into an approval connection", () => {
    const pipeline = createStarterPipeline("Legacy approval");
    addAgentStep(pipeline);
    const output = pipeline.nodes.find((node) => node.type === "output")!;
    const previous = pipeline.edges.find((edge) => edge.target === output.id)!;
    pipeline.nodes.splice(-1, 0, {
      id: "legacy-approval",
      type: "approval",
      name: "Release approval",
      position: { x: 1050, y: 220 },
      message: "Approve the release handoff.",
      color: "orange",
    });
    pipeline.edges = [
      ...pipeline.edges.filter((edge) => edge.id !== previous.id),
      { ...previous, id: "into-approval", target: "legacy-approval" },
      { ...previous, id: "out-of-approval", source: "legacy-approval" },
    ];

    savePipelines("/legacy-approval", [pipeline], pipeline.id);
    const loaded = loadPipelines("/legacy-approval", createStarterPipeline()).pipelines[0];
    expect(loaded.nodes.some((node) => node.type === "approval")).toBe(false);
    expect(loaded.edges).toContainEqual(expect.objectContaining({
      source: previous.source,
      target: output.id,
      mode: "approval",
      approvalMessage: "Approve the release handoff.",
    }));
  });
});
