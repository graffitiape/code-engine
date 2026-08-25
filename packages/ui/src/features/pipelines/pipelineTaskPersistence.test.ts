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

  it("round-trips a title-only task", () => {
    const task = createPipelineTask("Title only", "  ", "pipeline-1");
    expect(task.description).toBe("");
    expect(savePipelineTasks("/project", [task], task.id)).toBe(true);
    expect(loadPipelineTasks("/project", new Set(["pipeline-1"])).tasks).toEqual([task]);
  });

  it("loads an existing v1 task with an empty description", () => {
    const task = createPipelineTask("Persisted title", "Brief", "pipeline-1");
    values.set("ce.pipeline-tasks.v1:/project", JSON.stringify({
      schemaVersion: 1,
      selectedId: task.id,
      tasks: [{ ...task, description: "" }],
    }));

    expect(loadPipelineTasks("/project", new Set(["pipeline-1"])).tasks).toEqual([
      { ...task, description: "" },
    ]);
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

  it("loads old tasks without attachments and discards invalid image records", () => {
    const task = createPipelineTask("Attach designs", "Use the supplied mockups", "pipeline-1");
    values.set("ce.pipeline-tasks.v1:/project", JSON.stringify({
      schemaVersion: 1,
      selectedId: task.id,
      tasks: [
        { ...task, attachments: undefined },
        {
          ...task,
          id: "task-with-images",
          attachments: [
            { id: "ignored", path: "/tmp/mockup.PNG", name: "wrong-name.png" },
            { path: "/tmp/mockup.PNG" },
            { path: "/tmp/readme.txt" },
            { nope: true },
          ],
        },
      ],
    }));

    const loaded = loadPipelineTasks("/project", new Set(["pipeline-1"]));
    expect(loaded.tasks[0].attachments).toEqual([]);
    expect(loaded.tasks[1].attachments).toEqual([
      { id: "/tmp/mockup.PNG", path: "/tmp/mockup.PNG", name: "mockup.PNG" },
    ]);
  });
});
