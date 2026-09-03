import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  lspStart: vi.fn(),
  lspSend: vi.fn(),
  lspStop: vi.fn(),
  lspStopAll: vi.fn(),
  lspStatuses: vi.fn(),
  listenLspMessages: vi.fn(),
  listenLspStatus: vi.fn(),
}));

const fakeLsp = vi.hoisted(() => {
  const instances: any[] = [];
  let nextInitializing: Promise<unknown> | null = null;
  class Client {
    initializing: Promise<unknown>;
    serverCapabilities: any = { textDocumentSync: { save: true } };
    notifications: Array<{ method: string; params: unknown }> = [];
    requests: Array<{ method: string; params: unknown }> = [];
    disconnected = false;
    transport: any = null;
    workspace = {
      file: null as any,
      getFile: (uri: string) => this.workspace.file?.uri === uri ? this.workspace.file : null,
    };

    constructor(readonly config: unknown) {
      this.initializing = nextInitializing ?? Promise.resolve(null);
      nextInitializing = null;
      instances.push(this);
    }

    connect(transport: any) {
      this.transport = transport;
      transport.subscribe(() => {});
      transport.send(JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }));
      return this;
    }

    plugin(uri: string, languageId: string) {
      this.workspace.file = {
        uri,
        languageId,
        version: 1,
        doc: { toString: () => "saved text" },
      };
      return [{ fakePlugin: uri }];
    }

    sync() {}

    request(method: string, params: unknown) {
      this.requests.push({ method, params });
      return Promise.resolve(null);
    }

    notification(method: string, params: unknown) {
      this.notifications.push({ method, params });
      this.transport.send(JSON.stringify({ jsonrpc: "2.0", method, params }));
    }

    cancelRequest() {}

    disconnect() {
      this.disconnected = true;
    }
  }
  return {
    Client,
    instances,
    setNextInitializing(value: Promise<unknown> | null) {
      nextInitializing = value;
    },
  };
});

vi.mock("../../bridge/tauri", () => bridge);
vi.mock("@codemirror/lsp-client", () => ({
  LSPClient: fakeLsp.Client,
  languageServerExtensions: () => [],
}));

import {
  lspExtensionForDocument,
  notifyLspDocumentSaved,
  resetLspRuntime,
} from "./runtime";
import { statusForServer } from "./store";
import { disconnectLspListeners } from "./transport";

const root = "/project";
const documentPath = "/project/src/app.ts";

function server(executable: string | null, enabled = true) {
  return [{ id: "typescript", enabled, executable }];
}

describe("LSP client runtime", () => {
  beforeEach(() => {
    resetLspRuntime(root);
    disconnectLspListeners();
    fakeLsp.instances.length = 0;
    fakeLsp.setNextInitializing(null);
    bridge.lspStart.mockReset().mockResolvedValue({
      root,
      serverId: "typescript",
      label: "TypeScript",
      generation: 4,
      state: "running",
      executable: "/resolved/typescript-language-server",
      error: null,
    });
    bridge.lspSend.mockReset().mockResolvedValue(undefined);
    bridge.lspStop.mockReset().mockResolvedValue(undefined);
    bridge.lspStopAll.mockReset().mockResolvedValue([]);
    bridge.lspStatuses.mockReset().mockResolvedValue([]);
    bridge.listenLspMessages.mockReset().mockResolvedValue(() => {});
    bridge.listenLspStatus.mockReset().mockResolvedValue(() => {});
  });

  it("recreates the client when executable or enabled state changes", async () => {
    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server("/one/typescript-language-server"),
    });
    await vi.waitFor(() => expect(bridge.lspStart).toHaveBeenCalledTimes(1));
    expect(fakeLsp.instances).toHaveLength(1);
    await vi.waitFor(() => expect(statusForServer("typescript")?.state).toBe("ready"));

    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server("/two/typescript-language-server"),
    });
    await vi.waitFor(() => expect(bridge.lspStart).toHaveBeenCalledTimes(2));
    expect(fakeLsp.instances).toHaveLength(2);
    expect(fakeLsp.instances[0].requests).toContainEqual({ method: "shutdown", params: null });
    expect(fakeLsp.instances[0].notifications).toContainEqual({ method: "exit", params: undefined });
    expect(fakeLsp.instances[0].disconnected).toBe(true);
    expect(bridge.lspStop).toHaveBeenCalledTimes(1);

    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server("/two/typescript-language-server", false),
    });
    await vi.waitFor(() => expect(bridge.lspStop).toHaveBeenCalledTimes(2));
    expect(fakeLsp.instances[1].disconnected).toBe(true);

    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server("/two/typescript-language-server", true),
    });
    await vi.waitFor(() => expect(bridge.lspStart).toHaveBeenCalledTimes(3));
    expect(fakeLsp.instances).toHaveLength(3);
  });

  it("sends didSave only when advertised and includes text on request", async () => {
    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server(null),
    });
    await vi.waitFor(() => expect(bridge.lspStart).toHaveBeenCalledTimes(1));
    const client = fakeLsp.instances[0];
    client.serverCapabilities = { textDocumentSync: { save: { includeText: true } } };

    await expect(notifyLspDocumentSaved(root, documentPath)).resolves.toBe(true);
    expect(client.notifications).toContainEqual({
      method: "textDocument/didSave",
      params: {
        textDocument: { uri: "file:///project/src/app.ts" },
        text: "saved text",
      },
    });

    client.serverCapabilities = { textDocumentSync: { save: false } };
    await expect(notifyLspDocumentSaved(root, documentPath)).resolves.toBe(false);
  });

  it("surfaces a protocol initialization failure after native startup", async () => {
    let rejectInitializing!: (error: Error) => void;
    fakeLsp.setNextInitializing(new Promise((_, reject) => {
      rejectInitializing = reject;
    }));
    lspExtensionForDocument({
      root,
      path: documentPath,
      enabled: true,
      servers: server(null),
    });
    await vi.waitFor(() => expect(bridge.lspSend).toHaveBeenCalledTimes(1));

    rejectInitializing(new Error("initialize response was invalid"));

    await vi.waitFor(() => expect(statusForServer("typescript")).toMatchObject({
      generation: 4,
      state: "failed",
      error: "initialize response was invalid",
    }));
  });
});
