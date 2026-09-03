import { describe, expect, it } from "vitest";
import { languageServerIds, lspLanguageForPath } from "./languages";

describe("LSP language mapping", () => {
  it.each([
    ["/project/app.ts", "typescript", "typescript"],
    ["/project/app.MTS", "typescript", "typescript"],
    ["/project/app.cts", "typescript", "typescript"],
    ["/project/view.tsx", "typescript", "typescriptreact"],
    ["/project/app.js", "typescript", "javascript"],
    ["/project/app.mjs", "typescript", "javascript"],
    ["/project/app.cjs", "typescript", "javascript"],
    ["/project/view.jsx", "typescript", "javascriptreact"],
    ["/project/main.rs", "rust", "rust"],
    ["/project/main.py", "python", "python"],
    ["/project/types.pyi", "python", "python"],
    ["/project/config.json", "json", "json"],
    ["/project/config.jsonc", "json", "json"],
    ["/project/site.css", "css", "css"],
    ["/project/site.scss", "css", "scss"],
    ["/project/site.less", "css", "less"],
    ["/project/index.html", "html", "html"],
    ["/project/index.htm", "html", "html"],
  ])("maps %s to %s/%s", (path, serverId, languageId) => {
    expect(lspLanguageForPath(path)).toEqual({ serverId, languageId });
  });

  it("does not guess for unsupported or extensionless files", () => {
    expect(lspLanguageForPath("/project/README")).toBeNull();
    expect(lspLanguageForPath("/project/main.go")).toBeNull();
    expect(lspLanguageForPath("/project/.gitignore")).toBeNull();
  });

  it("publishes each native server id once", () => {
    expect(languageServerIds()).toEqual([
      "typescript",
      "rust",
      "python",
      "json",
      "css",
      "html",
    ]);
    expect(new Set(languageServerIds()).size).toBe(languageServerIds().length);
  });
});
