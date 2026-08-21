import { describe, expect, it } from "vitest";
import { PIPELINE_AGENT_PRESETS, pipelineAgentPreset } from "./agentPresets";

describe("pipeline agent presets", () => {
  it("provides distinct, runnable defaults for every chooser option", () => {
    expect(PIPELINE_AGENT_PRESETS.map((preset) => preset.id)).toEqual([
      "research",
      "implement",
      "review",
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
});
