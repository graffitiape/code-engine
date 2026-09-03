import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexThread } from "../../bridge/tauri";
import { composePipelinePrompt } from "../pipelines/prompt";
import type { PipelinePromptInput } from "../pipelines/types";
import {
  flattenThreadItems,
  formatRelativeTime,
  permissionForThread,
  permissionForTurn,
  sourceLabel,
  textInput,
  threadTitle,
  userMessageText,
} from "./types";

afterEach(() => vi.useRealTimers());

describe("Codex task helpers", () => {
  it("maps each permission preset to the generated app-server shapes", () => {
    expect(permissionForThread("workspace-write")).toEqual({
      approvalPolicy: "on-request",
      sandbox: "workspace-write",
    });
    expect(permissionForThread("read-only")).toEqual({
      approvalPolicy: "never",
      sandbox: "read-only",
    });
    expect(permissionForTurn("read-only", "/project")).toEqual({
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    });
    expect(permissionForTurn("workspace-write", "/project").sandboxPolicy).toMatchObject({
      type: "workspaceWrite",
      writableRoots: ["/project"],
      networkAccess: false,
    });
    expect(permissionForTurn("full-access", "/project")).toEqual({
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" },
    });
  });

  it("builds text input and renders thread metadata without unsafe assumptions", () => {
    expect(textInput("Fix it")).toEqual({ type: "text", text: "Fix it", text_elements: [] });
    expect(threadTitle({ name: "  ", preview: "Task preview" } as CodexThread)).toBe(
      "Task preview",
    );
    expect(sourceLabel("appServer")).toBe("Code Engine");
    expect(
      userMessageText({
        id: "1",
        type: "userMessage",
        content: [textInput("hello"), { type: "localImage", path: "/tmp/image.png" }],
      }),
    ).toBe("hello\n/tmp/image.png");
  });

  it("displays a pipeline user message as its original task and keeps attachments", () => {
    const implement = {
      id: "implement",
      type: "agent" as const,
      name: "Implement",
      position: { x: 0, y: 0 },
      instructions: "Implement the task.",
      model: "gpt-test",
      effort: "high",
      permission: "workspace-write" as const,
      retryCount: 0,
      color: "#7aa2f7",
    };
    const prompt = composePipelinePrompt({
      definition: {
        schemaVersion: 1,
        id: "pipeline",
        name: "Development",
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          { id: "input", type: "input", name: "Task", position: { x: 0, y: 0 } },
          implement,
          { id: "output", type: "output", name: "Result", position: { x: 1, y: 0 } },
        ],
        edges: [
          {
            id: "input-implement",
            source: "input",
            target: "implement",
            order: 0,
            mode: "automatic",
            approvalMessage: "",
          },
          {
            id: "implement-output",
            source: "implement",
            target: "output",
            order: 0,
            mode: "automatic",
            approvalMessage: "",
          },
        ],
      },
      runId: "run-1",
      originalTask: "# Fix the feed\n\nShow the normal task text.",
      node: implement,
      globalInstructions: "Work as one pipeline stage.",
      upstreamHandoffs: [],
    } satisfies PipelinePromptInput);

    expect(userMessageText({
      id: "pipeline-message",
      type: "userMessage",
      content: [textInput(prompt), { type: "localImage", path: "/tmp/reference.png" }],
    })).toBe("# Fix the feed\n\nShow the normal task text.\n/tmp/reference.png");
    expect(userMessageText({
      id: "legacy-pipeline-message",
      type: "userMessage",
      text: prompt,
    })).toBe("# Fix the feed\n\nShow the normal task text.");
  });

  it("flattens turns and formats recent times", () => {
    const item = { id: "i", type: "agentMessage", text: "done" };
    const thread = { turns: [{ items: [item] }, { items: [] }] } as CodexThread;
    expect(flattenThreadItems(thread)).toEqual([item]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    expect(formatRelativeTime(new Date("2026-08-03T11:55:00Z").getTime() / 1000)).toBe("5m");
  });
});
