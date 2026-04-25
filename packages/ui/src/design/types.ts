// Shared types for the design-system port.
// Mirrors data shapes in public/design/data.js and pipeline.jsx.

export type GitStatusKind = 'M' | 'A' | 'D' | 'U' | 'R' | string;

export interface FileNode {
  type: 'dir' | 'file';
  name: string;
  depth: number;
  /** Absolute filesystem path. Set for real workspace nodes; mock data may
   *  omit it. */
  path?: string;
  expanded?: boolean;
  children?: FileNode[];
  /** Set to true while the children of an expanded directory are loading. */
  loading?: boolean;
  icon?: string;
  git?: GitStatusKind;
  active?: boolean;
}

export interface Tab {
  id: string;
  name: string;
  icon: string;
  dirty: boolean;
}

export interface CodeLine {
  gutter: number;
  html: string;
  current?: boolean;
  selected?: boolean;
  diagnostic?: string;
  diagType?: 'e' | 'w' | string;
  hunk?: 'a' | 'b' | string;
}

export interface CodeFile {
  path: string[];
  language: string;
  branch?: string;
  dirty?: boolean;
  symbols?: string[];
  lines: CodeLine[];
}

export interface DiagCounts {
  error: number;
  warn: number;
}

export interface Cursor {
  line: number;
  col: number;
}

export type EditorMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND' | string;

// Palette
export interface PaletteItem {
  kind: 'file' | 'cmd' | string;
  icon: string;
  primary: string;
  secondary: string;
  kbd?: string;
}
export interface PaletteSection {
  label: string;
  items: PaletteItem[];
}

// Git
export interface GitFile {
  status: GitStatusKind;
  path: string;
  plus: number;
  minus: number;
  active?: boolean;
}
export interface GitStatusData {
  branch: string;
  upstream: string;
  ahead: number;
  behind: number;
  staged: GitFile[];
  unstaged: GitFile[];
}
export interface GitDiffLine {
  type: 'ctx' | 'add' | 'del' | string;
  old: number | null;
  new: number | null;
  sign: string;
  text: string;
}
export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}
export interface GitDiffData {
  path: string;
  plus: number;
  minus: number;
  hunks: GitDiffHunk[];
}

// Search
export interface SearchMatch {
  ln: number;
  before: string;
  hl: string;
  after: string;
}
export interface SearchFile {
  path: string;
  matches: SearchMatch[];
}
export interface SearchResultsData {
  query: string;
  replace: string;
  files: SearchFile[];
}

// Minimap
export interface MinimapBuffer {
  icon: string;
  name: string;
  lines: number;
  active?: boolean;
}
export interface MinimapLine {
  cls: string;
  w: number;
}

// Settings shape used by SettingsPanel
export interface SettingsShape {
  theme: string;
  vibrancy: 'on' | 'off' | string;
  density: 'compact' | 'comfortable' | 'spacious' | string;
  [k: string]: any;
}

// Pipeline
export type AgentKey = 'research' | 'coder' | 'reviewer';

export interface Ticket {
  id: string;
  title: string;
  prio: 'high' | 'med' | 'low' | string;
  files: number;
  est: string;
  state: 'running' | 'queued' | 'done' | string;
}

export interface StationStat {
  num: string;
  lab: string;
}
export interface StationLogLine {
  c: string;
  t: string;
}
export type StationState = 'running' | 'pending' | 'done' | string;
export type WireState = 'idle' | 'active' | 'done' | string;

// Chat
export type ChatMsg =
  | { role: 'user'; content: string }
  | { role: 'agent'; content: string }
  | {
      role: 'tool';
      tool: string;
      args: string;
      status: 'done' | 'fail' | string;
      result: string;
    }
  | { role: 'loop'; label: string; content: string }
  | {
      role: 'plan';
      title: string;
      steps: string[];
      scope: string;
    }
  | {
      role: 'findings';
      items: Array<{ sev: 'ok' | 'warn' | 'nit' | string; title: string; body: string }>;
    }
  | {
      role: 'verdict';
      status: 'approve' | 'reject' | string;
      content: string;
    }
  | { role: 'handoff'; to: string; content: string };

export interface ChatData {
  model: string;
  role: string;
  msgs: ChatMsg[];
}
