import { describe, expect, it } from "vitest";
import {
  fileUriToWorkspacePath,
  sameWorkspacePath,
  workspacePathToFileUri,
} from "./uri";

describe("LSP file URI helpers", () => {
  it("round-trips encoded POSIX paths inside the workspace", () => {
    const root = "/Users/test/My Project";
    const path = "/Users/test/My Project/src/naïve #100%.ts";
    const uri = workspacePathToFileUri(root, path);

    expect(uri).toBe("file:///Users/test/My%20Project/src/na%C3%AFve%20%23100%25.ts");
    expect(fileUriToWorkspacePath(root, uri!)).toBe(path);
  });

  it("rejects traversal, sibling-prefix paths, and non-file URIs", () => {
    expect(workspacePathToFileUri("/project", "/project/../secret.ts")).toBeNull();
    expect(workspacePathToFileUri("/project", "/project-copy/file.ts")).toBeNull();
    expect(fileUriToWorkspacePath("/project", "file:///project/%2e%2e/secret.ts")).toBeNull();
    expect(fileUriToWorkspacePath("/project", "https://example.com/file.ts")).toBeNull();
    expect(fileUriToWorkspacePath("/project", "file:///project/file.ts?query=1")).toBeNull();
  });

  it("handles Windows drive paths without weakening containment", () => {
    const uri = workspacePathToFileUri("C:\\Repo", "c:\\repo\\src\\hello world.ts");
    expect(uri).toBe("file:///C:/repo/src/hello%20world.ts");
    expect(fileUriToWorkspacePath("C:\\Repo", uri!)).toBe("C:\\repo\\src\\hello world.ts");
    expect(workspacePathToFileUri("C:\\Repo", "D:\\Repo\\file.ts")).toBeNull();
  });

  it("handles UNC workspaces and rejects a different share", () => {
    const uri = workspacePathToFileUri(
      "\\\\server\\share",
      "\\\\server\\share\\src\\file.ts",
    );
    expect(uri).toBe("file://server/share/src/file.ts");
    expect(fileUriToWorkspacePath("\\\\server\\share", uri!)).toBe(
      "\\\\server\\share\\src\\file.ts",
    );
    expect(fileUriToWorkspacePath("\\\\server\\other", uri!)).toBeNull();
  });

  it("compares Windows paths case-insensitively and POSIX paths exactly", () => {
    expect(sameWorkspacePath("C:\\Repo\\File.ts", "c:/repo/file.ts")).toBe(true);
    expect(sameWorkspacePath("/Repo/File.ts", "/repo/file.ts")).toBe(false);
  });
});
