import { LSPClient, languageServerExtensions } from "@codemirror/lsp-client";
import type { Extension } from "@codemirror/state";
import { lspStatuses, lspStop, lspStopAll } from "../../bridge/tauri";
import { lspLanguageForPath, lspServerLabel, supportsLspServerId } from "./languages";
import { sanitizeLspHTML } from "./sanitize";
import {
  applyLspStatusEvent,
  clearLspServerState,
  recordLspFailure,
  resetLspState,
  statusForServer,
  useLspStore,
} from "./store";
import { TauriLspTransport } from "./transport";
import type {
  LspDocumentExtensionOptions,
  LspServerConfig,
  LspServerId,
} from "./types";
import {
  normalizeWorkspacePath,
  sameWorkspacePath,
  workspacePathToFileUri,
} from "./uri";

interface ClientEntry {
  root: string;
  serverId: LspServerId;
  fingerprint: string;
  client: LSPClient;
  transport: TauriLspTransport;
}

const clients = new Map<string, ClientEntry>();
const configFingerprints = new Map<string, string>();
const lifecycleBarriers = new Map<string, Promise<void>>();

function serverKey(root: string, serverId: string): string | null {
  const normalizedRoot = normalizeWorkspacePath(root);
  return normalizedRoot ? `${normalizedRoot}\0${serverId}` : null;
}

function configFingerprint(config: LspServerConfig, enabled: boolean): string {
  return JSON.stringify({
    enabled: enabled && config.enabled,
    executable: config.executable?.trim() || null,
  });
}

function settlesSuccessfullyWithin(promise: Promise<unknown>, milliseconds: number): Promise<boolean> {
  return Promise.race([
    promise.then(() => true, () => false),
    new Promise<false>((resolve) => globalThis.setTimeout(() => resolve(false), milliseconds)),
  ]);
}

async function gracefullyShutdownClient(entry: ClientEntry): Promise<void> {
  const initialized = await settlesSuccessfullyWithin(entry.client.initializing, 1_000);
  if (initialized) {
    entry.client.sync();
    const shutdownParams = null;
    const stopped = await settlesSuccessfullyWithin(
      entry.client.request<null, null>("shutdown", shutdownParams),
      1_500,
    );
    if (!stopped) entry.client.cancelRequest(shutdownParams);
    entry.client.notification("exit", undefined);
    await Promise.resolve();
    await entry.transport.flushed().catch(() => undefined);
  }
  entry.client.disconnect();
  await entry.transport.stop();
}

function retireClient(key: string, entry: ClientEntry): Promise<void> {
  clients.delete(key);
  const stopped = gracefullyShutdownClient(entry).catch(() => undefined);
  lifecycleBarriers.set(key, stopped);
  return stopped;
}

function createClient(
  key: string,
  root: string,
  serverId: LspServerId,
  fingerprint: string,
): ClientEntry | null {
  const rootUri = workspacePathToFileUri(root, root);
  if (!rootUri) return null;
  const transport = new TauriLspTransport(
    root,
    serverId,
    lifecycleBarriers.get(key) ?? Promise.resolve(),
  );
  const client = new LSPClient({
    rootUri,
    timeout: 15_000,
    sanitizeHTML: sanitizeLspHTML,
    extensions: languageServerExtensions(),
  }).connect(transport);
  void client.initializing
    .then(async () => {
      await transport.flushed();
      const status = statusForServer(serverId);
      if (
        status?.state === "starting" &&
        transport.generation !== null &&
        status.generation === transport.generation &&
        sameWorkspacePath(status.root, root)
      ) {
        applyLspStatusEvent({ ...status, state: "ready", error: null });
      }
    })
    .catch((error) => {
      recordLspFailure(
        root,
        serverId,
        lspServerLabel(serverId),
        transport.generation ?? 0,
        error,
      );
      console.error(`[CE] ${serverId} language server initialization failed`, error);
    });
  const entry = { root, serverId, fingerprint, client, transport };
  clients.set(key, entry);
  return entry;
}

function ensureRoot(root: string): boolean {
  const state = useLspStore();
  if (state.root === null) {
    resetLspState(root);
    return true;
  }
  return sameWorkspacePath(state.root, root);
}

export function lspExtensionForDocument(
  options: LspDocumentExtensionOptions,
): Extension {
  const language = lspLanguageForPath(options.path);
  const uri = workspacePathToFileUri(options.root, options.path);
  if (!language || !uri || !ensureRoot(options.root)) return [];

  const key = serverKey(options.root, language.serverId);
  if (!key) return [];
  const config = options.servers.find((server) => server.id === language.serverId);
  if (!config || !supportsLspServerId(config.id)) {
    const existing = clients.get(key);
    if (existing) void retireClient(key, existing);
    else clearLspServerState(language.serverId);
    configFingerprints.delete(key);
    return [];
  }

  const fingerprint = configFingerprint(config, options.enabled);
  const previousFingerprint = configFingerprints.get(key);
  const configChanged = previousFingerprint !== undefined && previousFingerprint !== fingerprint;
  configFingerprints.set(key, fingerprint);
  if (configChanged) {
    const existing = clients.get(key);
    if (existing) void retireClient(key, existing);
  }

  if (!options.enabled || !config.enabled) {
    const existing = clients.get(key);
    if (existing) void retireClient(key, existing);
    return [];
  }

  const status = statusForServer(language.serverId);
  if (!configChanged && (status?.state === "failed" || status?.state === "missing")) return [];

  let entry = clients.get(key);
  if (!entry || entry.fingerprint !== fingerprint) {
    if (entry) void retireClient(key, entry);
    entry = createClient(key, options.root, language.serverId, fingerprint) ?? undefined;
  }
  return entry ? entry.client.plugin(uri, language.languageId) : [];
}

export async function notifyLspDocumentSaved(root: string, path: string): Promise<boolean> {
  const language = lspLanguageForPath(path);
  const uri = workspacePathToFileUri(root, path);
  const key = language && serverKey(root, language.serverId);
  if (!language || !uri || !key) return false;
  const entry = clients.get(key);
  if (!entry || entry.transport.generation === null) return false;

  try {
    await entry.client.initializing;
  } catch {
    return false;
  }
  entry.client.sync();
  const file = entry.client.workspace.getFile(uri);
  if (!file) return false;

  const textDocumentSync = entry.client.serverCapabilities?.textDocumentSync;
  if (!textDocumentSync || typeof textDocumentSync !== "object") return false;
  const save = textDocumentSync.save;
  if (!save) return false;
  const includeText = typeof save === "object" && save.includeText === true;
  entry.client.notification("textDocument/didSave", {
    textDocument: { uri },
    ...(includeText ? { text: file.doc.toString() } : {}),
  });
  return true;
}

export async function restartLspServer(root: string, serverId: string): Promise<void> {
  const key = serverKey(root, serverId);
  if (!key) return;
  const entry = clients.get(key);
  if (entry) {
    await retireClient(key, entry);
  } else {
    const status = statusForServer(serverId);
    if (status && sameWorkspacePath(status.root, root)) {
      await lspStop(root, serverId, status.generation).catch(() => undefined);
    }
  }
  clearLspServerState(serverId);
}

export async function refreshLspStatuses(root: string): Promise<void> {
  if (!ensureRoot(root)) return;
  const statuses = await lspStatuses(root);
  for (const status of statuses) applyLspStatusEvent(status);
}

function closeLocalClients(root?: string) {
  for (const [key, entry] of Array.from(clients.entries())) {
    if (root && !sameWorkspacePath(entry.root, root)) continue;
    clients.delete(key);
    entry.client.disconnect();
    entry.transport.closeLocally();
  }
}

export async function stopAllLspServers(root: string): Promise<void> {
  const retirements: Promise<void>[] = [];
  for (const [key, entry] of Array.from(clients.entries())) {
    if (!sameWorkspacePath(entry.root, root)) continue;
    retirements.push(retireClient(key, entry));
  }
  await Promise.all(retirements);
  const stopping = lspStopAll(root).then(() => undefined, () => undefined);
  for (const id of ["typescript", "rust", "python", "json", "css", "html"]) {
    const key = serverKey(root, id);
    if (key) lifecycleBarriers.set(key, stopping);
  }
  await stopping;
  if (useLspStore().root && sameWorkspacePath(useLspStore().root!, root)) {
    resetLspState(root);
  }
}

export async function setLspActiveRoot(root: string | null): Promise<void> {
  const current = useLspStore().root;
  if (current && root && sameWorkspacePath(current, root)) return;
  if (current) await stopAllLspServers(current);
  closeLocalClients();
  configFingerprints.clear();
  resetLspState(root);
}

/** Clear local clients after a native reset without issuing another native stop. */
export function resetLspRuntime(root: string | null) {
  closeLocalClients();
  configFingerprints.clear();
  lifecycleBarriers.clear();
  resetLspState(root);
}
