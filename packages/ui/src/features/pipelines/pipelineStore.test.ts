import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addAgentNode,
  addPipelineTask,
  addSavedAgentNode,
  createPipeline,
  deleteNode,
  deletePipelineTask,
  deleteSavedAgent,
  initializePipelines,
  patchPipelineRunNode,
  patchPipelineTaskRun,
  selectPipelineRun,
  saveAgentNodeForReuse,
  setPipelineError,
  setPipelineRun,
  updateNode,
  updatePipelineTask,
  usePipelineState,
} from "./pipelineStore";
import type { CodexModel } from "../../bridge/tauri";
import type { PipelineRun } from "./types";
import { createPipelineRun } from "./pipelineRunner";

const values = new Map<string, string>();

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  values.clear();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: globalThis,
  });
  Object.defineProperty(globalThis, "confirm", {
    configurable: true,
    value: vi.fn(() => false),
  });
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
    ["missing pipeline", { pipelineId: "missing" }],
  ])("rejects %s", (_label, patch) => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Original", "Original brief", state.pipelines[0].id)!;

    expect(updatePipelineTask(taskId, patch)).toBe(false);
    expect(state.tasks[0]).toMatchObject({ title: "Original", description: "Original brief" });
    expect(state.error).not.toBeNull();
  });

  it("allows an existing brief to be cleared", () => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Original", "Original brief", state.pipelines[0].id)!;

    expect(updatePipelineTask(taskId, { description: "  " })).toBe(true);
    expect(state.tasks[0].description).toBe("");
    const persisted = JSON.parse(values.get("ce.pipeline-tasks.v1:/project") ?? "null");
    expect(persisted.tasks[0].description).toBe("");
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
  it("creates and persists a task without a brief", () => {
    const state = usePipelineState();
    const taskId = addPipelineTask("Title only", "  ", state.pipelines[0].id);

    expect(taskId).not.toBeNull();
    expect(state.tasks[0].description).toBe("");
    const persisted = JSON.parse(values.get("ce.pipeline-tasks.v1:/project") ?? "null");
    expect(persisted.tasks[0]).toMatchObject({ title: "Title only", description: "" });
  });

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

function model(
  name: string,
  efforts = ["medium", "high"],
  defaultEffort = efforts[0],
  isDefault = false,
): CodexModel {
  return {
    id: name,
    model: name,
    displayName: name,
    description: `${name} model`,
    hidden: false,
    supportedReasoningEfforts: efforts.map((reasoningEffort) => ({
      reasoningEffort,
      description: reasoningEffort,
    })),
    defaultReasoningEffort: defaultEffort,
    isDefault,
  };
}

describe("saved pipeline agents", () => {
  it("saves a full agent snapshot and inserts independent reusable copies", () => {
    const state = usePipelineState();
    const sourceId = addAgentNode("gpt-test", "high", { width: 900, height: 640 })!;
    updateNode(sourceId, {
      name: "Release writer",
      instructions: "Write concise release notes from the completed work.",
      permission: "read-only",
      retryCount: 2,
      color: "yellow",
    });

    const saved = saveAgentNodeForReuse(sourceId)!;
    expect(saved).toMatchObject({
      name: "Release writer",
      instructions: "Write concise release notes from the completed work.",
      model: "gpt-test",
      effort: "high",
      permission: "read-only",
      retryCount: 2,
      color: "yellow",
    });

    updateNode(sourceId, { instructions: "This node can now diverge." });
    expect(state.savedAgents[0].instructions).toBe(
      "Write concise release notes from the completed work.",
    );
    deleteNode(sourceId);

    const catalog = [model("gpt-test")];
    const firstId = addSavedAgentNode(saved.id, catalog, "gpt-test", { width: 900, height: 640 })!;
    const secondId = addSavedAgentNode(saved.id, catalog, "gpt-test", { width: 900, height: 640 })!;
    const copies = state.pipelines[0].nodes.filter(
      (node) => node.type === "agent" && (node.id === firstId || node.id === secondId),
    );

    expect(firstId).not.toBe(secondId);
    expect(copies.map((node) => node.name)).toEqual(["Release writer", "Release writer 2"]);
    expect(copies[0]).toMatchObject({
      instructions: saved.instructions,
      model: saved.model,
      effort: saved.effort,
      permission: saved.permission,
      retryCount: saved.retryCount,
      color: saved.color,
    });
    expect(copies[0].position).not.toEqual(copies[1].position);

    const persisted = JSON.parse(values.get("ce.pipelines.v1:/project") ?? "null");
    expect(persisted.pipelines[0].nodes.map((node: { id: string }) => node.id)).toEqual(
      expect.arrayContaining([firstId, secondId]),
    );
  });

  it("updates a same-named saved agent instead of creating duplicates", () => {
    const state = usePipelineState();
    const nodeId = addAgentNode("gpt-test", "medium")!;
    updateNode(nodeId, { name: "  Reviewer  ", instructions: "First version." });
    const first = saveAgentNodeForReuse(nodeId)!;

    updateNode(nodeId, { name: "reviewer", instructions: "Second version." });
    const updated = saveAgentNodeForReuse(nodeId)!;

    expect(updated.id).toBe(first.id);
    expect(state.savedAgents).toHaveLength(1);
    expect(state.savedAgents[0]).toMatchObject({ name: "reviewer", instructions: "Second version." });
  });

  it("merges with agents saved by another app instance before writing", () => {
    const state = usePipelineState();
    const nodeId = addAgentNode("gpt-test", "medium")!;
    updateNode(nodeId, { name: "Local agent", instructions: "First local version." });
    const local = saveAgentNodeForReuse(nodeId)!;
    const external = {
      ...local,
      id: "saved-agent:external",
      name: "External agent",
      instructions: "Saved in another instance.",
    };
    values.set("ce.pipeline-agent-library.v1", JSON.stringify({
      schemaVersion: 1,
      agents: [external, local],
    }));

    updateNode(nodeId, { instructions: "Updated local version." });
    expect(saveAgentNodeForReuse(nodeId)).not.toBeNull();

    expect(state.savedAgents.map((agent) => agent.name)).toEqual([
      "Local agent",
      "External agent",
    ]);
    const persisted = JSON.parse(values.get("ce.pipeline-agent-library.v1") ?? "null");
    expect(persisted.agents.map((agent: { name: string }) => agent.name)).toEqual([
      "Local agent",
      "External agent",
    ]);
  });

  it("resolves stale saved model settings against the live catalog", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = usePipelineState();
    const nodeId = addAgentNode("retired-model", "ultra")!;
    updateNode(nodeId, { name: "Compatibility agent", instructions: "Use supported settings." });
    const saved = saveAgentNodeForReuse(nodeId)!;
    deleteNode(nodeId);
    const catalog = [
      model("current-model", ["low", "medium"], "medium"),
      model("default-model", ["high"], "high", true),
    ];

    const addedId = addSavedAgentNode(saved.id, catalog, "current-model")!;
    const added = state.pipelines[0].nodes.find((node) => node.id === addedId)!;

    expect(added).toMatchObject({ model: "current-model", effort: "medium" });
  });

  it("falls back only the effort when the saved model is still available", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = usePipelineState();
    const nodeId = addAgentNode("gpt-test", "ultra")!;
    updateNode(nodeId, { name: "Effort fallback", instructions: "Keep the model." });
    const saved = saveAgentNodeForReuse(nodeId)!;
    deleteNode(nodeId);

    const addedId = addSavedAgentNode(
      saved.id,
      [model("gpt-test", ["low", "high"], "high")],
      "gpt-test",
    )!;
    const added = state.pipelines[0].nodes.find((node) => node.id === addedId)!;

    expect(added).toMatchObject({ model: "gpt-test", effort: "high" });
  });

  it("keeps a saved agent unchanged when replacement model settings are declined", () => {
    const state = usePipelineState();
    const nodeId = addAgentNode("retired-model", "ultra")!;
    updateNode(nodeId, { name: "Retired agent", instructions: "Keep the saved settings." });
    const saved = saveAgentNodeForReuse(nodeId)!;
    deleteNode(nodeId);

    expect(addSavedAgentNode(
      saved.id,
      [model("current-model", ["medium"], "medium", true)],
      "current-model",
    )).toBeNull();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining(
      "Add it with current-model / medium instead?",
    ));
    expect(state.pipelines[0].nodes.some((node) => node.type === "agent")).toBe(false);
  });

  it("keeps saved agents across projects and leaves inserted nodes after library deletion", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = usePipelineState();
    const nodeId = addAgentNode("gpt-test", "medium")!;
    updateNode(nodeId, { name: "Global agent", instructions: "Available everywhere." });
    const saved = saveAgentNodeForReuse(nodeId)!;

    initializePipelines("/other-project");
    expect(state.savedAgents.map((agent) => agent.id)).toContain(saved.id);
    const insertedId = addSavedAgentNode(saved.id, [model("gpt-test")], "gpt-test")!;

    expect(deleteSavedAgent(saved.id)).toBe(true);
    expect(state.savedAgents).toEqual([]);
    expect(state.pipelines[0].nodes.some((node) => node.id === insertedId)).toBe(true);
  });

  it("does not report an agent as saved when persistence fails", () => {
    const state = usePipelineState();
    const nodeId = addAgentNode("gpt-test", "medium")!;
    updateNode(nodeId, { name: "Unsaved agent", instructions: "Do not lose this." });
    const setItem = vi.spyOn(localStorage, "setItem").mockImplementation((key, value) => {
      if (key === "ce.pipeline-agent-library.v1") throw new Error("quota exceeded");
      values.set(key, value);
    });

    expect(saveAgentNodeForReuse(nodeId)).toBeNull();
    expect(state.savedAgents).toEqual([]);
    expect(state.error).toBe("The agent could not be saved in this webview.");
    setItem.mockRestore();
  });

  it("dismisses a template error without erasing the recorded run error", () => {
    const run = { ...activeRun("task-1"), status: "failed" as const, error: "Run failed." };
    setPipelineRun(run);
    setPipelineError("The agent could not be saved in this webview.");

    setPipelineError(null);

    expect(usePipelineState().error).toBeNull();
    expect(usePipelineState().run?.error).toBe("Run failed.");
  });
});

describe("pipeline run history integration", () => {
  it.each(["completed", "failed", "cancelled"] as const)(
    "restores multiple runs and the latest %s task status after reload",
    (status) => {
      const state = usePipelineState();
      const taskId = addPipelineTask("Persisted task", "", state.pipelines[0].id)!;
      const older = createPipelineRun(state.pipelines[0], "/project", "First", taskId);
      older.id = "run-older";
      older.status = "completed";
      older.createdAt = 10;
      older.updatedAt = 10;
      const latest = createPipelineRun(state.pipelines[0], "/project", "Second", taskId);
      latest.id = "run-latest";
      latest.status = status;
      latest.createdAt = 20;
      latest.updatedAt = 20;
      setPipelineRun(older);
      setPipelineRun(latest);
      patchPipelineTaskRun(taskId, {
        runCount: 2,
        lastRunId: latest.id,
        lastRunStatus: status,
        lastRunAt: 20,
      });

      initializePipelines(null);
      initializePipelines("/project");

      expect(state.tasks[0].lastRunStatus).toBe(status);
      expect(state.runs.map((run) => run.id)).toEqual(["run-latest", "run-older"]);
      expect(state.selectedRunId).toBe("run-latest");
      selectPipelineRun("run-older");
      expect(state.selectedRunId).toBe("run-older");
    },
  );

  it("deletes a task's complete persisted run history", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const state = usePipelineState();
    const taskId = addPipelineTask("Disposable task", "", state.pipelines[0].id)!;
    const run = createPipelineRun(state.pipelines[0], "/project", "Delete", taskId);
    run.status = "cancelled";
    setPipelineRun(run);
    setPipelineRun(null);

    deletePipelineTask(taskId);

    expect(state.tasks).toHaveLength(0);
    expect(state.runs).toHaveLength(0);
    const persisted = JSON.parse(values.get("ce.pipeline-runs.v1:/project") ?? "null");
    expect(persisted.runs).toEqual([]);
  });

  it("debounces streamed output persistence and flushes a terminal node patch", () => {
    vi.useFakeTimers();
    const setItem = vi.spyOn(localStorage, "setItem");
    const state = usePipelineState();
    const run = createPipelineRun(state.pipelines[0], "/project", "Stream", null);
    const nodeId = state.pipelines[0].nodes[0].id;
    setPipelineRun(run);
    setItem.mockClear();

    patchPipelineRunNode(nodeId, { output: "a", status: "running" }, run.id);
    patchPipelineRunNode(nodeId, { output: "ab", status: "running" }, run.id);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(179);
    expect(setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(setItem).toHaveBeenCalledTimes(1);

    setItem.mockClear();
    patchPipelineRunNode(nodeId, { status: "completed", completedAt: 50 }, run.id);
    expect(setItem).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});
