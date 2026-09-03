import { describe, expect, it } from "vitest";
import {
  createPipelineHandoffDocument,
  isPipelineHandoffDocument,
  PIPELINE_HANDOFF_REQUIRED_SECTIONS,
} from "./handoff";

describe("pipeline handoff documents", () => {
  it("wraps an arbitrary provider response in the Code Engine contract", () => {
    const document = createPipelineHandoffDocument("Research", "Found the relevant files.");

    expect(document).toContain("# Handoff: Research");
    expect(document).toContain("Found the relevant files.");
    expect(PIPELINE_HANDOFF_REQUIRED_SECTIONS.every((section) => document.includes(section)))
      .toBe(true);
    expect(isPipelineHandoffDocument(document)).toBe(true);
  });

  it("preserves a conforming response while making the stage identity authoritative", () => {
    const response = [
      "# Handoff: Wrong stage",
      "",
      "## Summary",
      "Reviewed the change.",
      "",
      "## Details",
      "No findings.",
      "",
      "## Artifacts",
      "- `src/main.ts`",
      "",
      "## Blockers",
      "None",
      "",
      "## Suggested skills",
      "None",
    ].join("\r\n");

    const document = createPipelineHandoffDocument("Review\nInjected", response);

    expect(document).toBe(response
      .replace(/\r\n/g, "\n")
      .replace("# Handoff: Wrong stage", "# Handoff: Review Injected"));
    expect(createPipelineHandoffDocument("Review Injected", document)).toBe(document);
  });

  it("adds only missing sections to a partially structured response", () => {
    const document = createPipelineHandoffDocument(
      "Verify",
      "## Summary\n\nChecks passed.\n\n## Blockers\n\nNone",
    );

    expect(document.match(/^## Summary$/gm)).toHaveLength(1);
    expect(document.match(/^## Blockers$/gm)).toHaveLength(1);
    expect(document).toContain("## Suggested skills\n\nNone reported.");
  });

  it("ignores document headings inside fenced code", () => {
    const response = [
      "A model returned this example:",
      "",
      "```markdown",
      "# Handoff: Fake",
      "## Summary",
      "## Details",
      "## Artifacts",
      "## Blockers",
      "## Suggested skills",
      "```",
    ].join("\n");

    expect(isPipelineHandoffDocument(response)).toBe(false);
    const document = createPipelineHandoffDocument("Research", response);
    expect(isPipelineHandoffDocument(document)).toBe(true);
    expect(document.match(/^## Summary$/gm)).toHaveLength(2);
  });

  it("requires the handoff title to be the first content line", () => {
    const response = [
      "Preamble",
      "# Handoff: Review",
      ...PIPELINE_HANDOFF_REQUIRED_SECTIONS.flatMap((section) => [section, "None"]),
    ].join("\n\n");

    expect(isPipelineHandoffDocument(response)).toBe(false);
    expect(createPipelineHandoffDocument("Review", response).startsWith("# Handoff: Review\n"))
      .toBe(true);
  });
});
