import type { PipelineAgentNode, PipelinePermission } from "./types";

export const PIPELINE_AGENT_LIBRARY_STORAGE_KEY = "ce.pipeline-agent-library.v1";
const SCHEMA_VERSION = 1 as const;
const MAX_ID_CHARS = 128;
const MAX_NAME_CHARS = 120;
const MAX_INSTRUCTION_CHARS = 16_000;
const MAX_MODEL_CHARS = 200;
const MAX_EFFORT_CHARS = 64;

export const PIPELINE_AGENT_LIBRARY_LIMIT = 50;
export const PIPELINE_AGENT_COLORS = [
  "cyan",
  "purple",
  "green",
  "yellow",
  "blue",
  "orange",
] as const;

export interface SavedPipelineAgent {
  id: string;
  name: string;
  instructions: string;
  model: string;
  effort: string;
  permission: PipelinePermission;
  retryCount: number;
  color: string;
}

interface PersistedAgentLibrary {
  schemaVersion: typeof SCHEMA_VERSION;
  agents: SavedPipelineAgent[];
}

function boundedString(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= max ? normalized : null;
}

function boundedInstructions(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.length > MAX_INSTRUCTION_CHARS) {
    return null;
  }
  return value;
}

function permission(value: unknown): PipelinePermission | null {
  return value === "read-only" || value === "workspace-write" || value === "full-access"
    ? value
    : null;
}

function parseSavedAgent(value: unknown): SavedPipelineAgent | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const id = boundedString(candidate.id, MAX_ID_CHARS);
  const name = boundedString(candidate.name, MAX_NAME_CHARS);
  const instructions = boundedInstructions(candidate.instructions);
  const model = boundedString(candidate.model, MAX_MODEL_CHARS);
  const effort = boundedString(candidate.effort, MAX_EFFORT_CHARS);
  const access = permission(candidate.permission);
  if (!id || !name || !instructions || !model || !effort || !access) return null;

  const retryCount = Number.isInteger(candidate.retryCount)
    ? Math.min(3, Math.max(0, Number(candidate.retryCount)))
    : 1;
  const color = typeof candidate.color === "string" &&
    PIPELINE_AGENT_COLORS.includes(candidate.color as (typeof PIPELINE_AGENT_COLORS)[number])
    ? candidate.color
    : "purple";
  return {
    id,
    name,
    instructions,
    model,
    effort,
    permission: access,
    retryCount,
    color,
  };
}

function normalizedAgents(values: readonly unknown[]): SavedPipelineAgent[] {
  const ids = new Set<string>();
  const agents: SavedPipelineAgent[] = [];
  for (const value of values) {
    const agent = parseSavedAgent(value);
    if (!agent || ids.has(agent.id)) continue;
    ids.add(agent.id);
    agents.push(agent);
    if (agents.length === PIPELINE_AGENT_LIBRARY_LIMIT) break;
  }
  return agents;
}

export function loadPipelineAgentLibrary(): SavedPipelineAgent[] {
  try {
    const parsed = JSON.parse(
      localStorage.getItem(PIPELINE_AGENT_LIBRARY_STORAGE_KEY) ?? "null",
    ) as unknown;
    if (!parsed || typeof parsed !== "object") return [];
    const value = parsed as Record<string, unknown>;
    if (value.schemaVersion !== SCHEMA_VERSION || !Array.isArray(value.agents)) return [];
    return normalizedAgents(value.agents);
  } catch {
    return [];
  }
}

export function savePipelineAgentLibrary(agents: readonly SavedPipelineAgent[]): boolean {
  try {
    const existing = localStorage.getItem(PIPELINE_AGENT_LIBRARY_STORAGE_KEY);
    if (existing) {
      try {
        const parsed = JSON.parse(existing) as unknown;
        if (
          parsed &&
          typeof parsed === "object" &&
          "schemaVersion" in parsed &&
          (parsed as Record<string, unknown>).schemaVersion !== SCHEMA_VERSION
        ) return false;
      } catch {
        // An explicit save may replace malformed data from this schema.
      }
    }
    const value: PersistedAgentLibrary = {
      schemaVersion: SCHEMA_VERSION,
      agents: normalizedAgents(agents),
    };
    localStorage.setItem(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function savedAgentNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function savedAgentMatchesNode(
  saved: SavedPipelineAgent,
  node: PipelineAgentNode,
): boolean {
  const normalized = savedAgentFromNode(node, saved.id);
  return Boolean(normalized &&
    saved.name === normalized.name &&
    saved.instructions === normalized.instructions &&
    saved.model === normalized.model &&
    saved.effort === normalized.effort &&
    saved.permission === normalized.permission &&
    saved.retryCount === normalized.retryCount &&
    saved.color === normalized.color);
}

export function savedAgentFromNode(
  node: PipelineAgentNode,
  id = newPipelineAgentLibraryId(),
): SavedPipelineAgent | null {
  return parseSavedAgent({
    id,
    name: node.name,
    instructions: node.instructions,
    model: node.model,
    effort: node.effort,
    permission: node.permission,
    retryCount: node.retryCount,
    color: node.color,
  });
}

function newPipelineAgentLibraryId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `saved-agent:${suffix}`;
}
