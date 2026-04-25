// Buffer store — open files keyed by absolute path. Tracks original content
// (last save / disk read), current content, dirty state, and cursor.

import { createSignal } from "solid-js";
import { readFileText, writeFileText } from "../bridge/tauri";

export interface BufferState {
  path: string;
  /** Last contents we saw on disk (or last save). Used to compute dirty. */
  saved: string;
  /** Live editor contents. */
  content: string;
  /** Cursor position (line/col, 1-based). */
  cursor: { line: number; col: number };
}

const buffers = new Map<string, BufferState>();
const [activePath, setActivePathSig] = createSignal<string | null>(null);
const [version, bumpVersion] = createSignal(0); // forces re-renders

function nudge() {
  bumpVersion((v) => v + 1);
}

/** Make sure the file is loaded into the buffer store. Returns the buffer. */
export async function ensureBuffer(path: string): Promise<BufferState> {
  let buf = buffers.get(path);
  if (!buf) {
    let saved = "";
    try {
      saved = await readFileText(path);
    } catch (e) {
      // Treat missing/binary files as empty — user can still see the tab and
      // an error in the editor surface.
      console.warn("[CE] read_file_text failed:", e);
      saved = "";
    }
    buf = {
      path,
      saved,
      content: saved,
      cursor: { line: 1, col: 1 },
    };
    buffers.set(path, buf);
    nudge();
  }
  return buf;
}

export function getBuffer(path: string | null): BufferState | null {
  if (!path) return null;
  return buffers.get(path) ?? null;
}

export function setActivePath(path: string | null) {
  setActivePathSig(path);
}

export function activeBufferPath() {
  return activePath();
}

export function listBufferPaths(): string[] {
  void version();
  return Array.from(buffers.keys());
}

export function isDirty(path: string): boolean {
  const b = buffers.get(path);
  if (!b) return false;
  return b.content !== b.saved;
}

/** Update the live content for a buffer (called by the editor on every keystroke). */
export function updateContent(path: string, content: string) {
  const b = buffers.get(path);
  if (!b) return;
  b.content = content;
  nudge();
}

export function updateCursor(path: string, line: number, col: number) {
  const b = buffers.get(path);
  if (!b) return;
  b.cursor = { line, col };
  nudge();
}

/** Persist the buffer to disk and reset dirty state. */
export async function saveBuffer(path: string): Promise<void> {
  const b = buffers.get(path);
  if (!b) return;
  await writeFileText(path, b.content);
  b.saved = b.content;
  nudge();
}

/** Drop a buffer (called when its tab closes). */
export function closeBuffer(path: string) {
  buffers.delete(path);
  nudge();
}

/** Drop every buffer (workspace switch). */
export function clearBuffers() {
  buffers.clear();
  setActivePathSig(null);
  nudge();
}

export function useBuffersVersion() {
  return version;
}
