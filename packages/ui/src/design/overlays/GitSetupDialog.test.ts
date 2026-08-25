import { describe, expect, it } from "vitest";
import type { GitRemoteInfo } from "../../bridge/tauri";
import { gitConnectionActionLabel, gitProviderLabel } from "./GitSetupDialog";

function remote(overrides: Partial<GitRemoteInfo> = {}): GitRemoteInfo {
  return {
    name: "origin",
    displayUrl: "https://github.com/acme/project.git",
    webUrl: "https://github.com/acme/project",
    provider: "github",
    transport: "https",
    host: "github.com",
    ...overrides,
  };
}

describe("Git setup presentation", () => {
  it("uses provider-aware labels for popular hosts", () => {
    expect(gitProviderLabel("github")).toBe("GitHub");
    expect(gitProviderLabel("azure-devops")).toBe("Azure DevOps");
    expect(gitProviderLabel("gitlab")).toBe("GitLab");
    expect(gitProviderLabel("bitbucket")).toBe("Bitbucket");
    expect(gitProviderLabel("generic")).toBe("Git remote");
  });

  it("keeps authentication transport-aware", () => {
    expect(gitConnectionActionLabel(remote())).toBe("Sign in / check GitHub");
    expect(gitConnectionActionLabel(remote({
      provider: "azure-devops",
      transport: "ssh",
      host: "ssh.dev.azure.com",
    }))).toBe("Check SSH access");
  });
});
