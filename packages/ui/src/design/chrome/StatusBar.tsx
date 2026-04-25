// Bottom status bar — mode pill, branch, diagnostics, file meta.

import { Show } from 'solid-js';
import type { CodeFile, Cursor, DiagCounts, EditorMode } from '../types';

export interface StatusBarProps {
  mode: EditorMode;
  file: CodeFile | null | undefined;
  cursor: Cursor;
  diagCounts: DiagCounts;
  task?: string | null;
  /** Active git branch (or null when no repo / not yet loaded). */
  branch?: string | null;
  /** Optional path-derived language label. Defaults to "—". */
  language?: string | null;
}

export function StatusBar(props: StatusBarProps) {
  const language = () => props.language ?? '—';
  return (
    <div class="statusbar" data-screen-label="StatusBar">
      <span class={`item mode-pill ${props.mode}`}>{props.mode}</span>
      <Show when={props.branch}>
        <span class="item">
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            stroke-width="1.4"
          >
            <circle cx="4" cy="3" r="1.5" />
            <circle cx="4" cy="13" r="1.5" />
            <circle cx="12" cy="6" r="1.5" />
            <path d="M4 4.5v7" />
            <path d="M12 7.5c0 2-2 3-4 3.5" />
          </svg>
          <span>{props.branch}</span>
        </span>
      </Show>
      <Show when={props.diagCounts.error || props.diagCounts.warn}>
        <span class="item">
          <Show when={props.diagCounts.error}>
            <span class="diag-icon">●</span>
            <span>{props.diagCounts.error}</span>
          </Show>
          <Show when={props.diagCounts.warn}>
            <span class="diag-icon warn" style={{ 'margin-left': '8px' }}>
              ▲
            </span>
            <span>{props.diagCounts.warn}</span>
          </Show>
        </span>
      </Show>
      <Show when={props.task}>
        <span class="item task">
          <span class="lsp-spin" />
          <span>{props.task}</span>
        </span>
      </Show>
      <div class="right">
        <span class="item no-border" style={{ color: 'var(--fg-2)' }}>
          {language()}
        </span>
        <Show when={props.cursor.line > 0 || props.cursor.col > 0}>
          <span class="item no-border">
            Ln {props.cursor.line}, Col {props.cursor.col}
          </span>
        </Show>
        <span class="item no-border" style={{ color: 'var(--accent)' }}>
          Code Engine
        </span>
      </div>
    </div>
  );
}
