import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export const DEFAULT_EDITOR_THEME = "match-interface";

export const EDITOR_THEME_OPTIONS = [
  {
    value: "match-interface",
    label: "Match interface",
    description: "Use the active Code Engine palette",
  },
  {
    value: "tokyonight",
    label: "Tokyo Night",
    description: "Deep blue with bright syntax colors",
  },
  {
    value: "catppuccin",
    label: "Catppuccin Mocha",
    description: "Soft pastels on a dark background",
  },
  {
    value: "rosepine",
    label: "Rose Pine",
    description: "Muted rose and lavender tones",
  },
  {
    value: "one-dark",
    label: "One Dark",
    description: "The familiar Atom-inspired palette",
  },
] as const;

export type EditorThemeId = (typeof EDITOR_THEME_OPTIONS)[number]["value"];

interface EditorThemePalette {
  background: string;
  panel: string;
  foreground: string;
  muted: string;
  border: string;
  selection: string;
  searchMatch: string;
  searchSelected: string;
  selectionMatch: string;
  activeLine: string;
  activeGutter: string;
  tooltip: string;
  tooltipSelected: string;
  cursor: string;
  keyword: string;
  property: string;
  function: string;
  constant: string;
  type: string;
  operator: string;
  comment: string;
  string: string;
  invalid: string;
}

const matchInterface = [
  oneDark,
  EditorView.theme(
    {
      "&": { backgroundColor: "var(--bg-1)" },
      ".cm-gutters": {
        backgroundColor: "var(--bg-1)",
        border: "none",
        color: "var(--fg-3)",
      },
      ".cm-activeLine": {
        backgroundColor: "color-mix(in oklab, var(--accent) 8%, transparent)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "color-mix(in oklab, var(--accent) 12%, transparent)",
        color: "var(--fg-1)",
      },
    },
    { dark: true },
  ),
];

function createEditorTheme(palette: EditorThemePalette): Extension {
  const viewTheme = EditorView.theme(
    {
      "&": {
        color: palette.foreground,
        backgroundColor: palette.background,
      },
      ".cm-content": { caretColor: palette.cursor },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: palette.cursor },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
        backgroundColor: palette.selection,
      },
      ".cm-panels": {
        backgroundColor: palette.panel,
        color: palette.foreground,
      },
      ".cm-panels.cm-panels-top": { borderBottom: `1px solid ${palette.border}` },
      ".cm-panels.cm-panels-bottom": { borderTop: `1px solid ${palette.border}` },
      ".cm-searchMatch": {
        backgroundColor: palette.searchMatch,
        outline: `1px solid ${palette.property}`,
      },
      ".cm-searchMatch.cm-searchMatch-selected": {
        backgroundColor: palette.searchSelected,
      },
      ".cm-activeLine": { backgroundColor: palette.activeLine },
      ".cm-selectionMatch": { backgroundColor: palette.selectionMatch },
      "&.cm-focused .cm-matchingBracket": {
        backgroundColor: palette.selectionMatch,
        outline: `1px solid ${palette.muted}`,
      },
      "&.cm-focused .cm-nonmatchingBracket": {
        color: palette.invalid,
        outline: `1px solid ${palette.invalid}`,
      },
      ".cm-gutters": {
        backgroundColor: palette.background,
        color: palette.muted,
        border: "none",
      },
      ".cm-activeLineGutter": {
        backgroundColor: palette.activeGutter,
        color: palette.foreground,
      },
      ".cm-foldPlaceholder": {
        backgroundColor: "transparent",
        border: "none",
        color: palette.muted,
      },
      ".cm-tooltip": {
        border: `1px solid ${palette.border}`,
        backgroundColor: palette.tooltip,
        color: palette.foreground,
      },
      ".cm-tooltip .cm-tooltip-arrow:before": {
        borderTopColor: "transparent",
        borderBottomColor: "transparent",
      },
      ".cm-tooltip .cm-tooltip-arrow:after": {
        borderTopColor: palette.tooltip,
        borderBottomColor: palette.tooltip,
      },
      ".cm-tooltip-autocomplete > ul > li[aria-selected]": {
        backgroundColor: palette.tooltipSelected,
        color: palette.foreground,
      },
    },
    { dark: true },
  );

  const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: palette.keyword },
    {
      tag: [tags.name, tags.deleted, tags.character, tags.propertyName, tags.macroName],
      color: palette.property,
    },
    {
      tag: [tags.function(tags.variableName), tags.labelName],
      color: palette.function,
    },
    {
      tag: [tags.color, tags.constant(tags.name), tags.standard(tags.name)],
      color: palette.constant,
    },
    {
      tag: [tags.definition(tags.name), tags.separator],
      color: palette.foreground,
    },
    {
      tag: [
        tags.typeName,
        tags.className,
        tags.number,
        tags.changed,
        tags.annotation,
        tags.modifier,
        tags.self,
        tags.namespace,
      ],
      color: palette.type,
    },
    {
      tag: [
        tags.operator,
        tags.operatorKeyword,
        tags.url,
        tags.escape,
        tags.regexp,
        tags.link,
        tags.special(tags.string),
      ],
      color: palette.operator,
    },
    { tag: [tags.meta, tags.comment], color: palette.comment, fontStyle: "italic" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
    { tag: tags.link, color: palette.operator, textDecoration: "underline" },
    { tag: tags.heading, color: palette.property, fontWeight: "bold" },
    {
      tag: [tags.atom, tags.bool, tags.special(tags.variableName)],
      color: palette.constant,
    },
    {
      tag: [tags.processingInstruction, tags.string, tags.inserted],
      color: palette.string,
    },
    { tag: tags.invalid, color: palette.invalid },
  ]);

  return [viewTheme, syntaxHighlighting(highlightStyle)];
}

const themeExtensions: Record<EditorThemeId, Extension> = {
  "match-interface": matchInterface,
  tokyonight: createEditorTheme({
    background: "#1a1b26",
    panel: "#16161e",
    foreground: "#c0caf5",
    muted: "#565f89",
    border: "#292e42",
    selection: "#33467c",
    searchMatch: "#3d59a166",
    searchSelected: "#7aa2f744",
    selectionMatch: "#9ece6a22",
    activeLine: "#292e4266",
    activeGutter: "#292e42",
    tooltip: "#24283b",
    tooltipSelected: "#364a82",
    cursor: "#c0caf5",
    keyword: "#bb9af7",
    property: "#f7768e",
    function: "#7aa2f7",
    constant: "#ff9e64",
    type: "#e0af68",
    operator: "#7dcfff",
    comment: "#565f89",
    string: "#9ece6a",
    invalid: "#f7768e",
  }),
  catppuccin: createEditorTheme({
    background: "#1e1e2e",
    panel: "#181825",
    foreground: "#cdd6f4",
    muted: "#6c7086",
    border: "#313244",
    selection: "#45475a",
    searchMatch: "#89b4fa4d",
    searchSelected: "#cba6f744",
    selectionMatch: "#a6e3a122",
    activeLine: "#31324466",
    activeGutter: "#313244",
    tooltip: "#24243a",
    tooltipSelected: "#45475a",
    cursor: "#f5e0dc",
    keyword: "#cba6f7",
    property: "#f38ba8",
    function: "#89b4fa",
    constant: "#fab387",
    type: "#f9e2af",
    operator: "#89dceb",
    comment: "#6c7086",
    string: "#a6e3a1",
    invalid: "#f38ba8",
  }),
  rosepine: createEditorTheme({
    background: "#191724",
    panel: "#1f1d2e",
    foreground: "#e0def4",
    muted: "#6e6a86",
    border: "#26233a",
    selection: "#403d52",
    searchMatch: "#31748f55",
    searchSelected: "#c4a7e744",
    selectionMatch: "#9ccfd822",
    activeLine: "#26233a88",
    activeGutter: "#26233a",
    tooltip: "#26233a",
    tooltipSelected: "#403d52",
    cursor: "#e0def4",
    keyword: "#c4a7e7",
    property: "#eb6f92",
    function: "#9ccfd8",
    constant: "#ebbcba",
    type: "#f6c177",
    operator: "#31748f",
    comment: "#6e6a86",
    string: "#f6c177",
    invalid: "#eb6f92",
  }),
  "one-dark": oneDark,
};

const editorThemeIds = new Set<string>(
  EDITOR_THEME_OPTIONS.map((option) => option.value),
);

export function resolveEditorTheme(theme: string | null | undefined): EditorThemeId {
  return editorThemeIds.has(theme ?? "")
    ? (theme as EditorThemeId)
    : DEFAULT_EDITOR_THEME;
}

export function editorThemeExtension(theme: string | null | undefined): Extension {
  return themeExtensions[resolveEditorTheme(theme)];
}
