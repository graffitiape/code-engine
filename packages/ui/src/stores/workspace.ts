import { createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import {
  getWorkspaceRoot,
  readDir,
  setWorkspaceRoot,
  type FsNode,
} from "../bridge/tauri";

const RECENTS_KEY = "ce.recentRoots";
const ACTIVE_KEY = "ce.activeRoot";

const [activeRoot, setActiveRootSig] = createSignal<string | null>(null);
const [recents, setRecents] = createSignal<string[]>(loadRecents());

function loadRecents(): string[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((s) => typeof s === "string") : [];
  } catch {
    return [];
  }
}

function persistRecents(list: string[]) {
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

/** Set the active root, persist locally, and inform the backend. */
export async function setActiveRoot(path: string | null): Promise<void> {
  setActiveRootSig(path);
  if (path) {
    try {
      localStorage.setItem(ACTIVE_KEY, path);
    } catch {
      /* ignore */
    }
    const next = [path, ...recents().filter((r) => r !== path)];
    setRecents(next);
    persistRecents(next);
    await setWorkspaceRoot(path);
  } else {
    try {
      localStorage.removeItem(ACTIVE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/** Restore the most recent root on app start, if it still exists. */
export async function restoreActiveRoot(): Promise<string | null> {
  // Backend may already have one set (rare; survives only across hot reload).
  let backendRoot: string | null = null;
  try {
    backendRoot = await getWorkspaceRoot();
  } catch {
    backendRoot = null;
  }
  const local = (() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  })();
  const candidate = backendRoot ?? local;
  if (!candidate) return null;
  // Verify the path still exists by trying to read it.
  try {
    await readDir(candidate);
    setActiveRootSig(candidate);
    await setWorkspaceRoot(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/** Open a system folder picker; if the user picks one, activate it. */
export async function pickFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return null;
  await setActiveRoot(picked);
  return picked;
}

export function useWorkspace() {
  return {
    activeRoot,
    recents,
  };
}

export type { FsNode };
