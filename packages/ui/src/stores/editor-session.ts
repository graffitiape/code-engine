import type { Tab } from "../design/types";

const SESSION_KEY = "ce.editorSessions.v1";
const MAX_PROJECT_SESSIONS = 20;

interface StoredEditorSession {
  tabs: string[];
  activeTabId: string | null;
  updatedAt: number;
}

type StoredSessions = Record<string, StoredEditorSession>;

function readSessions(): StoredSessions {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function loadEditorSession(projectPath: string): StoredEditorSession | null {
  const value = readSessions()[projectPath];
  if (!value || !Array.isArray(value.tabs)) return null;
  return {
    tabs: value.tabs.filter((path) => typeof path === "string" && !path.startsWith("untitled-")),
    activeTabId:
      typeof value.activeTabId === "string" && !value.activeTabId.startsWith("untitled-")
        ? value.activeTabId
        : null,
    updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
  };
}

export function saveEditorSession(projectPath: string, tabs: Tab[], activeTabId: string) {
  const sessions = readSessions();
  sessions[projectPath] = {
    tabs: tabs.map((tab) => tab.id).filter((path) => !path.startsWith("untitled-")),
    activeTabId: activeTabId && !activeTabId.startsWith("untitled-") ? activeTabId : null,
    updatedAt: Date.now(),
  };

  const trimmed = Object.fromEntries(
    Object.entries(sessions)
      .sort(([, left], [, right]) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_PROJECT_SESSIONS),
  );
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(trimmed));
  } catch {
    // Session restore is a convenience; editor operation must not depend on it.
  }
}
