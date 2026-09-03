import { createStore } from "solid-js/store";
import type {
  LspDiagnostic,
  LspDocumentDiagnostics,
  LspMessageEvent,
  LspPosition,
  LspRuntimeState,
  LspServerStatus,
  LspServerStatusEvent,
} from "./types";
import { fileUriToWorkspacePath, sameWorkspacePath } from "./uri";

type JsonObject = Record<string, unknown>;

const [lspState, setLspState] = createStore<LspRuntimeState>({
  root: null,
  statuses: [],
  diagnostics: [],
});

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function positionFrom(value: unknown): LspPosition | null {
  const object = asObject(value);
  if (!object) return null;
  const line = safeInteger(object.line);
  const character = safeInteger(object.character);
  return line === null || character === null ? null : { line, character };
}

function diagnosticFrom(value: unknown): LspDiagnostic | null {
  const object = asObject(value);
  const range = asObject(object?.range);
  const start = positionFrom(range?.start);
  const end = positionFrom(range?.end);
  if (!object || !range || !start || !end || typeof object.message !== "string") return null;

  const diagnostic: LspDiagnostic = {
    range: { start, end },
    message: object.message.slice(0, 8_000),
  };
  if ([1, 2, 3, 4].includes(object.severity as number)) {
    diagnostic.severity = object.severity as 1 | 2 | 3 | 4;
  }
  if (typeof object.source === "string") diagnostic.source = object.source.slice(0, 200);
  if (typeof object.code === "string" || typeof object.code === "number") {
    diagnostic.code = typeof object.code === "string" ? object.code.slice(0, 200) : object.code;
  }
  return diagnostic;
}

export interface NormalizedLspMessage {
  value: JsonObject;
  serialized: string;
}

export function normalizeLspMessage(message: unknown): NormalizedLspMessage | null {
  let value: unknown = message;
  if (typeof message === "string") {
    try {
      value = JSON.parse(message);
    } catch {
      return null;
    }
  }
  const object = asObject(value);
  if (!object) return null;
  try {
    return {
      value: object,
      serialized: typeof message === "string" ? message : JSON.stringify(object),
    };
  } catch {
    return null;
  }
}

function currentStatus(serverId: string): LspServerStatus | undefined {
  return lspState.statuses.find((status) => status.serverId === serverId);
}

export function lspMessageEventIsCurrent(event: LspMessageEvent): boolean {
  if (!lspState.root || !sameWorkspacePath(lspState.root, event.root)) return false;
  const status = currentStatus(event.serverId);
  if (!status) return false;
  return status.generation === event.generation &&
    status.state !== "stopped" &&
    status.state !== "stopping" &&
    status.state !== "failed" &&
    status.state !== "missing";
}

export function normalizeLspStatus(status: LspServerStatusEvent): LspServerStatus {
  return {
    ...status,
    state: status.state === "running"
      ? "starting"
      : status.state === "error"
        ? "failed"
        : status.state,
  };
}

export function applyLspStatusEvent(event: LspServerStatusEvent): boolean {
  const status = normalizeLspStatus(event);
  if (
    !lspState.root ||
    !sameWorkspacePath(lspState.root, status.root) ||
    !Number.isSafeInteger(status.generation) ||
    status.generation < 0
  ) {
    return false;
  }

  const previous = currentStatus(status.serverId);
  if (previous && previous.generation > status.generation) return false;
  if (previous?.generation === status.generation) {
    const previousTerminal = ["stopped", "failed", "missing"].includes(previous.state);
    const regressesReady = previous.state === "ready" && status.state === "starting";
    const regressesStopping = previous.state === "stopping" &&
      ["starting", "ready"].includes(status.state);
    if ((previousTerminal && previous.state !== status.state) || regressesReady || regressesStopping) {
      return false;
    }
  }
  setLspState(
    "statuses",
    lspState.statuses.some((entry) => entry.serverId === status.serverId)
      ? lspState.statuses.map((entry) => entry.serverId === status.serverId ? status : entry)
      : [...lspState.statuses, status],
  );

  if (["stopped", "failed", "missing"].includes(status.state)) {
    setLspState(
      "diagnostics",
      lspState.diagnostics.filter(
        (entry) => entry.serverId !== status.serverId || entry.generation > status.generation,
      ),
    );
  }
  return true;
}

export function applyLspMessageEvent(
  event: LspMessageEvent,
  normalized = normalizeLspMessage(event.message),
): boolean {
  if (!normalized || !lspMessageEventIsCurrent(event)) return false;
  if (normalized.value.method !== "textDocument/publishDiagnostics") return true;

  const params = asObject(normalized.value.params);
  if (!params || typeof params.uri !== "string" || !Array.isArray(params.diagnostics)) return false;
  const path = fileUriToWorkspacePath(event.root, params.uri);
  if (!path) return false;
  const version = params.version === undefined || params.version === null
    ? null
    : safeInteger(params.version);
  if (params.version !== undefined && params.version !== null && version === null) return false;

  const diagnostics = params.diagnostics
    .slice(0, 2_000)
    .map(diagnosticFrom)
    .filter((item): item is LspDiagnostic => item !== null);
  const entry: LspDocumentDiagnostics = {
    root: event.root,
    path,
    uri: params.uri,
    serverId: event.serverId,
    generation: event.generation,
    version,
    diagnostics,
  };
  const previous = lspState.diagnostics.find(
    (item) => item.serverId === event.serverId && sameWorkspacePath(item.path, path),
  );
  if (previous && previous.generation > entry.generation) return false;
  if (
    previous &&
    previous.generation === entry.generation &&
    previous.version !== null &&
    entry.version !== null &&
    previous.version > entry.version
  ) {
    return false;
  }

  setLspState(
    "diagnostics",
    lspState.diagnostics.some(
      (item) => item.serverId === event.serverId && sameWorkspacePath(item.path, path),
    )
      ? lspState.diagnostics.map((item) =>
          item.serverId === event.serverId && sameWorkspacePath(item.path, path) ? entry : item)
      : [...lspState.diagnostics, entry],
  );
  return true;
}

export function resetLspState(root: string | null) {
  setLspState({ root, statuses: [], diagnostics: [] });
}

export function clearLspServerState(serverId: string) {
  setLspState("statuses", lspState.statuses.filter((status) => status.serverId !== serverId));
  setLspState(
    "diagnostics",
    lspState.diagnostics.filter((entry) => entry.serverId !== serverId),
  );
}

export function recordLspFailure(
  root: string,
  serverId: string,
  label: string,
  generation: number,
  error: unknown,
  missing = false,
): boolean {
  const previous = currentStatus(serverId);
  if (previous && previous.generation > generation) return false;
  const message = error instanceof Error ? error.message : String(error);
  const preserveMissing = previous?.generation === generation && previous.state === "missing";
  return applyLspStatusEvent({
    root,
    serverId,
    label,
    generation,
    state: missing || preserveMissing ? "missing" : "failed",
    executable: previous?.executable ?? null,
    error: message.replace(/[\r\n]+/g, " ").slice(0, 1_000),
  });
}

export function diagnosticsForPath(path: string): LspDocumentDiagnostics[] {
  return lspState.diagnostics.filter((entry) => sameWorkspacePath(entry.path, path));
}

export function diagnosticCountsForPath(path: string): { error: number; warn: number } {
  let error = 0;
  let warn = 0;
  for (const entry of diagnosticsForPath(path)) {
    for (const diagnostic of entry.diagnostics) {
      if ((diagnostic.severity ?? 1) === 1) error += 1;
      else if (diagnostic.severity === 2) warn += 1;
    }
  }
  return { error, warn };
}

export function statusForServer(serverId: string): LspServerStatus | null {
  return currentStatus(serverId) ?? null;
}

export function useLspStore() {
  return lspState;
}
