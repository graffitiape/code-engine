// Open text buffers keyed by absolute path (or an explicit untitled id).
// Read failures never become writable empty buffers: callers receive the error
// and must decide how to present it.

import { createSignal } from "solid-js";
import { readFileText, writeFileText } from "../bridge/tauri";

export interface BufferState {
  path: string;
  saved: string;
  content: string;
  cursor: { line: number; col: number };
  untitled: boolean;
  /** Disk contents discovered while this dirty buffer was open. */
  externalContent: string | null;
  missingOnDisk: boolean;
}

export interface DiskRefreshResult {
  path: string;
  state: "reloaded" | "conflict" | "missing";
}

const buffers = new Map<string, BufferState>();
const [activePath, setActivePathSignal] = createSignal<string | null>(null);
const [version, bumpVersion] = createSignal(0);

function nudge() {
  bumpVersion((value) => value + 1);
}

function makeBuffer(path: string, content: string, untitled: boolean): BufferState {
  return {
    path,
    saved: content,
    content,
    cursor: { line: 1, col: 1 },
    untitled,
    externalContent: null,
    missingOnDisk: false,
  };
}

/** Load a readable UTF-8 file. Errors are intentionally propagated. */
export async function ensureBuffer(path: string): Promise<BufferState> {
  const existing = buffers.get(path);
  if (existing) return existing;

  const saved = await readFileText(path);
  const buffer = makeBuffer(path, saved, false);
  buffers.set(path, buffer);
  nudge();
  return buffer;
}

export function createUntitledBuffer(id: string, content = ""): BufferState {
  const existing = buffers.get(id);
  if (existing) return existing;
  const buffer = makeBuffer(id, content, true);
  buffers.set(id, buffer);
  nudge();
  return buffer;
}

export function getBuffer(path: string | null): BufferState | null {
  if (!path) return null;
  return buffers.get(path) ?? null;
}

export function setActivePath(path: string | null) {
  setActivePathSignal(path);
}

export function activeBufferPath() {
  return activePath();
}

export function listBufferPaths(): string[] {
  void version();
  return Array.from(buffers.keys());
}

export function getDirtyBufferPaths(): string[] {
  void version();
  return Array.from(buffers.values())
    .filter((buffer) => buffer.content !== buffer.saved)
    .map((buffer) => buffer.path);
}

export function hasDirtyBuffers(): boolean {
  return getDirtyBufferPaths().length > 0;
}

export function isDirty(path: string): boolean {
  const buffer = buffers.get(path);
  return Boolean(buffer && buffer.content !== buffer.saved);
}

export function isUntitled(path: string): boolean {
  return buffers.get(path)?.untitled ?? path.startsWith("untitled-");
}

export function updateContent(path: string, content: string) {
  const buffer = buffers.get(path);
  if (!buffer || buffer.content === content) return;
  buffer.content = content;
  nudge();
}

export function updateCursor(path: string, line: number, col: number) {
  const buffer = buffers.get(path);
  if (!buffer) return;
  buffer.cursor = { line, col };
  nudge();
}

/** Persist a normal file. Untitled and conflicted buffers require an explicit flow. */
export async function saveBuffer(path: string, force = false): Promise<void> {
  const buffer = buffers.get(path);
  if (!buffer) throw new Error(`Buffer is not open: ${path}`);
  if (buffer.untitled) throw new Error("Choose a file name before saving this buffer.");
  if (!force && (buffer.externalContent !== null || buffer.missingOnDisk)) {
    throw new Error("The file changed on disk. Resolve the conflict before saving.");
  }

  await writeFileText(path, buffer.content, force ? null : buffer.saved);
  buffer.saved = buffer.content;
  buffer.externalContent = null;
  buffer.missingOnDisk = false;
  nudge();
}

/** Save an untitled buffer (or a copy of an existing buffer) to an absolute path. */
export async function saveBufferAs(from: string, destination: string): Promise<BufferState> {
  const buffer = buffers.get(from);
  if (!buffer) throw new Error(`Buffer is not open: ${from}`);
  if (buffers.has(destination) && destination !== from) {
    throw new Error("That file is already open.");
  }

  await writeFileText(destination, buffer.content, null);
  const moved: BufferState = {
    ...buffer,
    path: destination,
    saved: buffer.content,
    untitled: false,
    externalContent: null,
    missingOnDisk: false,
  };
  buffers.delete(from);
  buffers.set(destination, moved);
  if (activePath() === from) setActivePathSignal(destination);
  nudge();
  return moved;
}

/**
 * Refresh open files after an agent or external tool writes to disk. Clean
 * buffers reload automatically; dirty buffers retain both versions for an
 * explicit conflict choice.
 */
export async function refreshBuffersFromDisk(): Promise<DiskRefreshResult[]> {
  const results: DiskRefreshResult[] = [];
  const candidates = Array.from(buffers.values()).filter((buffer) => !buffer.untitled);

  await Promise.all(
    candidates.map(async (buffer) => {
      try {
        const disk = await readFileText(buffer.path);
        buffer.missingOnDisk = false;
        if (disk === buffer.saved) return;
        if (buffer.content === buffer.saved) {
          buffer.saved = disk;
          buffer.content = disk;
          buffer.externalContent = null;
          results.push({ path: buffer.path, state: "reloaded" });
        } else {
          buffer.externalContent = disk;
          results.push({ path: buffer.path, state: "conflict" });
        }
      } catch {
        buffer.missingOnDisk = true;
        results.push({ path: buffer.path, state: "missing" });
      }
    }),
  );

  if (results.length) nudge();
  return results;
}

export function acceptExternalVersion(path: string) {
  const buffer = buffers.get(path);
  if (!buffer || buffer.externalContent === null) return;
  buffer.saved = buffer.externalContent;
  buffer.content = buffer.externalContent;
  buffer.externalContent = null;
  buffer.missingOnDisk = false;
  nudge();
}

/** Explicitly overwrite the changed/missing disk file with the open buffer. */
export async function keepLocalVersion(path: string): Promise<void> {
  const buffer = buffers.get(path);
  if (!buffer) return;
  await saveBuffer(path, true);
}

/** Remap an open file or every open child of a renamed directory. */
export function remapBufferPaths(source: string, destination: string) {
  const affected = Array.from(buffers.entries()).filter(
    ([path]) => path === source || path.startsWith(`${source}/`),
  );
  if (!affected.length) return;

  for (const [oldPath, buffer] of affected) {
    const newPath = `${destination}${oldPath.slice(source.length)}`;
    if (buffers.has(newPath) && !affected.some(([path]) => path === newPath)) {
      throw new Error(`That path is already open: ${newPath}`);
    }
    buffers.delete(oldPath);
    buffer.path = newPath;
    buffers.set(newPath, buffer);
  }
  const active = activePath();
  if (active === source || active?.startsWith(`${source}/`)) {
    setActivePathSignal(`${destination}${active.slice(source.length)}`);
  }
  nudge();
}

export function closeBuffer(path: string) {
  buffers.delete(path);
  if (activePath() === path) setActivePathSignal(null);
  nudge();
}

export function clearBuffers() {
  buffers.clear();
  setActivePathSignal(null);
  nudge();
}

export function useBuffersVersion() {
  return version;
}
