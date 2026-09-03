import type { Transport } from "@codemirror/lsp-client";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  listenLspMessages,
  listenLspStatus,
  lspSend,
  lspStart,
  lspStop,
} from "../../bridge/tauri";
import {
  applyLspMessageEvent,
  applyLspStatusEvent,
  lspMessageEventIsCurrent,
  normalizeLspMessage,
  normalizeLspStatus,
  recordLspFailure,
  statusForServer,
} from "./store";
import { lspServerLabel } from "./languages";
import type {
  LspMessageEvent,
  LspServerStatus,
  LspServerStatusEvent,
} from "./types";
import { sameWorkspacePath } from "./uri";

type MessageHandler = (value: string) => void;

const transports = new Set<TauriLspTransport>();
let listenerPromise: Promise<void> | null = null;
let unlistenMessages: UnlistenFn | null = null;
let unlistenStatus: UnlistenFn | null = null;

function rpcId(value: unknown): string | number | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  return null;
}

function handleMessageEvent(event: LspMessageEvent) {
  const normalized = normalizeLspMessage(event.message);
  if (!normalized || !lspMessageEventIsCurrent(event)) return;
  applyLspMessageEvent(event, normalized);
  for (const transport of transports) {
    if (transport.accepts(event)) transport.deliver(normalized.serialized, normalized.value);
  }
}

function handleStatusEvent(event: LspServerStatusEvent) {
  if (!applyLspStatusEvent(event)) return;
  const status = normalizeLspStatus(event);
  for (const transport of transports) transport.handleStatus(status);
}

async function ensureLspListeners(): Promise<void> {
  if (listenerPromise) return listenerPromise;
  listenerPromise = Promise.all([
    listenLspMessages(handleMessageEvent),
    listenLspStatus(handleStatusEvent),
  ])
    .then(([messages, status]) => {
      unlistenMessages = messages;
      unlistenStatus = status;
    })
    .catch((error) => {
      listenerPromise = null;
      throw error;
    });
  return listenerPromise;
}

export async function connectLspListeners(): Promise<() => void> {
  await ensureLspListeners();
  return disconnectLspListeners;
}

export function disconnectLspListeners() {
  unlistenMessages?.();
  unlistenStatus?.();
  unlistenMessages = null;
  unlistenStatus = null;
  listenerPromise = null;
}

export class TauriLspTransport implements Transport {
  generation: number | null = null;
  private handlers = new Set<MessageHandler>();
  private pendingRequests = new Map<string | number, string>();
  private sendQueue: Promise<void>;
  private startPromise: Promise<LspServerStatus> | null = null;
  private stopPromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    readonly root: string,
    readonly serverId: string,
    startAfter: Promise<void> = Promise.resolve(),
  ) {
    this.sendQueue = startAfter;
    transports.add(this);
  }

  send(message: string): void {
    if (this.closed) return;
    const normalized = normalizeLspMessage(message);
    if (!normalized) {
      this.failPending(new Error("Language client produced invalid JSON-RPC"));
      return;
    }
    const id = rpcId(normalized.value.id);
    const method = typeof normalized.value.method === "string" ? normalized.value.method : null;
    if (id !== null && method) this.pendingRequests.set(id, method);

    this.sendQueue = this.sendQueue
      .then(async () => {
        const status = await this.ensureStarted();
        if (this.closed) return;
        await lspSend(this.root, this.serverId, status.generation, normalized.serialized);
      })
      .catch((error) => {
        if (!this.closed) {
          const current = statusForServer(this.serverId);
          recordLspFailure(
            this.root,
            this.serverId,
            current?.label ?? lspServerLabel(this.serverId),
            this.generation ?? 0,
            error,
          );
        }
        if (id !== null && method) this.rejectRequest(id, error);
      });
  }

  subscribe(handler: MessageHandler): void {
    this.handlers.add(handler);
  }

  unsubscribe(handler: MessageHandler): void {
    this.handlers.delete(handler);
  }

  async flushed(): Promise<void> {
    await this.sendQueue;
  }

  accepts(event: LspMessageEvent): boolean {
    return !this.closed &&
      this.generation !== null &&
      event.generation === this.generation &&
      event.serverId === this.serverId &&
      sameWorkspacePath(event.root, this.root);
  }

  deliver(message: string, value = normalizeLspMessage(message)?.value): void {
    if (!value) return;
    const id = rpcId(value.id);
    if (id !== null && typeof value.method !== "string") this.pendingRequests.delete(id);
    for (const handler of this.handlers) {
      try {
        handler(message);
      } catch (error) {
        console.error("[CE] LSP message handler failed", error);
      }
    }
  }

  handleStatus(status: LspServerStatus) {
    if (
      this.generation === null ||
      status.generation !== this.generation ||
      status.serverId !== this.serverId ||
      !sameWorkspacePath(status.root, this.root)
    ) {
      return;
    }
    if (status.state === "failed" || status.state === "missing" || status.state === "stopped") {
      this.failPending(new Error(status.error ?? `${status.label} ${status.state}`));
    }
  }

  async stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.closed = true;
    transports.delete(this);
    this.stopPromise = (async () => {
      await this.sendQueue.catch(() => undefined);
      this.failPending(new Error("Language server stopped"));
      if (this.generation !== null) {
        await lspStop(this.root, this.serverId, this.generation).catch(() => undefined);
      }
    })();
    return this.stopPromise;
  }

  closeLocally() {
    this.closed = true;
    transports.delete(this);
    this.failPending(new Error("Language server disconnected"));
  }

  private ensureStarted(): Promise<LspServerStatus> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = (async () => {
      try {
        await ensureLspListeners();
        const event = await lspStart(this.root, this.serverId);
        if (!sameWorkspacePath(event.root, this.root) || event.serverId !== this.serverId) {
          throw new Error("Language server started for a different workspace");
        }
        const status = normalizeLspStatus(event);
        applyLspStatusEvent(event);
        if (
          status.state === "failed" ||
          status.state === "missing" ||
          status.state === "stopped" ||
          status.state === "stopping"
        ) {
          throw new Error(status.error ?? `${status.label} is ${status.state}`);
        }
        this.generation = status.generation;
        return status;
      } catch (error) {
        const current = statusForServer(this.serverId);
        const generation = this.generation ?? (
          current &&
          sameWorkspacePath(current.root, this.root) &&
          ["starting", "failed", "missing"].includes(current.state)
            ? current.generation
            : 0
        );
        const message = error instanceof Error ? error.message : String(error);
        recordLspFailure(
          this.root,
          this.serverId,
          current?.label ?? lspServerLabel(this.serverId),
          generation,
          error,
          /(?:not found|missing|no such file|could not find)/i.test(message),
        );
        throw error;
      }
    })();
    return this.startPromise;
  }

  private rejectRequest(id: string | number, error: unknown) {
    if (!this.pendingRequests.delete(id)) return;
    const message = error instanceof Error ? error.message : String(error);
    this.deliver(JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32_002, message: message.slice(0, 1_000) },
    }));
  }

  private failPending(error: Error) {
    for (const id of Array.from(this.pendingRequests.keys())) this.rejectRequest(id, error);
  }
}
