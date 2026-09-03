import { beforeEach, describe, expect, it } from "vitest";
import {
  applyLspMessageEvent,
  applyLspStatusEvent,
  diagnosticCountsForPath,
  recordLspFailure,
  resetLspState,
  statusForServer,
  useLspStore,
} from "./store";
import type { LspMessageEvent, LspServerStatusEvent } from "./types";

const root = "/project";

function status(
  generation: number,
  state: LspServerStatusEvent["state"] = "running",
  statusRoot = root,
): LspServerStatusEvent {
  return {
    root: statusRoot,
    serverId: "typescript",
    label: "TypeScript",
    generation,
    state,
    executable: "/bin/typescript-language-server",
    error: state === "error" ? "crashed" : null,
  };
}

function diagnosticsEvent(
  generation: number,
  version: number,
  eventRoot = root,
): LspMessageEvent {
  return {
    root: eventRoot,
    serverId: "typescript",
    generation,
    message: {
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: "file:///project/src/app.ts",
        version,
        diagnostics: [
          {
            range: {
              start: { line: 1, character: 2 },
              end: { line: 1, character: 5 },
            },
            severity: 1,
            message: "Broken type",
          },
          {
            range: {
              start: { line: 3, character: 0 },
              end: { line: 3, character: 4 },
            },
            severity: 2,
            message: "Unused value",
          },
        ],
      },
    },
  };
}

describe("LSP reactive event store", () => {
  beforeEach(() => resetLspState(root));

  it("normalizes native state names", () => {
    expect(applyLspStatusEvent(status(3, "running"))).toBe(true);
    expect(statusForServer("typescript")?.state).toBe("starting");

    expect(applyLspStatusEvent(status(3, "error"))).toBe(true);
    expect(statusForServer("typescript")?.state).toBe("failed");
  });

  it("does not regress an initialized generation when a delayed native event arrives", () => {
    expect(applyLspStatusEvent(status(4, "ready"))).toBe(true);
    expect(applyLspStatusEvent(status(4, "running"))).toBe(false);
    expect(statusForServer("typescript")?.state).toBe("ready");
  });

  it("requires an exact current root and generation before accepting diagnostics", () => {
    expect(applyLspMessageEvent(diagnosticsEvent(7, 1))).toBe(false);
    applyLspStatusEvent(status(7));
    expect(applyLspMessageEvent(diagnosticsEvent(7, 1))).toBe(true);
    expect(diagnosticCountsForPath("/project/src/app.ts")).toEqual({ error: 1, warn: 1 });

    expect(applyLspMessageEvent(diagnosticsEvent(6, 2))).toBe(false);
    expect(applyLspMessageEvent(diagnosticsEvent(7, 2, "/other"))).toBe(false);
    expect(useLspStore().diagnostics[0].version).toBe(1);
  });

  it("does not let an older document version overwrite newer diagnostics", () => {
    applyLspStatusEvent(status(9));
    expect(applyLspMessageEvent(diagnosticsEvent(9, 4))).toBe(true);
    expect(applyLspMessageEvent(diagnosticsEvent(9, 3))).toBe(false);
    expect(useLspStore().diagnostics[0].version).toBe(4);
  });

  it("ignores stale status generations and clears diagnostics on failure", () => {
    applyLspStatusEvent(status(10));
    applyLspMessageEvent(diagnosticsEvent(10, 1));
    expect(applyLspStatusEvent(status(9, "error"))).toBe(false);
    expect(useLspStore().diagnostics).toHaveLength(1);

    expect(applyLspStatusEvent(status(10, "error"))).toBe(true);
    expect(useLspStore().diagnostics).toHaveLength(0);
  });

  it("does not let a synthetic generation-zero failure override native state", () => {
    applyLspStatusEvent(status(12));
    expect(recordLspFailure(
      root,
      "typescript",
      "TypeScript",
      0,
      new Error("late startup failure"),
    )).toBe(false);
    expect(statusForServer("typescript")).toMatchObject({ generation: 12, state: "starting" });
  });

  it("rejects diagnostics whose URI escapes the workspace", () => {
    applyLspStatusEvent(status(2));
    const event = diagnosticsEvent(2, 1);
    (event.message as any).params.uri = "file:///outside/app.ts";
    expect(applyLspMessageEvent(event)).toBe(false);
    expect(useLspStore().diagnostics).toHaveLength(0);
  });
});
