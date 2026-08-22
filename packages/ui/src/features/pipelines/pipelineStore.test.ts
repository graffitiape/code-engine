import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addPipelineTask,
  createPipeline,
  initializePipelines,
  patchPipelineTaskRun,
  setPipelineRun,
  updatePipelineTask,
  usePipelineState,
} from "./pipelineStore";
import type { PipelineRun } from "./types";

const values = new Map<string, string>();

beforeEach(() => {
  vi.restoreAllMocks();
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
  initializePipelines(null);
  initializePipelines("/project");
});

describe("pipeline task editing", () => {
  it("trims and persists editable fields while preserving run metadata", () => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Original", "Original brief", state.pipelines[0].id)!;
    patchPipelineTaskRun(taskId, {
      runCount: 2,
      lastRunId: "run-2",
      lastRunStatus: "completed",
      lastRunAt: 50,
      lastOutput: "done",
    });
    const original = { ...state.tasks[0] };
    createPipeline();
    const secondPipeline = state.pipelines[1];
    vi.spyOn(Date, "now").mockReturnValue(original.updatedAt + 1);

    expect(updatePipelineTask(taskId, {
      title: "  Edited title  ",
      description: "  Edited brief  ",
      pipelineId: secondPipeline.id,
    })).toBe(true);

    expect(state.tasks[0]).toMatchObject({
      id: taskId,
      title: "Edited title",
      description: "Edited brief",
      pipelineId: secondPipeline.id,
      createdAt: original.createdAt,
      runCount: 2,
      lastRunId: "run-2",
      lastRunStatus: "completed",
      lastRunAt: 50,
      lastOutput: "done",
    });
    expect(state.tasks[0].updatedAt).toBe(original.updatedAt + 1);
    const persisted = JSON.parse(values.get("ce.pipeline-tasks.v1:/project") ?? "null");
    expect(persisted.tasks[0]).toMatchObject({ title: "Edited title", description: "Edited brief" });
  });

  it.each([
    ["empty title", { title: "  " }],
    ["empty description", { description: "  " }],
    ["missing pipeline", { pipelineId: "missing" }],
  ])("rejects %s", (_label, patch) => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Original", "Original brief", state.pipelines[0].id)!;

    expect(updatePipelineTask(taskId, patch)).toBe(false);
    expect(state.tasks[0]).toMatchObject({ title: "Original", description: "Original brief" });
    expect(state.error).not.toBeNull();
  });

  it("rejects an unknown task", () => {
    expect(updatePipelineTask("missing", { title: "Edited" })).toBe(false);
    expect(usePipelineState().error).toBe("The task could not be found.");
  });

  it("blocks editing while a run is active", () => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Original", "Original brief", state.pipelines[0].id)!;
    setPipelineRun(activeRun(taskId));

    expect(updatePipelineTask(taskId, { title: "Edited" })).toBe(false);
    expect(state.tasks[0].title).toBe("Original");
    expect(state.error).toBe("Stop the active run before editing a task.");
  });
});

function activeRun(taskId: string): PipelineRun {
  const pipeline = usePipelineState().pipelines[0];
  return {
    id: "active-run",
    pipelineId: pipeline.id,
    taskId,
    cwd: "/project",
    input: "Run the first task",
    attachments: [],
    definition: pipeline,
    status: "running",
    nodes: {},
    edges: {},
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    output: null,
    error: null,
  };
}

describe("pipeline task creation", () => {
  it("selects a newly created task when no run is active", () => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Next task", "Do the next thing", state.pipelines[0].id);

    expect(taskId).not.toBeNull();
    expect(state.selectedTaskId).toBe(taskId);
  });

  it("adds and persists a task while keeping the active task selected", () => {
    const state = usePipelineState();
    const runningTaskId = addPipelineTask(
      "Running task",
      "Keep this task visible",
      state.pipelines[0].id,
    )!;
    setPipelineRun(activeRun(runningTaskId));

    const queuedTaskId = addPipelineTask(
      "Queued task",
      "Run this after the active task",
      state.pipelines[0].id,
    );

    expect(queuedTaskId).not.toBeNull();
    expect(state.tasks.map((task) => task.id)).toEqual([queuedTaskId, runningTaskId]);
    expect(state.selectedTaskId).toBe(runningTaskId);

    const persisted = JSON.parse(values.get("ce.pipeline-tasks.v1:/project") ?? "null");
    expect(persisted.selectedId).toBe(runningTaskId);
    expect(persisted.tasks[0]).toMatchObject({
      id: queuedTaskId,
      title: "Queued task",
      description: "Run this after the active task",
    });
  });
});
