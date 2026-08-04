// Shared types for the active editor chrome.

export type GitStatusKind = 'M' | 'A' | 'D' | 'U' | 'R' | string;

export interface FileNode {
  type: 'dir' | 'file';
  name: string;
  depth: number;
  /** Absolute filesystem path for real workspace nodes. */
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
