// CodeMirror 6-based code editor. Hosts a single buffer at a time; switching
// active path replaces the whole editor state.

import { Component, createEffect, onCleanup } from "solid-js";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, highlightSpecialChars } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
} from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { lintKeymap } from "@codemirror/lint";
import { oneDark } from "@codemirror/theme-one-dark";

import { javascript } from "@codemirror/lang-javascript";
import { rust } from "@codemirror/lang-rust";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { python } from "@codemirror/lang-python";

import {
  ensureBuffer,
  getBuffer,
  saveBuffer,
  updateContent,
  updateCursor,
  useBuffersVersion,
} from "../../stores/buffers";

interface CodeEditorProps {
  path: string | null;
  onCursor?: (line: number, col: number) => void;
  onSave?: (path: string) => Promise<void> | void;
  onError?: (message: string) => void;
  fontFamily?: string;
  fontSize?: number;
  lineHeight?: number;
  wordWrap?: boolean;
  tabSize?: number;
}

function languageExtension(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "ts":
    case "tsx":
      return javascript({ jsx: ext === "tsx", typescript: true });
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "rs":
      return rust();
    case "json":
      return json();
    case "md":
    case "markdown":
      return markdown();
    case "css":
    case "scss":
      return css();
    case "html":
    case "htm":
      return html();
    case "py":
      return python();
    default:
      return [];
  }
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  let hostRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let renderedPath: string | null = null;
  let loadGeneration = 0;
  const langCompartment = new Compartment();
  const appearanceCompartment = new Compartment();
  const wrappingCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const buffersVersion = useBuffersVersion();

  const appearanceExtension = () =>
    EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${props.fontSize ?? 13}px`,
          background: "var(--bg-1)",
        },
        ".cm-scroller": {
          fontFamily: props.fontFamily
            ? `"${props.fontFamily}", var(--font-mono), monospace`
            : 'var(--font-mono), "JetBrains Mono", monospace',
          lineHeight: String(props.lineHeight ?? 1.55),
        },
        ".cm-gutters": {
          background: "var(--bg-1)",
          border: "none",
          color: "var(--fg-3)",
        },
        ".cm-activeLine": {
          background: "color-mix(in oklab, var(--accent) 8%, transparent)",
        },
        ".cm-activeLineGutter": {
          background: "color-mix(in oklab, var(--accent) 12%, transparent)",
          color: "var(--fg-1)",
        },
      },
      { dark: true },
    );

  function buildExtensions(path: string) {
    return [
      lineNumbers(),
      foldGutter(),
      drawSelection(),
      highlightSpecialChars(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      history(),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      autocompletion(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        {
          key: "Mod-s",
          run: () => {
            if (renderedPath) {
              const action = props.onSave
                ? props.onSave(renderedPath)
                : saveBuffer(renderedPath);
              Promise.resolve(action).catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                props.onError?.(message);
              });
            }
            return true;
          },
        },
      ]),
      langCompartment.of(languageExtension(path)),
      oneDark,
      appearanceCompartment.of(appearanceExtension()),
      EditorView.updateListener.of((update) => {
        if (renderedPath !== path) return;
        if (update.docChanged) {
          updateContent(path, update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          const lineNumber = line.number;
          const col = head - line.from + 1;
          updateCursor(path, lineNumber, col);
          props.onCursor?.(lineNumber, col);
        }
      }),
      wrappingCompartment.of(props.wordWrap ? EditorView.lineWrapping : []),
      tabSizeCompartment.of(EditorState.tabSize.of(props.tabSize ?? 2)),
    ];
  }

  async function loadPath(path: string | null) {
    const generation = ++loadGeneration;
    if (!hostRef) return;
    if (!path) {
      view?.destroy();
      view = undefined;
      renderedPath = null;
      hostRef.innerHTML = "";
      return;
    }

    let buffer;
    try {
      buffer = await ensureBuffer(path);
    } catch (error) {
      if (generation !== loadGeneration) return;
      const message = error instanceof Error ? error.message : String(error);
      props.onError?.(`Unable to open ${path}: ${message}`);
      return;
    }
    if (generation !== loadGeneration || props.path !== path) return;

    if (view) view.destroy();
    renderedPath = path;
    const state = EditorState.create({
      doc: buffer.content,
      selection: {
        anchor: cursorOffset(buffer.content, buffer.cursor.line, buffer.cursor.col),
      },
      extensions: buildExtensions(path),
    });
    hostRef.innerHTML = "";
    view = new EditorView({
      state,
      parent: hostRef,
    });
    view.focus();
  }

  // Rebuild only when the active path changes. A generation guard prevents a
  // slower previous read from taking over after a fast tab switch.
  createEffect(() => {
    void loadPath(props.path);
  });

  // Clean external writes (including Codex edits) update an already mounted
  // editor without rebuilding its history or selection.
  createEffect(() => {
    void buffersVersion();
    const path = props.path;
    if (!path || path !== renderedPath || !view) return;
    const buffer = getBuffer(path);
    if (!buffer) return;
    const current = view.state.doc.toString();
    if (current === buffer.content) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: buffer.content },
    });
  });

  createEffect(() => {
    const fontFamily = props.fontFamily;
    const fontSize = props.fontSize;
    const lineHeight = props.lineHeight;
    const wordWrap = props.wordWrap;
    const tabSize = props.tabSize;
    void fontFamily;
    void fontSize;
    void lineHeight;
    if (!view) return;
    view.dispatch({
      effects: [
        appearanceCompartment.reconfigure(appearanceExtension()),
        wrappingCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
        tabSizeCompartment.reconfigure(EditorState.tabSize.of(tabSize ?? 2)),
      ],
    });
  });

  onCleanup(() => {
    view?.destroy();
    view = undefined;
  });

  return (
    <div
      ref={hostRef}
      class="ce-editor-host"
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
};

function cursorOffset(content: string, lineNumber: number, column: number): number {
  const lines = content.split("\n");
  const lineIndex = Math.max(0, Math.min(lines.length - 1, lineNumber - 1));
  let offset = 0;
  for (let index = 0; index < lineIndex; index++) offset += lines[index].length + 1;
  return offset + Math.max(0, Math.min(lines[lineIndex].length, column - 1));
}

export default CodeEditor;
