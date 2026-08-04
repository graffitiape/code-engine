import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  eventObserver: null as ((event: unknown) => void) | null,
  statusObserver: null as ((status: unknown) => void) | null,
  threadRead: vi.fn(),
  turnInterrupt: vi.fn(),
  turnStart: vi.fn(),
}));

vi.mock("../../bridge/tauri", () => ({
  codexThreadNameSet: vi.fn().mockResolvedValue(undefined),
  codexThreadRead: runtime.threadRead,
  codexThreadStart: vi.fn().mockResolvedValue({ thread: { id: "thread-1" } }),
  codexTurnInterrupt: runtime.turnInterrupt,
  codexTurnStart: runtime.turnStart,
}));

vi.mock("../../stores/workspace", () => ({
  notifyWorkspaceFilesChanged: vi.fn(),
}));

vi.mock("../agents/agentStore", () => ({
  subscribeCodexEvents: (observer: (event: unknown) => void) => {
    runtime.eventObserver = observer;
    return () => { runtime.eventObserver = null; };
  },
  subscribeCodexStatus: (observer: (status: unknown) => void) => {
    runtime.statusObserver = observer;
    return () => { runtime.statusObserver = null; };
  },
  useAgentState: () => ({ server: { generation: 7 } }),
}));

import { executePipelineAgent } from "./codexRuntime";

const inProgressTurn = {
  id: "turn-1",
  status: "inProgress",
  items: [],
  error: null,
  startedAt: null,
  completedAt: null,
  durationMs: null,
};

beforeEach(() => {
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  runtime.eventObserver = null;
  runtime.statusObserver = null;
  runtime.threadRead.mockReset();
  runtime.turnInterrupt.mockReset().mockResolvedValue(undefined);
  runtime.turnStart.mockReset();
});

describe("Codex pipeline runtime reconciliation", () => {
  it("does not accept an unknown cached turn status as terminal", async () => {
    runtime.turnStart.mockImplementation(async () => {
      runtime.eventObserver?.({
        generation: 7,
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: { ...inProgressTurn, status: "futureStatus" },
        },
      });
      return { turn: inProgressTurn };
    });
    runtime.threadRead
      .mockResolvedValueOnce({ thread: { turns: [inProgressTurn] } })
      .mockResolvedValueOnce({
        thread: { turns: [{ ...inProgressTurn, status: "interrupted" }] },
      });

    await expect(executePipelineAgent({
      cwd: "/project",
      pipelineName: "Release",
      node: {
        id: "agent",
        type: "agent",
        name: "Agent",
        position: { x: 0, y: 0 },
        instructions: "Inspect the project.",
        model: "gpt-test",
        effort: "medium",
        permission: "read-only",
        retryCount: 0,
        color: "purple",
      },
      prompt: "Inspect",
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      signal: new AbortController().signal,
      onThreadStarted: () => undefined,
      onTurnStarted: () => undefined,
      onDelta: () => undefined,
    })).rejects.toThrow("invalid terminal turn status");

    expect(runtime.turnInterrupt).toHaveBeenCalledWith("thread-1", "turn-1");
    expect(runtime.threadRead).toHaveBeenCalledTimes(2);
  });

  it("fails closed when turn/start may have been sent but returns no turn id", async () => {
    runtime.turnStart.mockRejectedValue(new Error("turn/start timed out"));

    await expect(executePipelineAgent({
      cwd: "/project",
      pipelineName: "Release",
      node: {
        id: "agent",
        type: "agent",
        name: "Agent",
        position: { x: 0, y: 0 },
        instructions: "Inspect the project.",
        model: "gpt-test",
        effort: "medium",
        permission: "workspace-write",
        retryCount: 0,
        color: "purple",
      },
      prompt: "Inspect",
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      signal: new AbortController().signal,
      onThreadStarted: () => undefined,
      onTurnStarted: () => undefined,
      onDelta: () => undefined,
    })).rejects.toMatchObject({
      name: "PipelineTurnCleanupError",
      message: expect.stringContaining("did not confirm which turn was started"),
    });

    expect(runtime.turnInterrupt).not.toHaveBeenCalled();
    expect(runtime.threadRead).not.toHaveBeenCalled();
  });
});
