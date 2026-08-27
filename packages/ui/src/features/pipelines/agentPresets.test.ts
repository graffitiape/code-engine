import { describe, expect, it } from "vitest";
import {
  PIPELINE_AGENT_PRESETS,
  migratePipelineAgentPreset,
  pipelineAgentPreset,
} from "./agentPresets";

describe("pipeline agent presets", () => {
  it("provides distinct, runnable defaults for every chooser option", () => {
    expect(PIPELINE_AGENT_PRESETS.map((preset) => preset.id)).toEqual([
      "research",
      "implement",
      "review",
      "fix-review",
      "verify",
      "custom",
    ]);
    expect(new Set(PIPELINE_AGENT_PRESETS.map((preset) => preset.name)).size)
      .toBe(PIPELINE_AGENT_PRESETS.length);
    expect(PIPELINE_AGENT_PRESETS.every((preset) => preset.instructions.length > 40)).toBe(true);
    expect(pipelineAgentPreset("research")).toMatchObject({
      permission: "read-only",
      color: "cyan",
    });
    expect(pipelineAgentPreset("implement")).toMatchObject({
      permission: "workspace-write",
      color: "purple",
    });
  });

  it("keeps each default agent inside one stage responsibility", () => {
    expect(pipelineAgentPreset("research").instructions).toContain("Do not modify files");
    expect(pipelineAgentPreset("implement").instructions).toContain("Do not run tests");
    expect(pipelineAgentPreset("implement").instructions).not.toContain("upstream Research");
    expect(pipelineAgentPreset("implement").instructions).toContain(
      "Do not perform a separate code review",
    );
    expect(pipelineAgentPreset("review").instructions).toContain("Do not modify files");
    expect(pipelineAgentPreset("review").instructions).toContain("or run tests");
    expect(pipelineAgentPreset("fix-review").instructions).toContain(
      "Address only the actionable findings",
    );
    expect(pipelineAgentPreset("fix-review").instructions).toContain("Do not repeat the review");
    expect(pipelineAgentPreset("verify").instructions).toContain("Do not modify source files");
    expect(pipelineAgentPreset("verify").instructions).toContain("do not fix failures");
  });

  it("migrates untouched legacy defaults without replacing custom instructions", () => {
    const legacyImplement = migratePipelineAgentPreset(
      "Implement",
      "Implement the task completely in the active project. Use upstream research and plans as context, preserve existing work, follow project conventions, and run focused verification for the changes you make.",
      "workspace-write",
    );
    expect(legacyImplement.instructions).toBe(pipelineAgentPreset("implement").instructions);

    const preGlobalImplement = migratePipelineAgentPreset(
      "Implement",
      "Implement only the requested change in the active project. Use upstream Research as context, inspect only the files needed to edit, preserve existing work, follow project conventions, and make the necessary source and test-file edits. Do not run tests, type checks, linters, builds, git diff --check, or any other verification. Do not perform a separate code review or commit and push. Stop when the implementation edits are complete and report only the files changed and any blockers.",
      "workspace-write",
    );
    expect(preGlobalImplement.instructions).toBe(pipelineAgentPreset("implement").instructions);

    const legacyFixReview = migratePipelineAgentPreset(
      "Fix Review Comments",
      "Complete this stage using the original task and upstream handoffs. Return a clear, self-contained result for downstream steps.",
      "read-only",
    );
    expect(legacyFixReview).toEqual({
      instructions: pipelineAgentPreset("fix-review").instructions,
      permission: "workspace-write",
    });

    expect(migratePipelineAgentPreset(
      "Implement",
      "Implement this special generated-file workflow.",
      "full-access",
    )).toEqual({
      instructions: "Implement this special generated-file workflow.",
      permission: "full-access",
    });
  });
});
