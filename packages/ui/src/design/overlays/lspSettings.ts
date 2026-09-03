import type { LspServerSettings } from "../../bridge/types";

export const LSP_SERVER_OPTIONS = [
  {
    id: "typescript",
    label: "TypeScript / JavaScript",
    description: "TypeScript and JavaScript projects",
  },
  {
    id: "rust",
    label: "Rust",
    description: "Rust projects",
  },
  {
    id: "python",
    label: "Python",
    description: "Python projects",
  },
  {
    id: "json",
    label: "JSON",
    description: "JSON files and schemas",
  },
  {
    id: "css",
    label: "CSS",
    description: "CSS, SCSS, and related stylesheets",
  },
  {
    id: "html",
    label: "HTML",
    description: "HTML documents and templates",
  },
] as const;

export type LspServerId = (typeof LSP_SERVER_OPTIONS)[number]["id"];

export function normalizeLspExecutable(value: string): string | null {
  return value.trim() || null;
}

export function updateLspServerSettings(
  servers: readonly LspServerSettings[],
  id: LspServerId,
  patch: Partial<Pick<LspServerSettings, "enabled" | "executable">>,
): LspServerSettings[] {
  const existing = servers.find((server) => server.id === id);
  if (!existing) {
    return [
      ...servers,
      {
        id,
        enabled: patch.enabled ?? true,
        executable: patch.executable ?? null,
      },
    ];
  }

  return servers.map((server) => (
    server.id === id ? { ...server, ...patch } : server
  ));
}
