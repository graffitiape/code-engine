import { createStore } from "solid-js/store";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  codexAccountLoginCancel,
  codexAccountLoginChatgpt,
  codexAccountLoginDevice,
  codexAccountLogout,
  codexAccountRateLimits,
  codexAccountRead,
  codexModelList,
  codexPendingServerRequests,
  codexRespondServerRequest,
  codexServerRestart,
  codexServerStart,
  codexServerStatus,
  codexThreadArchive,
  codexThreadList,
  codexThreadNameSet,
  codexThreadRead,
  codexThreadResume,
  codexThreadStart,
  codexTurnInterrupt,
  codexTurnStart,
  codexTurnSteer,
  listenCodexEvents,
  listenCodexServerRequests,
  listenCodexStatus,
  openExternalUrl,
  type CodexAccountResponse,
  type CodexEventEnvelope,
  type CodexLoginResponse,
  type CodexModel,
  type CodexPermissionPreset,
  type CodexRateLimitsResponse,
  type CodexServerRequest,
  type CodexServerStatus,
  type CodexThread,
  type CodexThreadItem,
} from "../../bridge/tauri";
import { notifyWorkspaceFilesChanged } from "../../stores/workspace";
import {
  CODEX_THREAD_SOURCES,
  asRecord,
  fieldString,
  flattenThreadItems,
  permissionForThread,
  permissionForTurn,
  textInput,
} from "./types";
import { collectCursorPages } from "./cursorPages";

interface LoginState extends CodexLoginResponse {
  opened: boolean;
}

interface AgentState {
  cwd: string | null;
  server: CodexServerStatus | null;
  account: CodexAccountResponse | null;
  rateLimits: CodexRateLimitsResponse | null;
  models: CodexModel[];
  threads: CodexThread[];
  selectedThreadId: string | null;
  selectedThread: CodexThread | null;
  feedByThread: Record<string, CodexThreadItem[]>;
  activeTurnByThread: Record<string, string | null>;
  pendingRequests: CodexServerRequest[];
  model: string;
  effort: string;
  permission: CodexPermissionPreset;
  composerOpen: boolean;
  booting: boolean;
  loadingThread: boolean;
  submitting: boolean;
  login: LoginState | null;
  error: string | null;
}

const PREFS_KEY = "ce.codex.agentPrefs";

function loadPrefs(): Pick<AgentState, "model" | "effort" | "permission"> {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
    return {
      model: typeof value.model === "string" ? value.model : "",
      effort: typeof value.effort === "string" ? value.effort : "",
      permission:
        value.permission === "read-only" || value.permission === "full-access"
          ? value.permission
          : "workspace-write",
    };
  } catch {
    return { model: "", effort: "", permission: "workspace-write" };
  }
}

const prefs = loadPrefs();
const [agentState, setAgentState] = createStore<AgentState>({
  cwd: null,
  server: null,
  account: null,
  rateLimits: null,
  models: [],
  threads: [],
  selectedThreadId: null,
  selectedThread: null,
  feedByThread: {},
  activeTurnByThread: {},
  pendingRequests: [],
  ...prefs,
  composerOpen: false,
  booting: false,
  loadingThread: false,
  submitting: false,
  login: null,
  error: null,
});

let bootstrapToken = 0;

type CodexEventObserver = (event: CodexEventEnvelope) => void;
type CodexRequestObserver = (request: CodexServerRequest) => void;
type CodexStatusObserver = (status: CodexServerStatus) => void;

const eventObservers = new Set<CodexEventObserver>();
const requestObservers = new Set<CodexRequestObserver>();
const statusObservers = new Set<CodexStatusObserver>();

function notifyObservers<T>(observers: Set<(value: T) => void>, value: T) {
  for (const observer of observers) {
    try {
      observer(value);
    } catch (error) {
      console.error("[CE] Codex observer failed", error);
    }
  }
}

/** Observe raw, current-generation Codex events before Agents-page filtering. */
export function subscribeCodexEvents(observer: CodexEventObserver): () => void {
  eventObservers.add(observer);
  return () => eventObservers.delete(observer);
}

/** Observe requests from any Codex thread, including pipeline-owned threads. */
export function subscribeCodexServerRequests(observer: CodexRequestObserver): () => void {
  requestObservers.add(observer);
  return () => requestObservers.delete(observer);
}

export function subscribeCodexStatus(observer: CodexStatusObserver): () => void {
  statusObservers.add(observer);
  return () => statusObservers.delete(observer);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function persistPrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        model: agentState.model,
        effort: agentState.effort,
        permission: agentState.permission,
      }),
    );
  } catch {
    // Preferences are a convenience; private/localStorage-disabled contexts still work.
  }
}

function threadById(threadId: string): CodexThread | undefined {
  if (agentState.selectedThread?.id === threadId) return agentState.selectedThread;
  return agentState.threads.find((thread) => thread.id === threadId);
}

function threadBelongsToCurrentProject(threadId: string): boolean {
  const thread = threadById(threadId);
  return Boolean(agentState.cwd && thread?.cwd === agentState.cwd);
}

function operationIsCurrent(cwd: string, token: number): boolean {
  return bootstrapToken === token && agentState.cwd === cwd;
}

function upsertThread(thread: CodexThread) {
  if (!agentState.cwd || thread.cwd !== agentState.cwd) return;
  const next = agentState.threads.filter((entry) => entry.id !== thread.id);
  next.push(thread);
  next.sort((a, b) => b.updatedAt - a.updatedAt);
  setAgentState("threads", next);
  if (agentState.selectedThreadId === thread.id) setAgentState("selectedThread", thread);
}

function patchThread(threadId: string, patch: Partial<CodexThread>) {
  setAgentState(
    "threads",
    agentState.threads.map((thread) =>
      thread.id === threadId ? ({ ...thread, ...patch } as CodexThread) : thread,
    ),
  );
  if (agentState.selectedThread?.id === threadId) {
    setAgentState("selectedThread", { ...agentState.selectedThread, ...patch } as CodexThread);
  }
}

function removeThread(threadId: string) {
  setAgentState("threads", agentState.threads.filter((thread) => thread.id !== threadId));
  if (agentState.selectedThreadId === threadId) {
    setAgentState({
      selectedThreadId: null,
      selectedThread: null,
      composerOpen: false,
      loadingThread: false,
    });
  }
}

function upsertFeedItem(threadId: string, item: CodexThreadItem) {
  const items = agentState.feedByThread[threadId] ?? [];
  const index = items.findIndex((entry) => entry.id === item.id);
  const next = index < 0 ? [...items, item] : items.map((entry, i) => (i === index ? item : entry));
  setAgentState("feedByThread", threadId, next);
}

function appendFeedDelta(
  threadId: string,
  itemId: string,
  type: string,
  field: "text" | "aggregatedOutput",
  delta: string,
) {
  const items = agentState.feedByThread[threadId] ?? [];
  const current = items.find((item) => item.id === itemId);
  const previous = current?.[field];
  upsertFeedItem(threadId, {
    ...(current ?? { id: itemId, type }),
    [field]: `${typeof previous === "string" ? previous : ""}${delta}`,
  });
}

function addNotice(
  threadId: string | null,
  kind: "error" | "warning" | "info",
  text: string,
) {
  if (!threadId) {
    if (kind === "error") setAgentState("error", text);
    return;
  }
  upsertFeedItem(threadId, {
    id: `notice:${Date.now()}:${Math.random()}`,
    type: "notice",
    noticeKind: kind,
    text,
  });
}

async function refreshRuntimeData(cwd: string, expectedBootstrap?: number) {
  const requestIsCurrent = () =>
    agentState.cwd === cwd &&
    (expectedBootstrap === undefined || expectedBootstrap === bootstrapToken);
  const [account, models, limits, threads, requests] = await Promise.all([
    codexAccountRead(),
    codexModelList(),
    codexAccountRateLimits().catch(() => null),
    collectCursorPages({
      isCurrent: requestIsCurrent,
      maxItems: 500,
      pageSize: 100,
      loadPage: (cursor, limit) => codexThreadList({
        cwd,
        cursor,
        sourceKinds: [...CODEX_THREAD_SOURCES],
        limit,
        sortKey: "updated_at",
        sortDirection: "desc",
      }),
    }),
    codexPendingServerRequests().catch(() => []),
  ]);
  if (!threads || !requestIsCurrent()) return false;
  const visibleModels = models.data.filter((model) => !model.hidden);
  const visibleThreads = threads.filter((thread) => thread.cwd === cwd);
  const visibleThreadIds = new Set(visibleThreads.map((thread) => thread.id));
  const visibleRequests = requests.filter((request) => {
    const requestThreadId = fieldString(asRecord(request.params), "threadId");
    return !requestThreadId || visibleThreadIds.has(requestThreadId);
  });

  setAgentState("account", account);
  setAgentState("models", visibleModels);
  setAgentState("rateLimits", limits);
  setAgentState("threads", visibleThreads);
  setAgentState("pendingRequests", visibleRequests);

  const selectedModel = visibleModels.find((model) => model.model === agentState.model);
  const fallback = selectedModel ?? visibleModels.find((model) => model.isDefault) ?? visibleModels[0];
  if (fallback && fallback.model !== agentState.model) {
    setAgentState("model", fallback.model);
    setAgentState("effort", fallback.defaultReasoningEffort);
    persistPrefs();
  }
  return true;
}

export async function initializeAgents(cwd: string | null) {
  const token = ++bootstrapToken;
  // Project-bound state must disappear synchronously. Otherwise the previous
  // project's selected task remains actionable while the new list is loading.
  setAgentState({
    cwd,
    threads: [],
    selectedThreadId: null,
    selectedThread: null,
    feedByThread: {},
    activeTurnByThread: {},
    pendingRequests: [],
    composerOpen: false,
    booting: true,
    loadingThread: false,
    submitting: false,
    error: null,
  });
  if (!cwd) {
    setAgentState("booting", false);
    return;
  }
  try {
    let status = await codexServerStatus();
    if (status.state === "stopped") status = await codexServerStart();
    setAgentState("server", status);
    if (status.state === "missing" || status.state === "failed") return;
    if (!status.ready) return;
    if (!(await refreshRuntimeData(cwd, token))) return;
    const stillSelected = agentState.threads.some((thread) => thread.id === agentState.selectedThreadId);
    if (!stillSelected) {
      setAgentState("selectedThreadId", null);
      setAgentState("selectedThread", null);
    }
  } catch (error) {
    if (token === bootstrapToken) {
      setAgentState("error", messageOf(error));
      const latest = await codexServerStatus().catch(() => null);
      if (latest) setAgentState("server", latest);
    }
  } finally {
    if (token === bootstrapToken) setAgentState("booting", false);
  }
}

export async function restartCodex() {
  setAgentState({ booting: true, error: null });
  try {
    const status = await codexServerRestart();
    setAgentState("server", status);
    if (status.ready && agentState.cwd) await refreshRuntimeData(agentState.cwd);
  } catch (error) {
    setAgentState("error", messageOf(error));
    const latest = await codexServerStatus().catch(() => null);
    if (latest) setAgentState("server", latest);
  } finally {
    setAgentState("booting", false);
  }
}

export async function refreshAgents() {
  const cwd = agentState.cwd;
  if (!cwd || !agentState.server?.ready) return;
  try {
    await refreshRuntimeData(cwd);
  } catch (error) {
    if (agentState.cwd === cwd) setAgentState("error", messageOf(error));
  }
}

export async function selectAgentThread(threadId: string, cwd: string) {
  const listedThread = agentState.threads.find((thread) => thread.id === threadId);
  if (agentState.cwd !== cwd || listedThread?.cwd !== cwd) return;
  const token = bootstrapToken;
  setAgentState({ selectedThreadId: threadId, loadingThread: true, composerOpen: false, error: null });
  try {
    let response;
    try {
      response = await codexThreadResume({ threadId, cwd });
    } catch {
      response = await codexThreadRead(threadId, true);
    }
    if (
      !operationIsCurrent(cwd, token) ||
      agentState.selectedThreadId !== threadId ||
      response.thread.cwd !== cwd
    ) return;
    setAgentState("selectedThread", response.thread);
    setAgentState("feedByThread", threadId, flattenThreadItems(response.thread));
    const running = [...response.thread.turns].reverse().find((turn) => turn.status === "inProgress");
    setAgentState("activeTurnByThread", threadId, running?.id ?? null);
    upsertThread(response.thread);
  } catch (error) {
    if (operationIsCurrent(cwd, token) && agentState.selectedThreadId === threadId) {
      setAgentState("error", messageOf(error));
    }
  } finally {
    if (operationIsCurrent(cwd, token) && agentState.selectedThreadId === threadId) {
      setAgentState("loadingThread", false);
    }
  }
}

export async function createAgentTask(prompt: string, cwd: string) {
  const clean = prompt.trim();
  if (!clean || !agentState.model || agentState.cwd !== cwd) return;
  const token = bootstrapToken;
  const model = agentState.model;
  const effort = agentState.effort;
  const permissionPreset = agentState.permission;
  setAgentState({ submitting: true, error: null });
  try {
    const permission = permissionForThread(permissionPreset);
    const response = await codexThreadStart({
      cwd,
      model,
      ...permission,
      sessionStartSource: "startup",
    });
    if (operationIsCurrent(cwd, token) && response.thread.cwd === cwd) {
      upsertThread(response.thread);
      setAgentState({
        selectedThreadId: response.thread.id,
        selectedThread: response.thread,
        composerOpen: false,
      });
      setAgentState("feedByThread", response.thread.id, flattenThreadItems(response.thread));
    }
    const title = clean.split("\n")[0].slice(0, 80);
    void codexThreadNameSet(response.thread.id, title).catch(() => undefined);
    const turn = await codexTurnStart({
      threadId: response.thread.id,
      input: [textInput(clean)],
      cwd,
      model,
      effort: effort || null,
      ...permissionForTurn(permissionPreset, cwd),
    });
    if (operationIsCurrent(cwd, token) && response.thread.cwd === cwd) {
      setAgentState("activeTurnByThread", response.thread.id, turn.turn.id);
    }
  } catch (error) {
    if (operationIsCurrent(cwd, token)) setAgentState("error", messageOf(error));
  } finally {
    if (operationIsCurrent(cwd, token)) setAgentState("submitting", false);
  }
}

export async function sendAgentMessage(text: string, cwd: string) {
  const threadId = agentState.selectedThreadId;
  const clean = text.trim();
  if (
    !threadId ||
    !clean ||
    agentState.cwd !== cwd ||
    agentState.selectedThread?.id !== threadId ||
    agentState.selectedThread.cwd !== cwd
  ) return;
  const token = bootstrapToken;
  const model = agentState.model;
  const effort = agentState.effort;
  const permissionPreset = agentState.permission;
  setAgentState({ submitting: true, error: null });
  try {
    const activeTurnId = agentState.activeTurnByThread[threadId];
    if (activeTurnId) {
      await codexTurnSteer(threadId, activeTurnId, [textInput(clean)]);
    } else {
      await codexThreadResume({ threadId, cwd });
      const response = await codexTurnStart({
        threadId,
        input: [textInput(clean)],
        cwd,
        model: model || null,
        effort: effort || null,
        ...permissionForTurn(permissionPreset, cwd),
      });
      if (operationIsCurrent(cwd, token) && threadBelongsToCurrentProject(threadId)) {
        setAgentState("activeTurnByThread", threadId, response.turn.id);
      }
    }
  } catch (error) {
    if (operationIsCurrent(cwd, token)) setAgentState("error", messageOf(error));
  } finally {
    if (operationIsCurrent(cwd, token)) setAgentState("submitting", false);
  }
}

export async function interruptAgentTurn() {
  const threadId = agentState.selectedThreadId;
  const turnId = threadId ? agentState.activeTurnByThread[threadId] : null;
  if (!threadId || !turnId || !threadBelongsToCurrentProject(threadId)) return;
  const cwd = agentState.cwd!;
  try {
    await codexTurnInterrupt(threadId, turnId);
  } catch (error) {
    if (agentState.cwd === cwd) setAgentState("error", messageOf(error));
  }
}

export async function archiveAgentThread(threadId: string) {
  if (!threadBelongsToCurrentProject(threadId)) return;
  const cwd = agentState.cwd!;
  try {
    await codexThreadArchive(threadId);
    if (agentState.cwd === cwd) removeThread(threadId);
  } catch (error) {
    if (agentState.cwd === cwd) setAgentState("error", messageOf(error));
  }
}

export async function renameAgentThread(threadId: string, name: string) {
  const clean = name.trim();
  if (!clean || !threadBelongsToCurrentProject(threadId)) return;
  const cwd = agentState.cwd!;
  try {
    await codexThreadNameSet(threadId, clean);
    if (agentState.cwd === cwd) patchThread(threadId, { name: clean });
  } catch (error) {
    if (agentState.cwd === cwd) setAgentState("error", messageOf(error));
  }
}

export async function loginWithChatgpt(deviceCode = false) {
  setAgentState({ submitting: true, error: null });
  try {
    const login = deviceCode
      ? await codexAccountLoginDevice()
      : await codexAccountLoginChatgpt();
    setAgentState("login", { ...login, opened: false });
    const url = login.authUrl ?? login.verificationUrl;
    if (url) {
      await openExternalUrl(url);
      setAgentState("login", "opened", true);
    }
  } catch (error) {
    setAgentState("error", messageOf(error));
  } finally {
    setAgentState("submitting", false);
  }
}

export async function cancelAgentLogin() {
  const loginId = agentState.login?.loginId;
  if (!loginId) return;
  await codexAccountLoginCancel(loginId).catch(() => undefined);
  setAgentState("login", null);
}

export async function logoutAgentAccount() {
  try {
    await codexAccountLogout();
    setAgentState({ account: null, rateLimits: null, login: null });
    if (agentState.cwd) await refreshRuntimeData(agentState.cwd).catch(() => undefined);
  } catch (error) {
    setAgentState("error", messageOf(error));
  }
}

export async function respondToServerRequest(requestId: string | number, response: unknown) {
  const cwd = agentState.cwd;
  const request = agentState.pendingRequests.find((entry) => entry.id === requestId);
  if (!request) return;
  await codexRespondServerRequest(requestId, response);
  if (agentState.cwd !== cwd) return;
  setAgentState(
    "pendingRequests",
    agentState.pendingRequests.filter((request) => request.id !== requestId),
  );
}

export function setAgentModel(model: string) {
  setAgentState("model", model);
  const match = agentState.models.find((entry) => entry.model === model);
  if (match) setAgentState("effort", match.defaultReasoningEffort);
  persistPrefs();
}

export function setAgentEffort(effort: string) {
  setAgentState("effort", effort);
  persistPrefs();
}

export function setAgentPermission(permission: CodexPermissionPreset) {
  setAgentState("permission", permission);
  persistPrefs();
}

export function setAgentComposerOpen(open: boolean) {
  setAgentState("composerOpen", open);
}

export function clearAgentError() {
  setAgentState("error", null);
}

function handleCodexEvent(event: CodexEventEnvelope) {
  if (agentState.server && event.generation < agentState.server.generation) return;
  notifyObservers(eventObservers, event);
  const params = asRecord(event.params);
  const threadId = fieldString(params, "threadId");
  const turnId = fieldString(params, "turnId");
  const itemId = fieldString(params, "itemId");

  if (event.method === "thread/started") {
    const thread = params.thread as CodexThread | undefined;
    if (thread?.id && thread.cwd === agentState.cwd) upsertThread(thread);
    return;
  }
  if (threadId && !threadBelongsToCurrentProject(threadId)) return;

  switch (event.method) {
    case "account/updated":
      if (agentState.cwd) void refreshRuntimeData(agentState.cwd);
      break;
    case "account/login/completed": {
      const success = params.success === true;
      if (success) {
        setAgentState("login", null);
        if (agentState.cwd) void refreshRuntimeData(agentState.cwd);
      } else {
        setAgentState("error", fieldString(params, "error") ?? "ChatGPT login failed");
      }
      break;
    }
    case "account/rateLimits/updated":
      void codexAccountRateLimits().then((limits) => setAgentState("rateLimits", limits));
      break;
    case "thread/status/changed":
      if (threadId && params.status) patchThread(threadId, { status: params.status as CodexThread["status"] });
      break;
    case "thread/name/updated":
      if (threadId) patchThread(threadId, { name: fieldString(params, "threadName") });
      break;
    case "thread/archived":
      if (threadId) removeThread(threadId);
      break;
    case "serverRequest/resolved": {
      const requestId = params.requestId;
      setAgentState(
        "pendingRequests",
        agentState.pendingRequests.filter((request) => request.id !== requestId),
      );
      break;
    }
    case "turn/started": {
      const turn = params.turn as { id?: string; items?: CodexThreadItem[] } | undefined;
      if (threadId && turn?.id) {
        setAgentState("activeTurnByThread", threadId, turn.id);
        for (const item of turn.items ?? []) upsertFeedItem(threadId, item);
      }
      break;
    }
    case "turn/completed": {
      const turn = params.turn as { id?: string; items?: CodexThreadItem[] } | undefined;
      if (threadId) {
        const thread = threadById(threadId);
        setAgentState("activeTurnByThread", threadId, null);
        for (const item of turn?.items ?? []) upsertFeedItem(threadId, item);
        if (thread) notifyWorkspaceFilesChanged(thread.cwd);
        void refreshAgents();
      }
      break;
    }
    case "item/started":
    case "item/completed":
      if (threadId && params.item) upsertFeedItem(threadId, params.item as CodexThreadItem);
      break;
    case "item/agentMessage/delta":
      if (threadId && itemId) appendFeedDelta(threadId, itemId, "agentMessage", "text", fieldString(params, "delta") ?? "");
      break;
    case "item/plan/delta":
      if (threadId && itemId) appendFeedDelta(threadId, itemId, "plan", "text", fieldString(params, "delta") ?? "");
      break;
    case "item/reasoning/summaryTextDelta":
      if (threadId && itemId) appendFeedDelta(threadId, itemId, "reasoning", "text", fieldString(params, "delta") ?? "");
      break;
    case "item/commandExecution/outputDelta":
      if (threadId && itemId) appendFeedDelta(threadId, itemId, "commandExecution", "aggregatedOutput", fieldString(params, "delta") ?? "");
      break;
    case "turn/diff/updated":
      if (threadId && turnId) {
        upsertFeedItem(threadId, {
          id: `diff:${turnId}`,
          type: "turnDiff",
          diff: fieldString(params, "diff") ?? "",
        });
      }
      break;
    case "turn/plan/updated":
      if (threadId && turnId) {
        upsertFeedItem(threadId, {
          id: `turn-plan:${turnId}`,
          type: "turnPlan",
          title: fieldString(params, "explanation") ?? "Plan",
          plan: Array.isArray(params.plan) ? (params.plan as Array<{ step: string; status: string }>) : [],
        });
      }
      break;
    case "thread/compacted":
      if (threadId && turnId) {
        upsertFeedItem(threadId, {
          id: `compaction:${turnId}`,
          type: "contextCompaction",
        });
      }
      break;
    case "error": {
      const error = asRecord(params.error);
      addNotice(threadId, "error", fieldString(error, "message") ?? "Codex turn failed");
      break;
    }
    case "warning":
      addNotice(threadId, "warning", fieldString(params, "message") ?? "Codex warning");
      break;
  }
}

function handleServerRequest(request: CodexServerRequest) {
  if (agentState.server && request.generation < agentState.server.generation) return;
  notifyObservers(requestObservers, request);
  const threadId = fieldString(asRecord(request.params), "threadId");
  if (threadId && !threadBelongsToCurrentProject(threadId)) return;
  if (agentState.pendingRequests.some((entry) => entry.id === request.id)) return;
  setAgentState("pendingRequests", [...agentState.pendingRequests, request]);
}

let listenerConnection: Promise<UnlistenFn[]> | null = null;
let listenerConsumers = 0;

export async function connectAgentListeners(): Promise<() => void> {
  listenerConsumers += 1;
  if (!listenerConnection) listenerConnection = Promise.all([
    listenCodexStatus((status) => {
      notifyObservers(statusObservers, status);
      const previous = agentState.server;
      setAgentState("server", status);
      if (status.ready && (!previous?.ready || previous.generation !== status.generation) && agentState.cwd) {
        const cwd = agentState.cwd;
        void refreshRuntimeData(cwd).catch((error) => {
          if (agentState.cwd === cwd) setAgentState("error", messageOf(error));
        });
      }
    }),
    listenCodexEvents(handleCodexEvent),
    listenCodexServerRequests(handleServerRequest),
  ]);
  try {
    await listenerConnection;
  } catch (error) {
    listenerConsumers = Math.max(0, listenerConsumers - 1);
    if (listenerConsumers === 0) listenerConnection = null;
    throw error;
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    listenerConsumers = Math.max(0, listenerConsumers - 1);
    if (listenerConsumers > 0) return;
    const connection = listenerConnection;
    listenerConnection = null;
    void connection?.then((unlisteners) => {
      for (const unlisten of unlisteners) unlisten();
    });
  };
}

export function useAgentState() {
  return agentState;
}
