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

import {
  ensureBuffer,
  getBuffer,
  saveBuffer,
  updateContent,
  updateCursor,
  useBuffersVersion,
} from "../../stores/buffers";
import { editorThemeExtension } from "./editorThemes";
import type { LspServerSettings } from "../../bridge/types";
import { lspExtensionForDocument, setLspActiveRoot } from "../../features/lsp";
import { flushSettings } from "../../stores/settings";
import { editorCursorOffset, editorLanguageExtension } from "./editorLanguage";

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
  editorTheme?: string;
  workspaceRoot?: string | null;
  lspEnabled?: boolean;
  lspServers?: readonly LspServerSettings[];
}

const CodeEditor: Component<CodeEditorProps> = (props) => {
  let hostRef: HTMLDivElement | undefined;
  let view: EditorView | undefined;
  let renderedPath: string | null = null;
  let loadGeneration = 0;
  let lspConfigurationGeneration = 0;
  const langCompartment = new Compartment();
  const appearanceCompartment = new Compartment();
  const themeCompartment = new Compartment();
  const lspCompartment = new Compartment();
  const wrappingCompartment = new Compartment();
  const tabSizeCompartment = new Compartment();
  const buffersVersion = useBuffersVersion();

  const appearanceExtension = () =>
    EditorView.theme(
      {
        "&": {
          height: "100%",
          fontSize: `${props.fontSize ?? 13}px`,
        },
        ".cm-scroller": {
          fontFamily: props.fontFamily
            ? `"${props.fontFamily}", var(--font-mono), monospace`
            : 'var(--font-mono), "JetBrains Mono", monospace',
          lineHeight: String(props.lineHeight ?? 1.55),
        },
      },
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
      langCompartment.of(editorLanguageExtension(path)),
      appearanceCompartment.of(appearanceExtension()),
      themeCompartment.of(editorThemeExtension(props.editorTheme)),
      lspCompartment.of([]),
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
        anchor: editorCursorOffset(buffer.content, buffer.cursor.line, buffer.cursor.col),
      },
      extensions: buildExtensions(path),
    });
    hostRef.innerHTML = "";
    view = new EditorView({
      state,
      parent: hostRef,
    });
    view.focus();
    void configureLspExtension(path, view);
  }

  async function configureLspExtension(path: string, targetView: EditorView) {
    const generation = ++lspConfigurationGeneration;
    const root = props.workspaceRoot;
    const enabled = props.lspEnabled === true;
    const servers = (props.lspServers ?? []).map((server) => ({ ...server }));

    try {
      await setLspActiveRoot(root ?? null);
      if (enabled) await flushSettings();
      if (
        generation !== lspConfigurationGeneration ||
        view !== targetView ||
        renderedPath !== path
      ) {
        return;
      }
      const extension = root && !path.startsWith("untitled-")
        ? lspExtensionForDocument({ root, path, enabled, servers })
        : [];
      targetView.dispatch({
        effects: lspCompartment.reconfigure(extension),
      });
    } catch (error) {
      if (generation !== lspConfigurationGeneration || view !== targetView) return;
      const message = error instanceof Error ? error.message : String(error);
      props.onError?.(`Unable to configure language services: ${message}`);
      targetView.dispatch({ effects: lspCompartment.reconfigure([]) });
    }
  }

  // Rebuild only when the active path changes. A generation guard prevents a
  // slower previous read from taking over after a fast tab switch.
  createEffect(() => {
    void loadPath(props.path);
  });

  createEffect(() => {
    const root = props.workspaceRoot;
    const enabled = props.lspEnabled;
    const servers = (props.lspServers ?? []).map((server) => ({
      id: server.id,
      enabled: server.enabled,
      executable: server.executable,
    }));
    void root;
    void enabled;
    void servers;
    if (!view || !renderedPath) return;
    void configureLspExtension(renderedPath, view);
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
    const editorTheme = props.editorTheme;
    void fontFamily;
    void fontSize;
    void lineHeight;
    if (!view) return;
    view.dispatch({
      effects: [
        appearanceCompartment.reconfigure(appearanceExtension()),
        themeCompartment.reconfigure(editorThemeExtension(editorTheme)),
        wrappingCompartment.reconfigure(wordWrap ? EditorView.lineWrapping : []),
        tabSizeCompartment.reconfigure(EditorState.tabSize.of(tabSize ?? 2)),
      ],
    });
  });

  onCleanup(() => {
    lspConfigurationGeneration += 1;
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
