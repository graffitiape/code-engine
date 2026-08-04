import { createSignal } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";
import { getWorkspaceRoot, setWorkspaceRoot } from "../bridge/tauri";

const LEGACY_RECENTS_KEY = "ce.recentRoots";
const PROJECTS_KEY = "ce.projects.v2";
const ACTIVE_KEY = "ce.activeRoot";
const MAX_PROJECTS = 12;

export interface Project {
  id: string;
  name: string;
  path: string;
  lastOpenedAt: number;
}

function projectName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) ?? path;
}

function projectFromPath(path: string, lastOpenedAt = Date.now()): Project {
  return {
    id: path,
    name: projectName(path),
    path,
    lastOpenedAt,
  };
}

function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .filter(
            (item): item is Project =>
              item &&
              typeof item.path === "string" &&
              typeof item.lastOpenedAt === "number",
          )
          .map((item) => ({
            ...item,
            id: item.path,
            name: projectName(item.path),
          }))
          .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
          .slice(0, MAX_PROJECTS);
      }
    }

    const legacy = localStorage.getItem(LEGACY_RECENTS_KEY);
    if (!legacy) return [];
    const paths = JSON.parse(legacy);
    if (!Array.isArray(paths)) return [];
    const now = Date.now();
    return paths
      .filter((path): path is string => typeof path === "string")
      .map((path, index) => projectFromPath(path, now - index))
      .slice(0, MAX_PROJECTS);
  } catch {
    return [];
  }
}

const [activeRoot, setActiveRootSignal] = createSignal<string | null>(null);
const [projects, setProjects] = createSignal<Project[]>(loadProjects());
const [initialized, setInitialized] = createSignal(false);
const [switching, setSwitching] = createSignal(false);
const [workspaceError, setWorkspaceError] = createSignal<string | null>(null);
const [filesVersion, setFilesVersion] = createSignal(0);
const recents = () => projects().map((project) => project.path);

let initializePromise: Promise<string | null> | null = null;
type WorkspaceSwitchGuard = (
  currentRoot: string,
  nextRoot: string,
) => boolean | Promise<boolean>;
const workspaceSwitchGuards = new Set<WorkspaceSwitchGuard>();

/** Register work that must be safely stopped before the active project changes. */
export function registerWorkspaceSwitchGuard(guard: WorkspaceSwitchGuard): () => void {
  workspaceSwitchGuards.add(guard);
  return () => workspaceSwitchGuards.delete(guard);
}

function persistProjects(list: Project[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(list.slice(0, MAX_PROJECTS)));
    localStorage.setItem(
      LEGACY_RECENTS_KEY,
      JSON.stringify(list.slice(0, MAX_PROJECTS).map((project) => project.path)),
    );
  } catch {
    // A disabled localStorage should not make opening a project fail.
  }
}

function rememberProject(path: string) {
  const next = [
    projectFromPath(path),
    ...projects().filter((project) => project.path !== path),
  ].slice(0, MAX_PROJECTS);
  setProjects(next);
  persistProjects(next);
}

/**
 * Verify and activate a project. The backend validates and canonicalizes the
 * directory before frontend state changes, so stale recents cannot displace a
 * valid current project.
 */
export async function setActiveRoot(path: string): Promise<boolean> {
  const currentRoot = activeRoot();
  if (currentRoot === path) return true;
  if (currentRoot) {
    for (const guard of workspaceSwitchGuards) {
      if (!(await guard(currentRoot, path))) return false;
    }
  }
  setSwitching(true);
  setWorkspaceError(null);
  try {
    const canonicalPath = await setWorkspaceRoot(path);
    setActiveRootSignal(canonicalPath);
    try {
      localStorage.setItem(ACTIVE_KEY, canonicalPath);
    } catch {
      // Persistence is best-effort; the active project still works this run.
    }
    rememberProject(canonicalPath);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setWorkspaceError(message);
    throw error;
  } finally {
    setSwitching(false);
  }
}

/** Restore the last valid project once for the whole application. */
export function initializeWorkspace(): Promise<string | null> {
  if (initializePromise) return initializePromise;
  initializePromise = (async () => {
    let backendRoot: string | null = null;
    try {
      backendRoot = await getWorkspaceRoot();
    } catch {
      // The frontend-persisted root is still usable after a backend restart.
    }

    let localRoot: string | null = null;
    try {
      localRoot = localStorage.getItem(ACTIVE_KEY);
    } catch {
      // localStorage can be unavailable in hardened webviews.
    }

    const candidates = [backendRoot, localRoot].filter(
      (path, index, all): path is string =>
        typeof path === "string" && all.indexOf(path) === index,
    );

    for (const candidate of candidates) {
      try {
        if (!(await setActiveRoot(candidate))) continue;
        setInitialized(true);
        return candidate;
      } catch {
        // Try the next candidate without clearing the remembered recent.
      }
    }

    setInitialized(true);
    return null;
  })();
  return initializePromise;
}

/** Backwards-compatible alias used by the editor coordinator. */
export const restoreActiveRoot = initializeWorkspace;

/** Open the native folder picker without changing project state. */
export async function chooseFolder(): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false });
  return typeof picked === "string" ? picked : null;
}

/** Open the native folder picker and activate the selected folder. */
export async function pickFolder(): Promise<string | null> {
  const picked = await chooseFolder();
  if (!picked) return null;
  return (await setActiveRoot(picked)) ? picked : null;
}

export function removeRecentProject(path: string) {
  if (path === activeRoot()) return;
  const next = projects().filter((project) => project.path !== path);
  setProjects(next);
  persistProjects(next);
}

export function clearWorkspaceError() {
  setWorkspaceError(null);
}

/** Notify mounted editor surfaces that project files may have changed externally. */
export function notifyWorkspaceFilesChanged(path: string) {
  if (path !== activeRoot()) return;
  setFilesVersion((version) => version + 1);
}

export function useWorkspace() {
  return {
    activeRoot,
    projects,
    recents,
    initialized,
    switching,
    filesVersion,
    error: workspaceError,
  };
}
