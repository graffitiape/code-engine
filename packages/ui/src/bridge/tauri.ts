import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "./types";

/** One filesystem entry returned by `read_dir`. */
export interface FsNode {
  name: string;
  path: string;
  kind: "dir" | "file";
  is_symlink: boolean;
}

/** Single git file status row. */
export interface GitFileStatus {
  path: string;
  state: "staged" | "unstaged" | "untracked" | "conflicted";
  kind: string;
}

/** Aggregate repo status for the GitPanel. */
export interface GitRepoStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

/** Create a new pane with an embedded Neovim instance */
export async function createPane(
  cols: number,
  rows: number,
  cwd?: string,
): Promise<string> {
  return invoke("create_pane", { cols, rows, cwd });
}

/** Close a pane and its Neovim instance */
export async function closePane(paneId: string): Promise<void> {
  return invoke("close_pane", { paneId });
}

/** Send keyboard input to a specific pane */
export async function nvimInput(
  paneId: string,
  keys: string,
): Promise<void> {
  return invoke("nvim_input", { paneId, keys });
}

/** Resize a pane's Neovim grid */
export async function nvimResize(
  paneId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("nvim_resize", { paneId, cols, rows });
}

/** Execute a Neovim command */
export async function nvimCommand(
  paneId: string,
  command: string,
): Promise<void> {
  return invoke("nvim_command", { paneId, command });
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
export async function setWorkspaceRoot(path: string): Promise<void> {
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

/** Write a UTF-8 text file. */
export async function writeFileText(path: string, contents: string): Promise<void> {
  return invoke("write_file_text", { path, contents });
}

/** Get repo status for a directory containing a .git. */
export async function gitStatus(path: string): Promise<GitRepoStatus> {
  return invoke("git_status", { path });
}

/** Recursively list every non-ignored file under the workspace root. */
export async function listWorkspaceFiles(
  path: string,
  max?: number,
): Promise<string[]> {
  return invoke("list_workspace_files", { path, max });
}

/** Mirror the macOS "double-click a title bar to" behavior. Reads the user's
 *  system pref and either minimizes or zooms the window. No-op on linux. */
export async function titlebarDoubleClick(): Promise<void> {
  return invoke("titlebar_double_click");
}
