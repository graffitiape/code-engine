import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  threadRead: vi.fn(),
  threadResume: vi.fn(),
}));

vi.mock("../../bridge/tauri", () => ({
  codexAccountRateLimits: vi.fn().mockResolvedValue(null),
  codexAccountRead: vi.fn().mockResolvedValue({ account: { type: "chatgpt" } }),
  codexModelList: vi.fn().mockResolvedValue({ data: [] }),
  codexPendingServerRequests: vi.fn().mockResolvedValue([]),
  codexServerStart: vi.fn(),
  codexServerStatus: vi.fn().mockResolvedValue({ state: "running", ready: true }),
  codexThreadList: vi.fn().mockResolvedValue({ data: [], nextCursor: null }),
  codexThreadRead: bridge.threadRead,
  codexThreadResume: bridge.threadResume,
}));

vi.mock("../../stores/workspace", () => ({
  notifyWorkspaceFilesChanged: vi.fn(),
}));

import { initializeAgents, openAgentThread, useAgentState } from "./agentStore";

const thread = (id = "thread-1", cwd = "/project") => ({
  id,
  preview: "Pipeline chat",
  cwd,
  source: "appServer",
  status: { type: "idle" },
  name: null,
  modelProvider: "openai",
  createdAt: 1,
  updatedAt: 2,
  cliVersion: "test",
  turns: [],
});

describe("openAgentThread", () => {
  beforeEach(async () => {
    bridge.threadRead.mockReset();
    bridge.threadResume.mockReset();
    await initializeAgents("/project");
  });

  it("resumes, selects, and inserts a pipeline thread missing from the rail", async () => {
    bridge.threadResume.mockResolvedValue({ thread: thread() });

    await expect(openAgentThread("thread-1", "/project")).resolves.toBe(true);

    expect(bridge.threadResume).toHaveBeenCalledWith({ threadId: "thread-1", cwd: "/project" });
    expect(useAgentState().selectedThreadId).toBe("thread-1");
    expect(useAgentState().threads.map((entry) => entry.id)).toContain("thread-1");
    expect(useAgentState().error).toBeNull();
  });

  it("falls back to reading when resume fails", async () => {
    bridge.threadResume.mockRejectedValue(new Error("resume unavailable"));
    bridge.threadRead.mockResolvedValue({ thread: thread() });

    await expect(openAgentThread("thread-1", "/project")).resolves.toBe(true);

    expect(bridge.threadRead).toHaveBeenCalledWith("thread-1", true);
    expect(useAgentState().selectedThread?.id).toBe("thread-1");
  });

  it.each([
    ["a different thread", thread("thread-2")],
    ["a different project", thread("thread-1", "/other")],
  ])("rejects %s returned by the runtime", async (_label, returnedThread) => {
    bridge.threadResume.mockResolvedValue({ thread: returnedThread });

    await expect(openAgentThread("thread-1", "/project")).resolves.toBe(false);

    expect(useAgentState().selectedThreadId).toBeNull();
    expect(useAgentState().error).toBe("This chat does not belong to the current project.");
  });

  it("keeps a failed redirect visible in the Agents error state", async () => {
    bridge.threadResume.mockRejectedValue(new Error("resume failed"));
    bridge.threadRead.mockRejectedValue(new Error("read failed"));

    await expect(openAgentThread("thread-1", "/project")).resolves.toBe(false);

    expect(useAgentState().selectedThreadId).toBeNull();
    expect(useAgentState().loadingThread).toBe(false);
    expect(useAgentState().error).toBe("read failed");
  });
});
