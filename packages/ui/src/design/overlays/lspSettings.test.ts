import { describe, expect, it } from "vitest";
import type { LspServerSettings } from "../../bridge/types";
import {
  LSP_SERVER_OPTIONS,
  normalizeLspExecutable,
  updateLspServerSettings,
} from "./lspSettings";

describe("LSP settings helpers", () => {
  it("presents every supported language server in a stable order", () => {
    expect(LSP_SERVER_OPTIONS.map((server) => server.id)).toEqual([
      "typescript",
      "rust",
      "python",
      "json",
      "css",
      "html",
    ]);
  });

  it("updates one server without mutating the existing settings", () => {
    const servers: LspServerSettings[] = [
      { id: "typescript", enabled: true, executable: null },
      { id: "rust", enabled: true, executable: "rust-analyzer" },
    ];

    const updated = updateLspServerSettings(servers, "rust", { enabled: false });

    expect(updated).toEqual([
      { id: "typescript", enabled: true, executable: null },
      { id: "rust", enabled: false, executable: "rust-analyzer" },
    ]);
    expect(updated).not.toBe(servers);
    expect(servers[1].enabled).toBe(true);
  });

  it("adds a missing supported server with safe defaults", () => {
    const updated = updateLspServerSettings([], "python", { executable: "pyright-langserver" });

    expect(updated).toEqual([
      { id: "python", enabled: true, executable: "pyright-langserver" },
    ]);
  });

  it("stores trimmed executable overrides and uses null for auto-detection", () => {
    expect(normalizeLspExecutable("  rust-analyzer  ")).toBe("rust-analyzer");
    expect(normalizeLspExecutable("   ")).toBeNull();
  });
});
