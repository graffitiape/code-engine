import { Compartment, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_EDITOR_THEME,
  EDITOR_THEME_OPTIONS,
  editorThemeExtension,
  resolveEditorTheme,
} from "./editorThemes";

describe("editor themes", () => {
  it("publishes unique built-in theme identifiers", () => {
    const ids = EDITOR_THEME_OPTIONS.map((option) => option.value);

    expect(ids).toEqual([
      "match-interface",
      "tokyonight",
      "catppuccin",
      "rosepine",
      "one-dark",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("falls back safely when a persisted theme is unknown", () => {
    expect(resolveEditorTheme("rosepine")).toBe("rosepine");
    expect(resolveEditorTheme("unknown-theme")).toBe(DEFAULT_EDITOR_THEME);
    expect(resolveEditorTheme(undefined)).toBe(DEFAULT_EDITOR_THEME);
    expect(editorThemeExtension("unknown-theme")).toBe(
      editorThemeExtension(DEFAULT_EDITOR_THEME),
    );
  });

  it("supports CodeMirror compartment reconfiguration without rebuilding state", () => {
    const compartment = new Compartment();
    const initialTheme = editorThemeExtension("tokyonight");
    const nextTheme = editorThemeExtension("catppuccin");
    const initialState = EditorState.create({
      doc: "const answer = 42;",
      selection: { anchor: 6 },
      extensions: compartment.of(initialTheme),
    });

    const nextState = initialState.update({
      effects: compartment.reconfigure(nextTheme),
    }).state;

    expect(compartment.get(nextState)).toBe(nextTheme);
    expect(nextState.doc.toString()).toBe(initialState.doc.toString());
    expect(nextState.selection.main.anchor).toBe(initialState.selection.main.anchor);
  });
});
