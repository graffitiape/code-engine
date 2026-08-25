import { describe, expect, it, vi } from "vitest";
import { createStarterPipeline } from "./pipelinePersistence";
import { createPipelineRun } from "./pipelineRunner";
import {
  openPipelineStageChat,
  pipelineStageHasChat,
  pipelineStageNeedsGitSetup,
  pipelineStagePresentation,
} from "./PipelineTaskRunMonitor";
import type { PipelineAgentNode } from "./types";

describe("pipeline stage chat availability", () => {
  const agent: PipelineAgentNode = {
    id: "agent",
    type: "agent",
    name: "Agent",
    position: { x: 0, y: 0 },
    instructions: "Work",
    model: "model",
    effort: "medium",
    permission: "read-only",
    retryCount: 0,
    color: "blue",
  };

  it.each(["starting", "running", "completed", "failed", "cancelled"] as const)(
    "makes a persisted %s stage chat available",
    (status) => {
      const run = createPipelineRun(createStarterPipeline(), "/project", "Task");
      const state = { ...run.nodes[Object.keys(run.nodes)[0]], nodeId: agent.id, status, threadId: "thread-1" };

      expect(pipelineStageHasChat(agent, state)).toBe(true);
    },
  );

  it("does not expose a stage without a persisted thread", () => {
    const run = createPipelineRun(createStarterPipeline(), "/project", "Task");
    const state = { ...run.nodes[Object.keys(run.nodes)[0]], nodeId: agent.id, status: "cancelled" as const };
    expect(pipelineStageHasChat(agent, state)).toBe(false);
  });

  it("opens a running stage chat with the exact persisted thread and project", () => {
    const onOpenAgentThread = vi.fn(async () => undefined);

    openPipelineStageChat("thread-running", "/project/root", onOpenAgentThread);

    expect(onOpenAgentThread).toHaveBeenCalledOnce();
    expect(onOpenAgentThread).toHaveBeenCalledWith("thread-running", "/project/root");
  });

  it("labels missing legacy stage snapshots as not recorded instead of idle", () => {
    expect(pipelineStagePresentation(undefined, "failed")).toEqual({
      status: "not-recorded",
      label: "Not recorded",
    });
  });

  it("keeps never-run stages idle", () => {
    expect(pipelineStagePresentation(undefined, null)).toEqual({
      status: "idle",
      label: "Idle",
    });
  });

  it("offers Git setup for a failed Git integration only", () => {
    const gitNode = {
      id: "git",
      type: "integration" as const,
      name: "Commit & push",
      position: { x: 0, y: 0 },
      provider: "git" as const,
      action: "commit-push" as const,
      commitMessage: "fix: task",
      stageAll: true,
      color: "orange" as const,
    };
    const run = createPipelineRun(createStarterPipeline(), "/project", "Task");
    const state = {
      ...run.nodes[Object.keys(run.nodes)[0]],
      nodeId: gitNode.id,
      status: "failed" as const,
      error: "git identity is not configured",
    };

    expect(pipelineStageNeedsGitSetup(gitNode, state)).toBe(true);
    expect(pipelineStageNeedsGitSetup(gitNode, { ...state, status: "completed" })).toBe(false);
    expect(pipelineStageNeedsGitSetup(agent, state)).toBe(false);
  });
});
