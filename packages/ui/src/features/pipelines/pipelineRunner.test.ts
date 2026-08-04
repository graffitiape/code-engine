import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineDefinition, PipelineNodeRunState } from "./types";

const runtime = vi.hoisted(() => ({
  activeReaders: 0,
  maxReaders: 0,
  writerOverlap: false,
  calls: [] as string[],
  prompts: [] as string[],
  attempts: new Map<string, number>(),
  failFirstFor: new Set<string>(),
  alwaysFailFor: new Set<string>(),
  cleanupOnAbortFor: new Set<string>(),
}));

vi.mock("../agents/agentStore", () => ({
  useAgentState: () => ({ server: { generation: 7 } }),
}));

vi.mock("./codexRuntime", () => {
  class PipelineTurnCleanupError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "PipelineTurnCleanupError";
    }
  }
  return {
    PipelineTurnCleanupError,
    executePipelineAgent: async (request: {
    node: { id: string; name: string; permission: string };
    prompt: string;
    onThreadStarted: (id: string) => void;
    onTurnStarted: (threadId: string, turnId: string) => void;
    onDelta: (delta: string) => void;
    signal: AbortSignal;
    }) => {
    const count = (runtime.attempts.get(request.node.id) ?? 0) + 1;
    runtime.attempts.set(request.node.id, count);
    runtime.calls.push(request.node.id);
    runtime.prompts.push(request.prompt);
    request.onThreadStarted(`thread-${request.node.id}-${count}`);
    request.onTurnStarted(`thread-${request.node.id}-${count}`, `turn-${count}`);
    request.onDelta("working");
    if (runtime.failFirstFor.has(request.node.id) && count === 1) throw new Error("retry me");
    if (runtime.alwaysFailFor.has(request.node.id)) throw new Error("branch failed");
    if (request.node.permission === "read-only") {
      runtime.activeReaders += 1;
      runtime.maxReaders = Math.max(runtime.maxReaders, runtime.activeReaders);
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 5);
          const abort = () => {
            clearTimeout(timer);
            reject(runtime.cleanupOnAbortFor.has(request.node.id)
              ? new PipelineTurnCleanupError("cleanup failed")
              : new DOMException("peer failed", "AbortError"));
          };
          if (request.signal.aborted) abort();
          else request.signal.addEventListener("abort", abort, { once: true });
        });
      } finally {
        runtime.activeReaders -= 1;
      }
    } else {
      runtime.writerOverlap ||= runtime.activeReaders > 0;
    }
    return {
      threadId: `thread-${request.node.id}-${count}`,
      turnId: `turn-${count}`,
      items: [],
      output: `result from ${request.node.name}`,
    };
    },
  };
});

import { createPipelineRun, executePipelineRun } from "./pipelineRunner";

function graph(retryCount = 0): PipelineDefinition {
  const baseAgent = {
    type: "agent" as const,
    instructions: "Do the assigned stage completely.",
    model: "gpt-test",
    effort: "medium",
    retryCount,
    color: "purple",
  };
  return {
    schemaVersion: 1,
    id: "pipeline",
    name: "Parallel build",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "input", type: "input", name: "Task", position: { x: 0, y: 0 } },
      { ...baseAgent, id: "reader-a", name: "Reader A", permission: "read-only", position: { x: 1, y: 0 } },
      { ...baseAgent, id: "reader-b", name: "Reader B", permission: "read-only", position: { x: 1, y: 1 } },
      { ...baseAgent, id: "writer", name: "Writer", permission: "workspace-write", position: { x: 1, y: 2 } },
      { id: "output", type: "output", name: "Result", position: { x: 2, y: 0 } },
    ],
    edges: [
      { id: "i-a", source: "input", target: "reader-a", order: 0 },
      { id: "i-b", source: "input", target: "reader-b", order: 1 },
      { id: "i-w", source: "input", target: "writer", order: 2 },
      { id: "a-o", source: "reader-a", target: "output", order: 0 },
      { id: "b-o", source: "reader-b", target: "output", order: 1 },
      { id: "w-o", source: "writer", target: "output", order: 2 },
    ],
  };
}

beforeEach(() => {
  runtime.activeReaders = 0;
  runtime.maxReaders = 0;
  runtime.writerOverlap = false;
  runtime.calls = [];
  runtime.prompts = [];
  runtime.attempts.clear();
  runtime.failFirstFor.clear();
  runtime.alwaysFailFor.clear();
  runtime.cleanupOnAbortFor.clear();
});

describe("pipeline runner", () => {
  it("runs read-only siblings concurrently and writers exclusively", async () => {
    const definition = graph();
    const run = createPipelineRun(definition, "/project", "Build the feature");
    const states: Record<string, Partial<PipelineNodeRunState>> = {};
    const controller = new AbortController();
    const output = await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: (id, patch) => { states[id] = { ...states[id], ...patch }; },
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.maxReaders).toBe(2);
    expect(runtime.writerOverlap).toBe(false);
    expect(runtime.calls.at(-1)).toBe("writer");
    expect(states.output?.status).toBe("completed");
    expect(output).toContain("result from Reader A");
    expect(output).toContain("result from Writer");
    expect(runtime.prompts.every((prompt) => prompt.includes("Build the feature"))).toBe(true);
  });

  it("retries a failed agent up to its configured limit", async () => {
    const definition = graph(1);
    runtime.failFirstFor.add("reader-a");
    const run = createPipelineRun(definition, "/project", "Retry safely");
    const controller = new AbortController();
    await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });
    expect(runtime.attempts.get("reader-a")).toBe(2);
  });

  it("preserves the real branch failure after earlier siblings abort", async () => {
    const run = createPipelineRun(graph(), "/project", "Fail accurately");
    const controller = new AbortController();
    runtime.failFirstFor.add("reader-b");
    await expect(executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    })).rejects.toThrow("retry me");
  });

  it("prioritizes unsafe cleanup failures and never retries them", async () => {
    const run = createPipelineRun(graph(2), "/project", "Fail safely");
    const controller = new AbortController();
    runtime.alwaysFailFor.add("reader-a");
    runtime.cleanupOnAbortFor.add("reader-b");
    await expect(executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    })).rejects.toMatchObject({
      name: "PipelineTurnCleanupError",
      message: "cleanup failed",
    });
    expect(runtime.attempts.get("reader-a")).toBe(3);
    expect(runtime.attempts.get("reader-b")).toBe(1);
  });

  it("captures an immutable definition snapshot", () => {
    const definition = graph();
    const run = createPipelineRun(definition, "/project", "Snapshot this");
    definition.nodes[1].name = "Changed later";
    definition.edges.length = 0;
    expect(run.definition.nodes[1].name).toBe("Reader A");
    expect(run.definition.edges).toHaveLength(6);
  });
});
