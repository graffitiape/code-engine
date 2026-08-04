import { describe, expect, it } from "vitest";
import { edgeEnabledIndex, nextEnabledIndex, typeaheadIndex } from "./selectLogic";

const options = [
  { label: "Alpha" },
  { label: "Beta", disabled: true },
  { label: "Gamma" },
];

describe("custom select navigation", () => {
  it("wraps and skips disabled options", () => {
    expect(nextEnabledIndex(options, 0, 1)).toBe(2);
    expect(nextEnabledIndex(options, 2, 1)).toBe(0);
    expect(nextEnabledIndex(options, 0, -1)).toBe(2);
  });

  it("finds enabled edges", () => {
    expect(edgeEnabledIndex(options, "first")).toBe(0);
    expect(edgeEnabledIndex(options, "last")).toBe(2);
  });

  it("searches labels from the current position", () => {
    expect(typeaheadIndex(options, "g", 0)).toBe(2);
    expect(typeaheadIndex(options, "a", 2)).toBe(0);
    expect(typeaheadIndex(options, "b", 0)).toBe(-1);
  });
});
