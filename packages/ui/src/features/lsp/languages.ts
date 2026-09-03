import type { LspLanguage, LspServerId } from "./types";

interface LanguageDefinition extends LspLanguage {
  extensions: readonly string[];
}

const LANGUAGE_DEFINITIONS: readonly LanguageDefinition[] = [
  {
    serverId: "typescript",
    languageId: "typescript",
    extensions: ["ts", "mts", "cts"],
  },
  {
    serverId: "typescript",
    languageId: "typescriptreact",
    extensions: ["tsx"],
  },
  {
    serverId: "typescript",
    languageId: "javascript",
    extensions: ["js", "mjs", "cjs"],
  },
  {
    serverId: "typescript",
    languageId: "javascriptreact",
    extensions: ["jsx"],
  },
  { serverId: "rust", languageId: "rust", extensions: ["rs"] },
  { serverId: "python", languageId: "python", extensions: ["py", "pyi"] },
  { serverId: "json", languageId: "json", extensions: ["json", "jsonc"] },
  { serverId: "css", languageId: "css", extensions: ["css"] },
  { serverId: "css", languageId: "scss", extensions: ["scss"] },
  { serverId: "css", languageId: "less", extensions: ["less"] },
  { serverId: "html", languageId: "html", extensions: ["html", "htm"] },
];

const LANGUAGE_BY_EXTENSION = new Map<string, LspLanguage>();
for (const definition of LANGUAGE_DEFINITIONS) {
  for (const extension of definition.extensions) {
    LANGUAGE_BY_EXTENSION.set(extension, {
      serverId: definition.serverId,
      languageId: definition.languageId,
    });
  }
}

export function lspLanguageForPath(path: string): LspLanguage | null {
  const name = path.replace(/\\/g, "/").split("/").pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0 || dot === name.length - 1) return null;
  return LANGUAGE_BY_EXTENSION.get(name.slice(dot + 1).toLowerCase()) ?? null;
}

export function supportsLspServerId(value: string): value is LspServerId {
  return LANGUAGE_DEFINITIONS.some((definition) => definition.serverId === value);
}

export function languageServerIds(): readonly LspServerId[] {
  return ["typescript", "rust", "python", "json", "css", "html"];
}

export function lspServerLabel(serverId: string): string {
  if (serverId === "typescript") return "TypeScript / JavaScript";
  if (serverId === "rust") return "Rust Analyzer";
  if (serverId === "python") return "Python";
  if (serverId === "json") return "JSON";
  if (serverId === "css") return "CSS";
  if (serverId === "html") return "HTML";
  return serverId;
}
