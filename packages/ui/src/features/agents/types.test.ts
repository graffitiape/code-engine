import { afterEach, describe, expect, it, vi } from "vitest";
import type { CodexThread } from "../../bridge/tauri";
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

  it("flattens turns and formats recent times", () => {
    const item = { id: "i", type: "agentMessage", text: "done" };
    const thread = { turns: [{ items: [item] }, { items: [] }] } as CodexThread;
    expect(flattenThreadItems(thread)).toEqual([item]);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00Z"));
    expect(formatRelativeTime(new Date("2026-08-03T11:55:00Z").getTime() / 1000)).toBe("5m");
  });
});
