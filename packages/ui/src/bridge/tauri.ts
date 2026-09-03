import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AppSettings } from "./types";
import type {
  LspMessageEvent,
  LspServerStatusEvent,
} from "../features/lsp/types";

/** One filesystem entry returned by `read_dir`. */
export interface FsNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  is_symlink: boolean;
}

export interface TrashEntry {
  originalPath: string;
  trashedPath: string;
}

/** Single git file status row. */
export interface GitFileStatus {
  path: string;
  state: "staged" | "unstaged" | "untracked" | "conflicted";
  kind: string;
}

/** Aggregate repo status for the GitPanel. */
export interface GitRepoStatus {
  repoRoot: string;
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export type GitIdentityScope = "project" | "global";

export interface GitIdentityInfo {
  name: string | null;
  email: string | null;
  scope: "project" | "global" | "mixed" | "missing";
  configured: boolean;
}

export interface GitRemoteInfo {
  name: string;
  displayUrl: string;
  webUrl: string | null;
  provider: "github" | "azure-devops" | "gitlab" | "bitbucket" | "generic";
  transport: "https" | "ssh" | "local" | "other";
  host: string | null;
}

export interface GitRepositoryInfo {
  identity: GitIdentityInfo;
  remote: GitRemoteInfo | null;
  upstream: string | null;
  credentialHelper: string;
}

export type GitDiffKind = "staged" | "unstaged" | "untracked";

export interface GitDiffResult {
  repoRoot: string;
  path: string | null;
  kind: GitDiffKind;
  patch: string;
  binary: boolean;
  truncated: boolean;
}

export interface GitLogEntry {
  id: string;
  shortId: string;
  summary: string;
  message: string;
  authorName: string;
  authorEmail: string;
  timestamp: number;
  timezoneOffsetMinutes: number;
  parentIds: string[];
}

export interface GitBranchInfo {
  name: string;
  kind: "local" | "remote";
  current: boolean;
  upstream: string | null;
  target: string | null;
}

export interface GitStashResult {
  id: string;
  message: string;
  status: GitRepoStatus;
}

export interface SearchRequest {
  query: string;
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  maxResults?: number;
  maxFileSizeBytes?: number;
}

export interface SearchMatch {
  path: string;
  relativePath: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  preview: string;
  matchedText: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  truncated: boolean;
  filesScanned: number;
  skippedBinaryFiles: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
}

export interface ReplaceRequest {
  search: SearchRequest;
  replacement: string;
  confirmed: boolean;
  maxReplacements?: number;
}

export interface ReplaceResult {
  filesChanged: number;
  replacements: number;
  skippedBinaryFiles: number;
  skippedOversizedFiles: number;
  skippedUnreadableFiles: number;
}

/** Get app settings */
export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

/** Save app settings */
export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("save_settings", { settings });
}

/** Set the active workspace root (folder shown in the sidebar). */
export async function setWorkspaceRoot(path: string): Promise<string> {
  return invoke("set_workspace_root", { path });
}

/** Get the active workspace root, or null if none. */
export async function getWorkspaceRoot(): Promise<string | null> {
  return invoke("get_workspace_root");
}

/** Shallow read of a directory. */
export async function readDir(path: string): Promise<FsNode[]> {
  return invoke("read_dir", { path });
}

/** Read a UTF-8 text file. */
export async function readFileText(path: string): Promise<string> {
  return invoke("read_file_text", { path });
}

/**
 * Write a UTF-8 text file. Normal editor saves pass the contents that were
 * originally read so the backend can reject a stale compare-before-write.
 * An omitted/null expectation is reserved for explicit overwrite flows.
 */
export async function writeFileText(
  path: string,
  contents: string,
  expectedContents?: string | null,
): Promise<void> {
  return invoke("write_file_text", { path, contents, expectedContents });
}

export async function createFile(path: string, contents?: string): Promise<void> {
  return invoke("create_file", { path, contents });
}

export async function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export async function renamePath(source: string, destination: string): Promise<void> {
  return invoke("rename_path", { source, destination });
}

export async function trashPath(path: string): Promise<TrashEntry> {
  return invoke("trash_path", { path });
}

export async function listTrash(): Promise<TrashEntry[]> {
  return invoke("list_trash");
}

export async function restoreFromTrash(entry: TrashEntry): Promise<void> {
  return invoke("restore_from_trash", { entry });
}

/** Get repo status for a directory containing a .git. */
export async function gitStatus(path: string): Promise<GitRepoStatus> {
  return invoke("git_status", { path });
}

export async function gitRepositoryInfo(path: string): Promise<GitRepositoryInfo> {
  return invoke("git_repository_info", { path });
}

export async function gitSetIdentity(
  path: string,
  name: string,
  email: string,
  scope: GitIdentityScope,
): Promise<GitRepositoryInfo> {
  return invoke("git_set_identity", { path, name, email, scope });
}

export async function gitDiff(
  path: string,
  filePath: string | undefined,
  kind: GitDiffKind,
  maxBytes?: number,
): Promise<GitDiffResult> {
  return invoke("git_diff", { path, filePath, kind, maxBytes });
}

export async function gitStageFile(path: string, filePath: string): Promise<GitRepoStatus> {
  return invoke("git_stage_file", { path, filePath });
}

export async function gitUnstageFile(path: string, filePath: string): Promise<GitRepoStatus> {
  return invoke("git_unstage_file", { path, filePath });
}

export async function gitStageAll(path: string): Promise<GitRepoStatus> {
  return invoke("git_stage_all", { path });
}

export async function gitUnstageAll(path: string): Promise<GitRepoStatus> {
  return invoke("git_unstage_all", { path });
}

export async function gitCommit(path: string, message: string): Promise<GitLogEntry> {
  return invoke("git_commit", { path, message });
}

export async function gitPush(path: string): Promise<string> {
  return invoke("git_push", { path });
}

export async function gitPublishBranch(path: string): Promise<string> {
  return invoke("git_publish_branch", { path });
}

export async function gitCheckRemoteAccess(path: string): Promise<string> {
  return invoke("git_check_remote_access", { path });
}

export async function gitStash(path: string, message?: string): Promise<GitStashResult> {
  return invoke("git_stash", { path, message });
}

export async function gitRecentLog(path: string, limit?: number): Promise<GitLogEntry[]> {
  return invoke("git_recent_log", { path, limit });
}

export async function gitBranches(path: string): Promise<GitBranchInfo[]> {
  return invoke("git_branches", { path });
}

export async function gitCheckoutBranch(
  path: string,
  branchName: string,
): Promise<GitBranchInfo> {
  return invoke("git_checkout_branch", { path, branchName });
}

export async function searchWorkspace(
  path: string,
  request: SearchRequest,
): Promise<SearchResult> {
  return invoke("search_workspace", { path, request });
}

export async function replaceAllWorkspace(
  path: string,
  request: ReplaceRequest,
): Promise<ReplaceResult> {
  return invoke("replace_all_workspace", { path, request });
}

// ---------------------------------------------------------------------------
// Language server bridge
// ---------------------------------------------------------------------------

export async function lspStart(
  path: string,
  serverId: string,
): Promise<LspServerStatusEvent> {
  return invoke("lsp_start", { path, serverId });
}

export async function lspSend(
  path: string,
  serverId: string,
  generation: number,
  message: string,
): Promise<void> {
  return invoke("lsp_send", { path, serverId, generation, message });
}

export async function lspStop(
  path: string,
  serverId: string,
  generation: number,
): Promise<LspServerStatusEvent> {
  return invoke("lsp_stop", { path, serverId, generation });
}

export async function lspStatuses(path: string): Promise<LspServerStatusEvent[]> {
  return invoke("lsp_statuses", { path });
}

export async function lspStopAll(path: string): Promise<LspServerStatusEvent[]> {
  return invoke("lsp_stop_all", { path });
}

export function listenLspMessages(
  handler: (event: LspMessageEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<LspMessageEvent>("lsp:message", (event) => handler(event.payload));
}

export function listenLspStatus(
  handler: (status: LspServerStatusEvent) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<LspServerStatusEvent>("lsp:status", (event) => handler(event.payload));
}

/** Recursively list every non-ignored file under the workspace root. */
export async function listWorkspaceFiles(
  path: string,
  max?: number,
): Promise<string[]> {
  return invoke("list_workspace_files", { path, max });
}

/** Mirror the macOS "double-click a title bar to" behavior. Reads the user's
 *  system pref and either minimizes or zooms the window. */
export async function titlebarDoubleClick(): Promise<void> {
  return invoke("titlebar_double_click");
}

/** Begin an OS-level window drag from a custom titlebar surface. */
export async function startWindowDrag(): Promise<void> {
  return getCurrentWindow().startDragging();
}

// ---------------------------------------------------------------------------
// Codex app-server bridge
// ---------------------------------------------------------------------------

export type CodexServerState =
  | "missing"
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "failed";

export interface CodexServerStatus {
  state: CodexServerState;
  running: boolean;
  ready: boolean;
  generation: number;
  codexPath: string | null;
  version: string | null;
  lastError: string | null;
}

export type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string | null; planType: string }
  | { type: "amazonBedrock"; credentialSource?: unknown };

export interface CodexAccountResponse {
  account: CodexAccount | null;
  requiresOpenaiAuth: boolean;
}

export interface CodexRateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | null;
  resetsAt: number | null;
}

export interface CodexRateLimitSnapshot {
  limitId: string | null;
  limitName: string | null;
  primary: CodexRateLimitWindow | null;
  secondary: CodexRateLimitWindow | null;
  planType?: string | null;
  rateLimitReachedType?: string | null;
  credits?: unknown;
  individualLimit?: unknown;
}

export interface CodexRateLimitsResponse {
  rateLimits: CodexRateLimitSnapshot;
  rateLimitsByLimitId: Record<string, CodexRateLimitSnapshot> | null;
  rateLimitResetCredits?: unknown;
}

export interface CodexReasoningEffortOption {
  reasoningEffort: string;
  description: string;
}

export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  description: string;
  hidden: boolean;
  supportedReasoningEfforts: CodexReasoningEffortOption[];
  defaultReasoningEffort: string;
  isDefault: boolean;
  inputModalities?: string[];
  supportsPersonality?: boolean;
}

export interface CodexModelListResponse {
  data: CodexModel[];
  nextCursor: string | null;
}

export type CodexThreadSourceKind =
  | "appServer"
  | "cli"
  | "vscode"
  | "exec"
  | "unknown";

export type CodexThreadStatus =
  | { type: "notLoaded" | "idle" | "systemError" }
  | { type: "active"; activeFlags: string[] };

export interface CodexUserInput {
  type: "text" | "image" | "localImage" | "skill" | "mention";
  text?: string;
  path?: string;
  url?: string;
  name?: string;
  text_elements?: unknown[];
}

export interface CodexFileChange {
  path: string;
  kind: string;
  diff: string;
}

/** App-server thread items plus a few UI-only event rows. */
export interface CodexThreadItem {
  type: string;
  id: string;
  phase?: string;
  text?: string;
  content?: CodexUserInput[] | string[];
  summary?: string[];
  command?: string;
  cwd?: string;
  status?: string;
  aggregatedOutput?: string | null;
  exitCode?: number | null;
  durationMs?: number | null;
  changes?: CodexFileChange[];
  diff?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: unknown;
  error?: unknown;
  noticeKind?: "error" | "warning" | "info";
  title?: string;
  plan?: Array<{ step: string; status: string }>;
  [key: string]: unknown;
}

export interface CodexTurn {
  id: string;
  items: CodexThreadItem[];
  status: "completed" | "interrupted" | "failed" | "inProgress";
  error: unknown | null;
  startedAt: number | null;
  completedAt: number | null;
  durationMs: number | null;
}

export interface CodexThread {
  id: string;
  preview: string;
  cwd: string;
  source: CodexThreadSourceKind | Record<string, unknown>;
  status: CodexThreadStatus;
  name: string | null;
  modelProvider: string;
  createdAt: number;
  updatedAt: number;
  cliVersion: string;
  turns: CodexTurn[];
  [key: string]: unknown;
}

export interface CodexThreadListResponse {
  data: CodexThread[];
  nextCursor: string | null;
  backwardsCursor?: string | null;
}

export interface CodexThreadResponse {
  thread: CodexThread;
  model?: string;
  reasoningEffort?: string | null;
}

export type CodexPermissionPreset = "read-only" | "workspace-write" | "full-access";

export interface CodexThreadListParams {
  cursor?: string | null;
  limit?: number | null;
  sourceKinds: CodexThreadSourceKind[];
  cwd: string | string[];
  archived?: boolean | null;
  searchTerm?: string | null;
  sortKey?: "created_at" | "updated_at" | "recency_at";
  sortDirection?: "asc" | "desc";
}

export interface CodexThreadStartParams {
  cwd: string;
  model: string;
  approvalPolicy: "untrusted" | "on-request" | "never";
  sandbox: "read-only" | "workspace-write" | "danger-full-access";
  sessionStartSource?: "startup" | "clear";
  developerInstructions?: string;
}

export interface CodexThreadResumeParams {
  threadId: string;
  cwd: string;
}

export interface CodexTurnStartParams {
  threadId: string;
  input: CodexUserInput[];
  cwd: string;
  clientUserMessageId?: string;
  model?: string | null;
  effort?: string | null;
  approvalPolicy?: "untrusted" | "on-request" | "never";
  sandboxPolicy?:
    | { type: "readOnly"; networkAccess: boolean }
    | {
        type: "workspaceWrite";
        writableRoots: string[];
        networkAccess: boolean;
        excludeTmpdirEnvVar: boolean;
        excludeSlashTmp: boolean;
      }
    | { type: "dangerFullAccess" };
}

export interface CodexTurnResponse {
  turn: CodexTurn;
}

export interface CodexEventEnvelope {
  generation: number;
  method: string;
  params: Record<string, unknown>;
}

export interface CodexServerRequest {
  generation: number;
  id: string | number;
  method: string;
  params: Record<string, unknown>;
  receivedAtMs: number;
}

export interface CodexLoginResponse {
  type: "chatgpt" | "chatgptDeviceCode";
  loginId: string;
  authUrl?: string;
  verificationUrl?: string;
  userCode?: string;
}

async function codexInvoke<T>(command: string, params?: unknown): Promise<T> {
  return params === undefined
    ? invoke<T>(command)
    : invoke<T>(command, { params });
}

export const codexServerStatus = () =>
  codexInvoke<CodexServerStatus>("codex_server_status");
export const codexServerStart = () =>
  codexInvoke<CodexServerStatus>("codex_server_start");
export const codexServerRestart = () =>
  codexInvoke<CodexServerStatus>("codex_server_restart");
export const codexServerStop = () =>
  codexInvoke<CodexServerStatus>("codex_server_stop");

export const codexAccountRead = () =>
  codexInvoke<CodexAccountResponse>("codex_account_read");
export const codexAccountLoginChatgpt = () =>
  codexInvoke<CodexLoginResponse>("codex_login_chatgpt");
export const codexAccountLoginDevice = () =>
  codexInvoke<CodexLoginResponse>("codex_login_device_code");
export const codexAccountLoginCancel = (loginId: string) =>
  invoke<void>("codex_login_cancel", { loginId });
export const codexAccountLogout = () =>
  codexInvoke<void>("codex_logout");
export const codexAccountRateLimits = () =>
  codexInvoke<CodexRateLimitsResponse>("codex_rate_limits");

export const codexModelList = (params?: { includeHidden?: boolean; limit?: number }) =>
  codexInvoke<CodexModelListResponse>("codex_model_list", params);
export const codexThreadList = (params: CodexThreadListParams) =>
  codexInvoke<CodexThreadListResponse>("codex_thread_list", params);
export const codexThreadRead = (threadId: string, includeTurns = true) =>
  codexInvoke<CodexThreadResponse>("codex_thread_read", { threadId, includeTurns });
export const codexThreadStart = (params: CodexThreadStartParams) =>
  codexInvoke<CodexThreadResponse>("codex_thread_start", params);
export const codexThreadResume = (params: CodexThreadResumeParams) =>
  codexInvoke<CodexThreadResponse>("codex_thread_resume", params);
export const codexThreadArchive = (threadId: string) =>
  codexInvoke<void>("codex_thread_archive", { threadId });
export const codexThreadNameSet = (threadId: string, name: string) =>
  codexInvoke<void>("codex_thread_name_set", { threadId, name });

export const codexTurnStart = (params: CodexTurnStartParams) =>
  codexInvoke<CodexTurnResponse>("codex_turn_start", params);
export const codexTurnSteer = (
  threadId: string,
  expectedTurnId: string,
  input: CodexUserInput[],
) => codexInvoke<void>("codex_turn_steer", { threadId, expectedTurnId, input });
export const codexTurnInterrupt = (threadId: string, turnId: string) =>
  codexInvoke<void>("codex_turn_interrupt", { threadId, turnId });

export const codexPendingServerRequests = () =>
  codexInvoke<CodexServerRequest[]>("codex_pending_server_requests");
export const codexRespondServerRequest = (
  requestId: string | number,
  response: unknown,
) => invoke<void>("codex_respond_to_server_request", { requestId, response });

export function listenCodexStatus(
  handler: (status: CodexServerStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<CodexServerStatus>("codex:status", (event) => handler(event.payload));
}

export function listenCodexEvents(
  handler: (event: CodexEventEnvelope) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<CodexEventEnvelope>("codex:event", (event) => handler(event.payload));
}

export function listenCodexServerRequests(
  handler: (request: CodexServerRequest) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<CodexServerRequest>("codex:server-request", (event) =>
    handler(event.payload),
  );
}

export async function openExternalUrl(url: string): Promise<void> {
  await invoke("open_external_url", { url });
}
