import { describe, expect, it } from "vitest";
import { editorCursorOffset, editorLanguageExtension } from "./editorLanguage";

describe("editor language helpers", () => {
  it.each(["file.tsx", "file.rs", "file.jsonc", "file.less", "file.pyi"])(
    "loads syntax support for %s",
    (path) => {
      expect(editorLanguageExtension(path)).not.toEqual([]);
    },
  );

  it("clamps restored cursor positions to the current document", () => {
    const content = "first\nsecond";
    expect(editorCursorOffset(content, 2, 3)).toBe(8);
    expect(editorCursorOffset(content, 99, 99)).toBe(content.length);
    expect(editorCursorOffset(content, -1, -1)).toBe(0);
  });
});
