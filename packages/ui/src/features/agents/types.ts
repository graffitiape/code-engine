import type {
  CodexPermissionPreset,
  CodexThread,
  CodexThreadItem,
  CodexThreadStatus,
  CodexTurnStartParams,
  CodexUserInput,
} from "../../bridge/tauri";

export const CODEX_THREAD_SOURCES = ["appServer", "cli", "vscode"] as const;

export interface PermissionOption {
  id: CodexPermissionPreset;
  label: string;
  description: string;
}

export const PERMISSION_OPTIONS: PermissionOption[] = [
  {
    id: "workspace-write",
    label: "Workspace",
    description: "Read and edit files in this project; ask before broader access.",
  },
  {
    id: "read-only",
    label: "Read only",
    description: "Inspect and plan without editing project files.",
  },
  {
    id: "full-access",
    label: "Full access",
    description: "Unrestricted local access without approval prompts.",
  },
];

export function textInput(text: string): CodexUserInput {
  return { type: "text", text, text_elements: [] };
}

export function localImageInput(path: string): CodexUserInput {
  return { type: "localImage", path };
}

export function permissionForTurn(
  preset: CodexPermissionPreset,
  cwd: string,
): Pick<CodexTurnStartParams, "approvalPolicy" | "sandboxPolicy"> {
  if (preset === "read-only") {
    return {
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
    };
  }
  if (preset === "full-access") {
    return { approvalPolicy: "never", sandboxPolicy: { type: "dangerFullAccess" } };
  }
  return {
    approvalPolicy: "on-request",
    sandboxPolicy: {
      type: "workspaceWrite",
      writableRoots: [cwd],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    },
  };
}

export function permissionForThread(preset: CodexPermissionPreset) {
  if (preset === "read-only") {
    return { approvalPolicy: "never" as const, sandbox: "read-only" as const };
  }
  if (preset === "full-access") {
    return { approvalPolicy: "never" as const, sandbox: "danger-full-access" as const };
  }
  return {
    approvalPolicy: "on-request" as const,
    sandbox: "workspace-write" as const,
  };
}

export function threadTitle(thread: CodexThread): string {
  return thread.name?.trim() || thread.preview?.trim() || "Untitled task";
}

export function threadStatusType(status: CodexThreadStatus | undefined): string {
  return status?.type ?? "notLoaded";
}

export function isThreadActive(thread: CodexThread | undefined): boolean {
  return threadStatusType(thread?.status) === "active";
}

export function sourceLabel(source: CodexThread["source"]): string {
  if (typeof source === "string") {
    if (source === "appServer") return "Code Engine";
    if (source === "vscode") return "VS Code";
    if (source === "cli") return "CLI";
    if (source === "exec") return "Exec";
    return source;
  }
  return "Codex";
}

export function flattenThreadItems(thread: CodexThread): CodexThreadItem[] {
  return thread.turns.flatMap((turn) => turn.items);
}

export function formatRelativeTime(unixSeconds: number): string {
  const delta = Math.max(0, Date.now() - unixSeconds * 1000);
  if (delta < 60_000) return "now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`;
  return `${Math.floor(delta / 86_400_000)}d`;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function fieldString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

export function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function userMessageText(item: CodexThreadItem): string {
  if (!Array.isArray(item.content)) return typeof item.text === "string" ? item.text : "";
  return item.content
    .map((entry) => {
      if (typeof entry === "string") return entry;
      return entry.type === "text" ? entry.text ?? "" : entry.path ?? entry.url ?? "";
    })
    .filter(Boolean)
    .join("\n");
}
