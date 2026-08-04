import { beforeEach, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  readFileText: vi.fn<(path: string) => Promise<string>>(),
  writeFileText: vi.fn<
    (path: string, contents: string, expectedContents?: string | null) => Promise<void>
  >(),
}));

vi.mock("../bridge/tauri", () => bridge);

import {
  acceptExternalVersion,
  clearBuffers,
  createUntitledBuffer,
  ensureBuffer,
  getBuffer,
  isDirty,
  keepLocalVersion,
  refreshBuffersFromDisk,
  remapBufferPaths,
  saveBuffer,
  saveBufferAs,
  updateContent,
} from "./buffers";

describe("buffer safety", () => {
  beforeEach(() => {
    clearBuffers();
    bridge.readFileText.mockReset();
    bridge.writeFileText.mockReset();
    bridge.writeFileText.mockResolvedValue();
  });

  it("propagates read failures without creating an empty writable buffer", async () => {
    bridge.readFileText.mockRejectedValueOnce(new Error("permission denied"));

    await expect(ensureBuffer("/project/private.txt")).rejects.toThrow("permission denied");
    expect(getBuffer("/project/private.txt")).toBeNull();
  });

  it("saves an untitled buffer only through Save As", async () => {
    createUntitledBuffer("untitled-1", "hello");

    await expect(saveBuffer("untitled-1")).rejects.toThrow("Choose a file name");
    const saved = await saveBufferAs("untitled-1", "/project/hello.txt");

    expect(bridge.writeFileText).toHaveBeenCalledWith("/project/hello.txt", "hello", null);
    expect(saved.untitled).toBe(false);
    expect(getBuffer("untitled-1")).toBeNull();
  });

  it("uses compare-before-write for normal saves and force only for Keep Mine", async () => {
    bridge.readFileText.mockResolvedValueOnce("original");
    await ensureBuffer("/project/file.txt");
    updateContent("/project/file.txt", "local edit");

    await saveBuffer("/project/file.txt");
    expect(bridge.writeFileText).toHaveBeenLastCalledWith(
      "/project/file.txt",
      "local edit",
      "original",
    );

    updateContent("/project/file.txt", "keep this");
    bridge.readFileText.mockResolvedValueOnce("external edit");
    await refreshBuffersFromDisk();
    await keepLocalVersion("/project/file.txt");

    expect(bridge.writeFileText).toHaveBeenLastCalledWith(
      "/project/file.txt",
      "keep this",
      null,
    );
    expect(getBuffer("/project/file.txt")?.externalContent).toBeNull();
    expect(isDirty("/project/file.txt")).toBe(false);
  });

  it("reloads clean files and preserves dirty buffers as explicit conflicts", async () => {
    bridge.readFileText.mockResolvedValueOnce("one");
    await ensureBuffer("/project/file.txt");

    bridge.readFileText.mockResolvedValueOnce("two");
    await expect(refreshBuffersFromDisk()).resolves.toEqual([
      { path: "/project/file.txt", state: "reloaded" },
    ]);
    expect(getBuffer("/project/file.txt")?.content).toBe("two");

    updateContent("/project/file.txt", "local");
    bridge.readFileText.mockResolvedValueOnce("external");
    await expect(refreshBuffersFromDisk()).resolves.toEqual([
      { path: "/project/file.txt", state: "conflict" },
    ]);
    expect(getBuffer("/project/file.txt")?.content).toBe("local");
    expect(getBuffer("/project/file.txt")?.externalContent).toBe("external");
    await expect(saveBuffer("/project/file.txt")).rejects.toThrow("changed on disk");

    acceptExternalVersion("/project/file.txt");
    expect(getBuffer("/project/file.txt")?.content).toBe("external");
    expect(isDirty("/project/file.txt")).toBe(false);
  });

  it("remaps open buffers when a file or parent directory is renamed", async () => {
    bridge.readFileText.mockResolvedValueOnce("source");
    await ensureBuffer("/project/src/main.ts");
    updateContent("/project/src/main.ts", "local edit");

    remapBufferPaths("/project/src", "/project/app");

    expect(getBuffer("/project/src/main.ts")).toBeNull();
    expect(getBuffer("/project/app/main.ts")?.content).toBe("local edit");
    expect(isDirty("/project/app/main.ts")).toBe(true);
  });
});
