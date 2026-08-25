import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PipelineApprovalDecision,
  PipelineDefinition,
  PipelineEdge,
  PipelineEdgeRunState,
  PipelineNodeRunState,
  PipelineRunStatus,
} from "./types";

const runtime = vi.hoisted(() => ({
  activeReaders: 0,
  maxReaders: 0,
  writerOverlap: false,
  calls: [] as string[],
  completed: [] as string[],
  prompts: [] as string[],
  attempts: new Map<string, number>(),
  delays: new Map<string, number>(),
  failFirstFor: new Set<string>(),
  alwaysFailFor: new Set<string>(),
  cleanupOnAbortFor: new Set<string>(),
  gitCalls: [] as string[],
}));

vi.mock("../../bridge/tauri", () => ({
  gitStageAll: async () => {
    runtime.gitCalls.push("stage");
    return { branch: "feature/tasks", staged: [{ path: "feature.ts" }], unstaged: [], untracked: [] };
  },
  gitStatus: async () => {
    runtime.gitCalls.push("status");
    return { branch: "feature/tasks", staged: [], unstaged: [], untracked: [] };
  },
  gitCommit: async (_path: string, message: string) => {
    runtime.gitCalls.push(`commit:${message}`);
    return { shortId: "abc1234", summary: message };
  },
  gitPush: async () => {
    runtime.gitCalls.push("push");
    return "feature/tasks";
  },
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
          const timer = setTimeout(resolve, runtime.delays.get(request.node.id) ?? 5);
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
    runtime.completed.push(request.node.id);
    return {
      threadId: `thread-${request.node.id}-${count}`,
      turnId: `turn-${count}`,
      items: [],
      output: `result from ${request.node.name}`,
    };
    },
  };
});

import {
  createPipelineRetryRun,
  createPipelineRun,
  executePipelineRun,
  pipelineNodeCanRetry,
} from "./pipelineRunner";

function handoff(id: string, source: string, target: string, order = 0): PipelineEdge {
  return { id, source, target, order, mode: "automatic", approvalMessage: "" };
}

function promptPayload(prompt: string): {
  originalTask: string;
  stage: { nodeId: string; name: string; instructions: string };
  upstreamOutputs: Array<{
    nodeId: string;
    nodeName: string;
    edgeOrder: number;
    output: string;
  }>;
} {
  const start = prompt.indexOf("{");
  const end = prompt.lastIndexOf("}");
  return JSON.parse(prompt.slice(start, end + 1));
}

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
      handoff("i-a", "input", "reader-a", 0),
      handoff("i-b", "input", "reader-b", 1),
      handoff("i-w", "input", "writer", 2),
      handoff("a-o", "reader-a", "output", 0),
      handoff("b-o", "reader-b", "output", 1),
      handoff("w-o", "writer", "output", 2),
    ],
  };
}

function approvalGraph(): PipelineDefinition {
  return {
    schemaVersion: 1,
    id: "approval-pipeline",
    name: "Guarded build",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "input", type: "input", name: "Task", position: { x: 0, y: 0 } },
      {
        id: "builder",
        type: "agent",
        name: "Builder",
        position: { x: 1, y: 0 },
        instructions: "Implement the task.",
        model: "gpt-test",
        effort: "medium",
        permission: "workspace-write",
        retryCount: 0,
        color: "purple",
      },
      { id: "output", type: "output", name: "Result", position: { x: 2, y: 0 } },
    ],
    edges: [
      handoff("input-builder", "input", "builder"),
      {
        id: "builder-output",
        source: "builder",
        target: "output",
        order: 0,
        mode: "approval",
        approvalMessage: "Review the implementation before release.",
      },
    ],
  };
}

function dependencyDrivenGraph(joinSlowBranch = false): PipelineDefinition {
  const agent = (id: string, name: string, x: number, y: number) => ({
    id,
    type: "agent" as const,
    name,
    position: { x, y },
    instructions: "Complete this stage.",
    model: "gpt-test",
    effort: "medium",
    permission: "read-only" as const,
    retryCount: 0,
    color: "cyan",
  });
  return {
    schemaVersion: 1,
    id: "dependency-pipeline",
    name: "Dependency-driven execution",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "input", type: "input", name: "Task", position: { x: 0, y: 0 } },
      agent("fast", "Fast branch", 1, 0),
      agent("slow", "Slow branch", 1, 1),
      agent("dependent", "Dependent", 2, 0),
      { id: "output", type: "output", name: "Result", position: { x: 3, y: 0 } },
    ],
    edges: [
      handoff("input-fast", "input", "fast"),
      handoff("input-slow", "input", "slow"),
      handoff("fast-dependent", "fast", "dependent", 0),
      ...(joinSlowBranch ? [handoff("slow-dependent", "slow", "dependent", 1)] : []),
      handoff("dependent-output", "dependent", "output", 0),
      ...(!joinSlowBranch ? [handoff("slow-output", "slow", "output", 1)] : []),
    ],
  };
}

function researchImplementationGraph(): PipelineDefinition {
  return {
    schemaVersion: 1,
    id: "research-implementation-pipeline",
    name: "Research then implement",
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes: [
      { id: "input", type: "input", name: "Task", position: { x: 0, y: 0 } },
      {
        id: "research",
        type: "agent",
        name: "Research",
        position: { x: 1, y: 0 },
        instructions: "Research the requested change.",
        model: "gpt-test",
        effort: "medium",
        permission: "read-only",
        retryCount: 0,
        color: "cyan",
      },
      {
        id: "implement",
        type: "agent",
        name: "Implement",
        position: { x: 2, y: 0 },
        instructions: "Implement the researched change completely.",
        model: "gpt-test",
        effort: "medium",
        permission: "workspace-write",
        retryCount: 0,
        color: "purple",
      },
      { id: "output", type: "output", name: "Result", position: { x: 3, y: 0 } },
    ],
    edges: [
      handoff("input-research", "input", "research"),
      handoff("research-implement", "research", "implement"),
      handoff("implement-output", "implement", "output"),
    ],
  };
}

beforeEach(() => {
  runtime.activeReaders = 0;
  runtime.maxReaders = 0;
  runtime.writerOverlap = false;
  runtime.calls = [];
  runtime.completed = [];
  runtime.prompts = [];
  runtime.attempts.clear();
  runtime.delays.clear();
  runtime.failFirstFor.clear();
  runtime.alwaysFailFor.clear();
  runtime.cleanupOnAbortFor.clear();
  runtime.gitCalls = [];
});

describe("pipeline runner", () => {
  it("passes a research agent's output into the connected implement agent", async () => {
    const run = createPipelineRun(
      researchImplementationGraph(),
      "/project",
      "Add reusable pipeline handoffs",
    );
    const controller = new AbortController();

    await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    const implementPayload = runtime.prompts
      .map(promptPayload)
      .find((entry) => entry.stage.nodeId === "implement");
    expect(implementPayload).toEqual(expect.objectContaining({
      originalTask: "Add reusable pipeline handoffs",
      stage: {
        nodeId: "implement",
        name: "Implement",
        instructions: "Implement the researched change completely.",
      },
      upstreamOutputs: [{
        nodeId: "research",
        nodeName: "Research",
        edgeOrder: 0,
        output: "result from Research",
      }],
    }));
  });

  it("starts a downstream reader as soon as its own dependencies complete", async () => {
    runtime.delays.set("fast", 1);
    runtime.delays.set("slow", 30);
    runtime.delays.set("dependent", 1);
    const run = createPipelineRun(dependencyDrivenGraph(), "/project", "Run independently");
    const controller = new AbortController();

    await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.completed.indexOf("dependent")).toBeLessThan(
      runtime.completed.indexOf("slow"),
    );
  });

  it("waits for every fan-in dependency and merges their handoffs in wire order", async () => {
    runtime.delays.set("fast", 1);
    runtime.delays.set("slow", 15);
    const run = createPipelineRun(
      dependencyDrivenGraph(true),
      "/project",
      "Join both branches",
    );
    const controller = new AbortController();

    await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.completed.indexOf("dependent")).toBeGreaterThan(
      runtime.completed.indexOf("slow"),
    );
    const prompt = runtime.prompts.find((entry) => entry.includes('"nodeId": "dependent"'))!;
    expect(prompt.indexOf('"nodeName": "Fast branch"')).toBeLessThan(
      prompt.indexOf('"nodeName": "Slow branch"'),
    );
  });

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
        onEdgePatch: () => undefined,
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
        onEdgePatch: () => undefined,
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
        onEdgePatch: () => undefined,
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
        onEdgePatch: () => undefined,
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

  it("runs a Git integration as a deterministic commit and push step", async () => {
    const definition = graph();
    definition.nodes.splice(-1, 0, {
      id: "git",
      type: "integration",
      name: "Commit & push",
      position: { x: 2, y: 2 },
      provider: "git",
      action: "commit-push",
      stageAll: true,
      commitMessage: "feat: {{task}}",
      color: "orange",
    });
    definition.edges.push(
      handoff("w-g", "writer", "git"),
      handoff("g-o", "git", "output", 3),
    );
    const run = createPipelineRun(definition, "/project", "# Reusable tasks\n\nBuild the queue");
    const controller = new AbortController();
    const states: Record<string, Partial<PipelineNodeRunState>> = {};
    const output = await executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: (id, patch) => { states[id] = { ...states[id], ...patch }; },
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.gitCalls).toEqual([
      "stage",
      "commit:feat: Reusable tasks",
      "push",
      "status",
    ]);
    expect(states.git?.status).toBe("completed");
    expect(output).toContain("Pushed feature/tasks");
  });

  it("retries a failed Git step without rerunning completed Codex stages", async () => {
    const definition = graph();
    definition.nodes.splice(-1, 0, {
      id: "git",
      type: "integration",
      name: "Commit & push",
      position: { x: 2, y: 2 },
      provider: "git",
      action: "commit-push",
      stageAll: true,
      commitMessage: "fix: {{task}}",
      color: "orange",
    });
    definition.edges.push(handoff("w-g", "writer", "git"), handoff("g-o", "git", "output", 3));
    const failed = createPipelineRun(definition, "/project", "# Retry integration", "task-1");
    failed.status = "failed";
    for (const node of definition.nodes) {
      if (node.id === "git") {
        failed.nodes[node.id] = {
          ...failed.nodes[node.id],
          status: "failed",
          attempt: 1,
          error: "git identity is not configured",
        };
      } else if (node.type === "output") {
        failed.nodes[node.id] = { ...failed.nodes[node.id], status: "skipped" };
      } else {
        failed.nodes[node.id] = {
          ...failed.nodes[node.id],
          status: "completed",
          output: node.type === "input" ? failed.input : `saved ${node.name}`,
          threadId: node.type === "agent" ? `original-${node.id}` : null,
        };
      }
    }

    expect(pipelineNodeCanRetry(failed, "git")).toBe(true);
    const retry = createPipelineRetryRun(failed, "git");
    expect(retry.id).not.toBe(failed.id);
    expect(retry.nodes["reader-a"]).toMatchObject({
      status: "completed",
      output: "saved Reader A",
      threadId: "original-reader-a",
    });
    expect(retry.nodes.git).toMatchObject({ status: "pending", attempt: 1, threadId: null });
    expect(retry.nodes.output.status).toBe("pending");
    expect(failed.nodes.git.status).toBe("failed");

    const controller = new AbortController();
    const states: Record<string, Partial<PipelineNodeRunState>> = {};
    const output = await executePipelineRun(retry, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: (id, patch) => { states[id] = { ...states[id], ...patch }; },
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.calls).toEqual([]);
    expect(runtime.gitCalls).toEqual([
      "stage",
      "commit:fix: Retry integration",
      "push",
      "status",
    ]);
    expect(states.git).toMatchObject({ status: "completed", attempt: 2 });
    expect(output).toContain("saved Reader A");
    expect(output).toContain("Pushed feature/tasks");
  });

  it("resumes push from a persisted commit checkpoint without committing twice", async () => {
    const definition = graph();
    definition.nodes.splice(-1, 0, {
      id: "git",
      type: "integration",
      name: "Commit & push",
      position: { x: 2, y: 2 },
      provider: "git",
      action: "commit-push",
      stageAll: true,
      commitMessage: "fix: {{task}}",
      color: "orange",
    });
    definition.edges.push(handoff("w-g", "writer", "git"), handoff("g-o", "git", "output", 3));
    const failed = createPipelineRun(definition, "/project", "# Resume push", "task-1");
    failed.status = "failed";
    for (const node of definition.nodes) {
      if (node.id === "git") {
        failed.nodes[node.id] = {
          ...failed.nodes[node.id],
          status: "failed",
          attempt: 1,
          output: "Committed abc1234: fix: Resume push",
          error: "push failed",
          integrationCommit: { shortId: "abc1234", summary: "fix: Resume push" },
        };
      } else if (node.type === "output") {
        failed.nodes[node.id] = { ...failed.nodes[node.id], status: "skipped" };
      } else {
        failed.nodes[node.id] = {
          ...failed.nodes[node.id],
          status: "completed",
          output: node.type === "input" ? failed.input : `saved ${node.name}`,
        };
      }
    }

    const retry = createPipelineRetryRun(failed, "git");
    expect(retry.nodes.git.integrationCommit).toEqual({
      shortId: "abc1234",
      summary: "fix: Resume push",
    });
    const controller = new AbortController();
    const output = await executePipelineRun(retry, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: () => undefined,
        onEdgePatch: () => undefined,
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    expect(runtime.calls).toEqual([]);
    expect(runtime.gitCalls).toEqual(["push", "status"]);
    expect(output).toContain("Committed abc1234: fix: Resume push");
    expect(output).toContain("Pushed feature/tasks");
  });

  it("rejects retry requests for non-failed or terminal nodes", () => {
    const run = createPipelineRun(graph(), "/project", "Not retryable");
    run.status = "failed";
    run.nodes.output.status = "failed";

    expect(pipelineNodeCanRetry(run, "output")).toBe(false);
    expect(pipelineNodeCanRetry(run, "reader-a")).toBe(false);
    expect(() => createPipelineRetryRun(run, "output")).toThrow(
      "Only a failed executable step from a failed run can be retried.",
    );
  });

  it("pauses on an approval connection before starting its target", async () => {
    const definition = approvalGraph();
    const run = createPipelineRun(definition, "/project", "Ship safely");
    const controller = new AbortController();
    const states: Record<string, Partial<PipelineNodeRunState>> = {};
    const edgeStates: Record<string, Partial<PipelineEdgeRunState>> = {};
    const statuses: PipelineRunStatus[] = [];
    let decide: ((decision: PipelineApprovalDecision) => void) | undefined;
    const execution = executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      requestConnectionApproval: () => new Promise((resolve) => { decide = resolve; }),
      callbacks: {
        onRunStatus: (status) => { statuses.push(status); },
        onNodePatch: (id, patch) => { states[id] = { ...states[id], ...patch }; },
        onEdgePatch: (id, patch) => { edgeStates[id] = { ...edgeStates[id], ...patch }; },
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    });

    await vi.waitFor(() => expect(edgeStates["builder-output"]?.status).toBe("waitingForApproval"));
    expect(statuses.at(-1)).toBe("needsAttention");
    expect(states.output?.status).toBeUndefined();
    decide?.("approved");
    const output = await execution;

    expect(edgeStates["builder-output"]?.status).toBe("approved");
    expect(states.output?.status).toBe("completed");
    expect(output).toBe("result from Builder");
    expect(statuses.at(-1)).toBe("completed");
  });

  it("rejects an approval connection and never starts its target", async () => {
    const run = createPipelineRun(approvalGraph(), "/project", "Do not ship yet");
    const controller = new AbortController();
    const states: Record<string, Partial<PipelineNodeRunState>> = {};
    const edgeStates: Record<string, Partial<PipelineEdgeRunState>> = {};
    await expect(executePipelineRun(run, {
      signal: controller.signal,
      abortPeers: (reason) => controller.abort(reason),
      fallbackModel: "gpt-test",
      fallbackEffort: "medium",
      requestConnectionApproval: async () => "rejected",
      callbacks: {
        onRunStatus: () => undefined,
        onNodePatch: (id, patch) => { states[id] = { ...states[id], ...patch }; },
        onEdgePatch: (id, patch) => { edgeStates[id] = { ...edgeStates[id], ...patch }; },
        onThreadOwned: () => undefined,
        onTurnOwned: () => undefined,
        onAttemptSettled: () => undefined,
        onDelta: () => undefined,
      },
    })).rejects.toThrow("Approval rejected between Builder and Result.");
    expect(edgeStates["builder-output"]).toMatchObject({
      status: "rejected",
      error: "Approval rejected between Builder and Result.",
    });
    expect(states.output?.status).toBeUndefined();
  });
});
