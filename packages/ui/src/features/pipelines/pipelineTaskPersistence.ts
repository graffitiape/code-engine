import { newPipelineId } from "./pipelinePersistence";
import type { PipelineRunStatus, PipelineTask, PipelineTaskAttachment } from "./types";

const STORAGE_PREFIX = "ce.pipeline-tasks.v1:";
const RUN_STATUSES = new Set<PipelineRunStatus>([
  "queued",
  "validating",
  "running",
  "needsAttention",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
]);
export const MAX_PIPELINE_TASK_IMAGES = 10;
const IMAGE_EXTENSION = /\.(?:gif|jpe?g|png|webp)$/i;

export function imageAttachment(path: string): PipelineTaskAttachment | null {
  const cleanPath = path.trim();
  if (!cleanPath || !IMAGE_EXTENSION.test(cleanPath)) return null;
  const name = cleanPath.split(/[\\/]/).pop()?.trim();
  if (!name) return null;
  return { id: cleanPath, path: cleanPath, name };
}

export function normalizeImageAttachments(value: unknown): PipelineTaskAttachment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: PipelineTaskAttachment[] = [];
  for (const entry of value) {
    const path = typeof entry === "string"
      ? entry
      : entry && typeof entry === "object" && typeof (entry as Record<string, unknown>).path === "string"
        ? String((entry as Record<string, unknown>).path)
        : "";
    const attachment = imageAttachment(path);
    const key = attachment?.path.toLowerCase();
    if (!attachment || !key || seen.has(key)) continue;
    seen.add(key);
    attachments.push(attachment);
    if (attachments.length === MAX_PIPELINE_TASK_IMAGES) break;
  }
  return attachments;
}

interface PersistedPipelineTasks {
  schemaVersion: 1;
  selectedId: string | null;
  tasks: PipelineTask[];
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseTask(value: unknown, pipelineIds: ReadonlySet<string>): PipelineTask | null {
  if (!value || typeof value !== "object") return null;
  const task = value as Record<string, unknown>;
  if (
    typeof task.id !== "string" ||
    typeof task.title !== "string" ||
    !task.title.trim() ||
    typeof task.description !== "string" ||
    !task.description.trim() ||
    typeof task.pipelineId !== "string" ||
    !pipelineIds.has(task.pipelineId)
  ) return null;
  const createdAt = typeof task.createdAt === "number" && Number.isFinite(task.createdAt)
    ? task.createdAt
    : Date.now();
  const updatedAt = typeof task.updatedAt === "number" && Number.isFinite(task.updatedAt)
    ? task.updatedAt
    : createdAt;
  const status = typeof task.lastRunStatus === "string" && RUN_STATUSES.has(task.lastRunStatus as PipelineRunStatus)
    ? task.lastRunStatus as PipelineRunStatus
    : null;
  return {
    id: task.id,
    title: task.title.trim(),
    description: task.description.trim(),
    pipelineId: task.pipelineId,
    attachments: normalizeImageAttachments(task.attachments),
    createdAt,
    updatedAt,
    runCount: Number.isInteger(task.runCount) && Number(task.runCount) >= 0 ? Number(task.runCount) : 0,
    lastRunId: nullableString(task.lastRunId),
    lastRunStatus: status,
    lastRunAt: typeof task.lastRunAt === "number" && Number.isFinite(task.lastRunAt) ? task.lastRunAt : null,
    lastOutput: nullableString(task.lastOutput),
    lastError: nullableString(task.lastError),
  };
}

export function createPipelineTask(
  title: string,
  description: string,
  pipelineId: string,
  attachments: readonly PipelineTaskAttachment[] = [],
): PipelineTask {
  const now = Date.now();
  return {
    id: newPipelineId("task"),
    title: title.trim(),
    description: description.trim(),
    pipelineId,
    attachments: normalizeImageAttachments(attachments),
    createdAt: now,
    updatedAt: now,
    runCount: 0,
    lastRunId: null,
    lastRunStatus: null,
    lastRunAt: null,
    lastOutput: null,
    lastError: null,
  };
}

export function loadPipelineTasks(
  cwd: string,
  pipelineIds: ReadonlySet<string>,
): PersistedPipelineTasks {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${STORAGE_PREFIX}${cwd}`) ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error("No saved tasks");
    const value = parsed as Record<string, unknown>;
    const tasks = Array.isArray(value.tasks)
      ? value.tasks.map((task) => parseTask(task, pipelineIds)).filter((task): task is PipelineTask => Boolean(task))
      : [];
    const selectedId = typeof value.selectedId === "string" && tasks.some((task) => task.id === value.selectedId)
      ? value.selectedId
      : tasks[0]?.id ?? null;
    return { schemaVersion: 1, selectedId, tasks };
  } catch {
    return { schemaVersion: 1, selectedId: null, tasks: [] };
  }
}

export function savePipelineTasks(
  cwd: string,
  tasks: readonly PipelineTask[],
  selectedId: string | null,
): boolean {
  try {
    localStorage.setItem(
      `${STORAGE_PREFIX}${cwd}`,
      JSON.stringify({ schemaVersion: 1, selectedId, tasks }),
    );
    return true;
  } catch {
    return false;
  }
}
