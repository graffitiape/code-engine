import { beforeEach, describe, expect, it } from "vitest";
import {
  createPipelineTask,
  loadPipelineTasks,
  savePipelineTasks,
} from "./pipelineTaskPersistence";

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

describe("pipeline task persistence", () => {
  it("round-trips reusable tasks and their latest run metadata", () => {
    const task = {
      ...createPipelineTask("Ship the queue", "Build reusable task runs", "pipeline-1"),
      runCount: 2,
      lastRunId: "run-2",
      lastRunStatus: "completed" as const,
      lastRunAt: 1234,
      lastOutput: "Done",
    };
    expect(savePipelineTasks("/project", [task], task.id)).toBe(true);
    expect(loadPipelineTasks("/project", new Set(["pipeline-1"]))).toEqual({
      schemaVersion: 1,
      selectedId: task.id,
      tasks: [task],
    });
  });

  it("drops tasks whose template no longer exists", () => {
    const task = createPipelineTask("Orphaned", "Old work", "removed-pipeline");
    savePipelineTasks("/project", [task], task.id);
    expect(loadPipelineTasks("/project", new Set(["pipeline-1"]))).toEqual({
      schemaVersion: 1,
      selectedId: null,
      tasks: [],
    });
  });
});
