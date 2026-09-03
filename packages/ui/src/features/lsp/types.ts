export const LSP_SERVER_IDS = [
  "typescript",
  "rust",
  "python",
  "json",
  "css",
  "html",
] as const;

export type LspServerId = (typeof LSP_SERVER_IDS)[number];

export type LspServerState =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed"
  | "missing";

export type LspNativeServerState = LspServerState | "running" | "error";

export interface LspServerConfig {
  id: string;
  enabled: boolean;
  /** Configured executable path or command name. Null means native auto-detection. */
  executable: string | null;
}

export interface LspServerStatusEvent {
  root: string;
  serverId: string;
  label: string;
  generation: number;
  state: LspNativeServerState;
  executable: string | null;
  error: string | null;
}

export interface LspServerStatus extends Omit<LspServerStatusEvent, "state"> {
  state: LspServerState;
}

export interface LspMessageEvent {
  root: string;
  serverId: string;
  generation: number;
  /** Native code may serialize the JSON-RPC payload as a string or JSON value. */
  message: unknown;
}

export interface LspLanguage {
  serverId: LspServerId;
  languageId: string;
}

export interface LspPosition {
  line: number;
  character: number;
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspDiagnostic {
  range: LspRange;
  message: string;
  severity?: 1 | 2 | 3 | 4;
  source?: string;
  code?: string | number;
}

export interface LspDocumentDiagnostics {
  root: string;
  path: string;
  uri: string;
  serverId: string;
  generation: number;
  version: number | null;
  diagnostics: LspDiagnostic[];
}

export interface LspRuntimeState {
  root: string | null;
  statuses: LspServerStatus[];
  diagnostics: LspDocumentDiagnostics[];
}

export interface LspDocumentExtensionOptions {
  root: string;
  path: string;
  enabled: boolean;
  servers: readonly LspServerConfig[];
}
