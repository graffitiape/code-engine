import { describe, expect, it } from "vitest";
import { pipelineTaskPrompt } from "./pipelineExecution";

describe("pipeline task execution prompt", () => {
  it("rejects a missing title", () => {
    expect(pipelineTaskPrompt("  ", "Brief without a title")).toBe("");
  });

  it("uses only the heading for a title-only task", () => {
    expect(pipelineTaskPrompt("  Title only  ", "  ")).toBe("# Title only");
  });

  it("separates a title and brief with one blank line", () => {
    expect(pipelineTaskPrompt("Title", "  Detailed brief  ")).toBe("# Title\n\nDetailed brief");
  });
});
