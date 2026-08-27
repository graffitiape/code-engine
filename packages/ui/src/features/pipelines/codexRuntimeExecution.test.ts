import { beforeEach, describe, expect, it, vi } from "vitest";

const runtime = vi.hoisted(() => ({
  eventObserver: null as ((event: unknown) => void) | null,
  statusObserver: null as ((status: unknown) => void) | null,
  threadRead: vi.fn(),
  threadStart: vi.fn(),
  turnInterrupt: vi.fn(),
  turnStart: vi.fn(),
}));

vi.mock("../../bridge/tauri", () => ({
  codexThreadNameSet: vi.fn().mockResolvedValue(undefined),
  codexThreadRead: runtime.threadRead,
  codexThreadStart: runtime.threadStart,
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
  runtime.threadStart.mockReset().mockResolvedValue({ thread: { id: "thread-1" } });
  runtime.turnInterrupt.mockReset().mockResolvedValue(undefined);
  runtime.turnStart.mockReset();
});

describe("Codex pipeline runtime reconciliation", () => {
  it("waits for streamed completion instead of trusting an early interrupted snapshot", async () => {
    const completedTurn = {
      ...inProgressTurn,
      status: "completed",
      items: [{ id: "message-1", type: "agentMessage", text: "Research complete" }],
    };
    runtime.threadRead.mockResolvedValue({
      thread: { turns: [{ ...inProgressTurn, status: "interrupted" }] },
    });
    runtime.turnStart.mockImplementation(async () => {
      window.setTimeout(() => {
        runtime.eventObserver?.({
          generation: 7,
          method: "turn/completed",
          params: { threadId: "thread-1", turn: completedTurn },
        });
      }, 0);
      return { turn: inProgressTurn };
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
      globalInstructions: "Work as one pipeline stage and do not repeat other stages.",
      attachments: [{ id: "/tmp/design.png", path: "/tmp/design.png", name: "design.png" }],
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      signal: new AbortController().signal,
      onThreadStarted: () => undefined,
      onTurnStarted: () => undefined,
      onDelta: () => undefined,
    })).resolves.toMatchObject({
      threadId: "thread-1",
      turnId: "turn-1",
      output: "Research complete",
    });

    expect(runtime.threadRead).not.toHaveBeenCalled();
    expect(runtime.turnInterrupt).not.toHaveBeenCalled();
    expect(runtime.threadStart).toHaveBeenCalledWith(expect.objectContaining({
      developerInstructions: [
        "Global pipeline instructions:",
        "Work as one pipeline stage and do not repeat other stages.",
        "",
        "Current stage instructions:",
        "Inspect the project.",
      ].join("\n"),
    }));
    expect(runtime.turnStart).toHaveBeenCalledWith(expect.objectContaining({
      input: [
        { type: "text", text: "Inspect", text_elements: [] },
        { type: "localImage", path: "/tmp/design.png" },
      ],
    }));
  });

  it("hydrates final output only after receiving a completed event", async () => {
    runtime.turnStart.mockImplementation(async () => {
      window.setTimeout(() => {
        runtime.eventObserver?.({
          generation: 7,
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: { ...inProgressTurn, status: "completed" },
          },
        });
      }, 0);
      return { turn: inProgressTurn };
    });
    runtime.threadRead.mockResolvedValue({
      thread: {
        turns: [{
          ...inProgressTurn,
          status: "completed",
          items: [{ id: "message-1", type: "agentMessage", text: "Hydrated response" }],
        }],
      },
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
      attachments: [],
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      signal: new AbortController().signal,
      onThreadStarted: () => undefined,
      onTurnStarted: () => undefined,
      onDelta: () => undefined,
    })).resolves.toMatchObject({ output: "Hydrated response" });

    expect(runtime.threadRead).toHaveBeenCalledTimes(1);
    expect(runtime.turnInterrupt).not.toHaveBeenCalled();
  });

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
      attachments: [],
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
      attachments: [],
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
