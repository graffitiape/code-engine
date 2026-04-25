// CodeMirror 6-based code editor. Hosts a single buffer at a time; switching
// active path replaces the whole editor state.

import { Component, createEffect, onCleanup, onMount } from "solid-js";
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
  saveBuffer,
  updateContent,
  updateCursor,
} from "../../stores/buffers";

interface CodeEditorProps {
  path: string | null;
  onCursor?: (line: number, col: number) => void;
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
  const langCompartment = new Compartment();

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
            if (props.path) {
              saveBuffer(props.path).catch((e) =>
                console.error("[CE] save failed:", e),
              );
            }
            return true;
          },
        },
      ]),
      langCompartment.of(languageExtension(path)),
      oneDark,
      EditorView.theme(
        {
          "&": {
            height: "100%",
            fontSize: "13px",
            background: "var(--bg-1)",
          },
          ".cm-scroller": {
            fontFamily: 'var(--font-mono), "JetBrains Mono", monospace',
            lineHeight: "1.55",
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
      ),
      EditorView.updateListener.of((update) => {
        if (!props.path) return;
        if (update.docChanged) {
          updateContent(props.path, update.state.doc.toString());
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          const lineNumber = line.number;
          const col = head - line.from + 1;
          updateCursor(props.path, lineNumber, col);
          props.onCursor?.(lineNumber, col);
        }
      }),
    ];
  }

  async function loadPath(path: string | null) {
    if (!hostRef) return;
    if (!path) {
      view?.destroy();
      view = undefined;
      hostRef.innerHTML = "";
      return;
    }
    const buf = await ensureBuffer(path);
    if (view) view.destroy();
    const state = EditorState.create({
      doc: buf.content,
      extensions: buildExtensions(path),
    });
    hostRef.innerHTML = "";
    view = new EditorView({
      state,
      parent: hostRef,
    });
    view.focus();
  }

  onMount(() => {
    loadPath(props.path);
  });

  // Reload editor whenever the active path changes
  createEffect(() => {
    const p = props.path;
    if (view) {
      // Different path → rebuild
      const currentDoc = view.state.doc.toString();
      const currentLen = currentDoc.length;
      void currentLen;
    }
    loadPath(p);
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

export default CodeEditor;
