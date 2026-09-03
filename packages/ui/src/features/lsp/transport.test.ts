import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  lspStart: vi.fn(),
  lspSend: vi.fn(),
  lspStop: vi.fn(),
  listenLspMessages: vi.fn(),
  listenLspStatus: vi.fn(),
}));

vi.mock("../../bridge/tauri", () => bridge);

import { resetLspState, statusForServer } from "./store";
import {
  disconnectLspListeners,
  TauriLspTransport,
} from "./transport";
import type { LspMessageEvent, LspServerStatusEvent } from "./types";

let onMessage: ((event: LspMessageEvent) => void) | null;
let onStatus: ((event: LspServerStatusEvent) => void) | null;

function readyStatus(generation = 4): LspServerStatusEvent {
  return {
    root: "/project",
    serverId: "typescript",
    label: "TypeScript",
    generation,
    state: "running",
    executable: "/bin/typescript-language-server",
    error: null,
  };
}

describe("serialized Tauri LSP transport", () => {
  beforeEach(() => {
    disconnectLspListeners();
    resetLspState("/project");
    onMessage = null;
    onStatus = null;
    bridge.lspStart.mockReset().mockResolvedValue(readyStatus());
    bridge.lspSend.mockReset().mockResolvedValue(undefined);
    bridge.lspStop.mockReset().mockResolvedValue(undefined);
    bridge.listenLspMessages.mockReset().mockImplementation(async (handler) => {
      onMessage = handler;
      return () => {};
    });
    bridge.listenLspStatus.mockReset().mockImplementation(async (handler) => {
      onStatus = handler;
      return () => {};
    });
  });

  it("starts once, serializes sends, and routes only the exact root/generation", async () => {
    let releaseFirst!: () => void;
    const firstSend = new Promise<void>((resolve) => { releaseFirst = resolve; });
    bridge.lspSend
      .mockImplementationOnce(() => firstSend)
      .mockResolvedValue(undefined);
    const transport = new TauriLspTransport("/project", "typescript");
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));

    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {},
    });
    const initialized = JSON.stringify({
      jsonrpc: "2.0",
      method: "initialized",
      params: {},
    });
    transport.send(initialize);
    transport.send(initialized);

    await vi.waitFor(() => expect(bridge.lspSend).toHaveBeenCalledTimes(1));
    expect(bridge.lspStart).toHaveBeenCalledTimes(1);
    releaseFirst();
    await transport.flushed();
    expect(bridge.lspSend.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      ["/project", "typescript", 4, initialize],
      ["/project", "typescript", 4, initialized],
    ]);

    onMessage?.({
      root: "/other",
      serverId: "typescript",
      generation: 4,
      message: { jsonrpc: "2.0", id: 1, result: {} },
    });
    onMessage?.({
      root: "/project",
      serverId: "typescript",
      generation: 3,
      message: { jsonrpc: "2.0", id: 1, result: {} },
    });
    expect(received).toEqual([]);

    onMessage?.({
      root: "/project",
      serverId: "typescript",
      generation: 4,
      message: { jsonrpc: "2.0", id: 1, result: { capabilities: {} } },
    });
    expect(JSON.parse(received[0])).toMatchObject({ id: 1, result: { capabilities: {} } });

    await transport.stop();
    expect(bridge.lspStop).toHaveBeenCalledWith("/project", "typescript", 4);
  });

  it("turns startup failure into a client response and visible status", async () => {
    bridge.lspStart.mockRejectedValueOnce(new Error("typescript-language-server not found"));
    const transport = new TauriLspTransport("/project", "typescript");
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));

    transport.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 8,
      method: "initialize",
      params: {},
    }));
    await transport.flushed();

    expect(received).toHaveLength(1);
    expect(JSON.parse(received[0])).toMatchObject({
      id: 8,
      error: { code: -32_002 },
    });
    expect(statusForServer("typescript")).toMatchObject({
      generation: 0,
      state: "missing",
      error: "typescript-language-server not found",
    });
    transport.closeLocally();
  });

  it("normalizes native error events and fails matching pending requests", async () => {
    const transport = new TauriLspTransport("/project", "typescript");
    const received: string[] = [];
    transport.subscribe((message) => received.push(message));
    transport.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 11,
      method: "initialize",
      params: {},
    }));
    await transport.flushed();

    onStatus?.({ ...readyStatus(), state: "error", error: "server crashed" });
    expect(statusForServer("typescript")?.state).toBe("failed");
    expect(JSON.parse(received[0])).toMatchObject({
      id: 11,
      error: { message: "server crashed" },
    });
    transport.closeLocally();
  });
});
