import { beforeEach, describe, expect, it, vi } from "vitest";
import { pipelineAgentPreset } from "./agentPresets";
import { createStarterPipeline } from "./pipelinePersistence";
import { createPipelineRun } from "./pipelineRunner";
import { loadPipelineRuns, savePipelineRuns } from "./pipelineRunPersistence";

const values = new Map<string, string>();

beforeEach(() => {
  values.clear();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  });
});

describe("pipeline run persistence", () => {
  it("round-trips complete history with immutable definitions and thread ids", () => {
    const definition = createStarterPipeline();
    const run = createPipelineRun(definition, "/project", "Build it", "task-1");
    const input = definition.nodes.find((node) => node.type === "input")!;
    run.status = "completed";
    run.completedAt = 20;
    run.output = "Done";
    run.nodes[input.id] = { ...run.nodes[input.id], status: "completed", threadId: "thread-1", output: "Build it" };

    expect(savePipelineRuns("/project", [run])).toBe(true);
    expect(loadPipelineRuns("/project").runs).toEqual([run]);
  });

  it("round-trips runs with Windows image attachment paths", () => {
    const run = createPipelineRun(
      createStarterPipeline(),
      "C:\\project",
      "Build it",
      "task-1",
      [{ id: "C:\\images\\design.png", path: "C:\\images\\design.png", name: "design.png" }],
    );
    run.status = "completed";

    expect(savePipelineRuns("C:\\project", [run])).toBe(true);
    expect(loadPipelineRuns("C:\\project").runs).toEqual([run]);
  });

  it("round-trips Git commit checkpoints and normalizes older node states", () => {
    const run = createPipelineRun(createStarterPipeline(), "/project", "Commit it", "task-1");
    const nodeId = Object.keys(run.nodes)[0];
    run.status = "failed";
    run.nodes[nodeId].integrationCommit = { shortId: "abc1234", summary: "fix: retry" };
    expect(savePipelineRuns("/project", [run])).toBe(true);
    expect(loadPipelineRuns("/project").runs[0].nodes[nodeId].integrationCommit).toEqual({
      shortId: "abc1234",
      summary: "fix: retry",
    });

    const legacy = JSON.parse(JSON.stringify(run));
    delete legacy.nodes[nodeId].integrationCommit;
    values.set("ce.pipeline-runs.v1:/project", JSON.stringify({ schemaVersion: 1, runs: [legacy] }));
    expect(loadPipelineRuns("/project").runs[0].nodes[nodeId].integrationCommit).toBeNull();
  });

  it("migrates untouched default instructions in historical retry snapshots", () => {
    const definition = createStarterPipeline();
    definition.nodes.splice(1, 0, {
      id: "implement",
      type: "agent",
      name: "Implement",
      position: { x: 620, y: 220 },
      instructions: "Implement the task completely in the active project. Use upstream research and plans as context, preserve existing work, follow project conventions, and run focused verification for the changes you make.",
      model: "gpt-test",
      effort: "medium",
      permission: "workspace-write",
      retryCount: 1,
      color: "purple",
    });
    const run = createPipelineRun(definition, "/project", "Build it", "task-1");
    run.status = "failed";
    savePipelineRuns("/project", [run]);

    const restored = loadPipelineRuns("/project").runs[0];
    const implement = restored.definition.nodes.find((node) => node.id === "implement")!;
    expect(implement.type).toBe("agent");
    if (implement.type !== "agent") throw new Error("Expected agent node");
    expect(implement.instructions).toBe(pipelineAgentPreset("implement").instructions);
    expect(implement.instructions).toContain("Do not run tests");
  });

  it("marks persisted active runs and unfinished stages as interrupted", () => {
    vi.spyOn(Date, "now").mockReturnValue(500);
    const run = createPipelineRun(createStarterPipeline(), "/project", "Build it", "task-1");
    run.status = "running";
    savePipelineRuns("/project", [run]);

    const restored = loadPipelineRuns("/project").runs[0];
    expect(restored).toMatchObject({ status: "failed", completedAt: 500 });
    expect(restored.error).toContain("interrupted");
    expect(Object.values(restored.nodes).every((node) => node.status === "failed")).toBe(true);
  });

  it("drops corrupt records without discarding valid runs", () => {
    const valid = createPipelineRun(createStarterPipeline(), "/project", "Valid", "task-1");
    valid.status = "completed";
    values.set("ce.pipeline-runs.v1:/project", JSON.stringify({ schemaVersion: 1, runs: [{ nope: true }, valid] }));

    expect(loadPipelineRuns("/project").runs).toHaveLength(1);
    expect(loadPipelineRuns("/project").runs[0].id).toBe(valid.id);
  });
});
