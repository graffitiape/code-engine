import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIPELINE_AGENT_LIBRARY_LIMIT,
  PIPELINE_AGENT_LIBRARY_STORAGE_KEY,
  loadPipelineAgentLibrary,
  savePipelineAgentLibrary,
  savedAgentFromNode,
  savedAgentMatchesNode,
  type SavedPipelineAgent,
} from "./pipelineAgentLibrary";
import type { PipelineAgentNode } from "./types";

const values = new Map<string, string>();

function savedAgent(overrides: Partial<SavedPipelineAgent> = {}): SavedPipelineAgent {
  return {
    id: "saved-agent:release-writer",
    name: "Release writer",
    instructions: "Write concise release notes from the completed work.",
    model: "gpt-test",
    effort: "high",
    permission: "read-only",
    retryCount: 2,
    color: "yellow",
    ...overrides,
  };
}

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
      clear: () => values.clear(),
    },
  });
});

describe("pipeline agent library persistence", () => {
  it("round-trips agents through one app-wide storage key", () => {
    const agent = savedAgent();

    expect(savePipelineAgentLibrary([agent])).toBe(true);
    expect([...values.keys()]).toEqual([PIPELINE_AGENT_LIBRARY_STORAGE_KEY]);
    expect(loadPipelineAgentLibrary()).toEqual([agent]);
  });

  it("keeps usable records while normalizing malformed optional fields", () => {
    values.set(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, JSON.stringify({
      schemaVersion: 1,
      agents: [
        savedAgent({ retryCount: 99, color: "not-a-color" }),
        savedAgent({ id: "duplicate", name: "Duplicate" }),
        savedAgent({ id: "duplicate", name: "Ignored duplicate" }),
        { ...savedAgent({ id: "unsafe" }), permission: "god-mode" },
        { ...savedAgent({ id: "blank" }), instructions: " " },
        savedAgent({ id: "oversized", name: "x".repeat(121) }),
      ],
    }));

    expect(loadPipelineAgentLibrary()).toEqual([
      savedAgent({ retryCount: 3, color: "purple" }),
      savedAgent({ id: "duplicate", name: "Duplicate" }),
    ]);
  });

  it("caps oversized libraries without rejecting their valid prefix", () => {
    const agents = Array.from(
      { length: PIPELINE_AGENT_LIBRARY_LIMIT + 5 },
      (_, index) => savedAgent({ id: `saved:${index}`, name: `Agent ${index}` }),
    );
    values.set(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, JSON.stringify({ schemaVersion: 1, agents }));

    const loaded = loadPipelineAgentLibrary();
    expect(loaded).toHaveLength(PIPELINE_AGENT_LIBRARY_LIMIT);
    expect(loaded.at(-1)?.id).toBe(`saved:${PIPELINE_AGENT_LIBRARY_LIMIT - 1}`);
  });

  it.each([
    ["malformed JSON", "{"],
    ["unknown schema", JSON.stringify({ schemaVersion: 2, agents: [savedAgent()] })],
    ["invalid envelope", JSON.stringify({ schemaVersion: 1, agents: {} })],
  ])("fails closed for %s", (_label, persisted) => {
    values.set(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, persisted);
    expect(loadPipelineAgentLibrary()).toEqual([]);
  });

  it("reports storage failures without overwriting the previous library", () => {
    const original = JSON.stringify({ schemaVersion: 1, agents: [savedAgent()] });
    values.set(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, original);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    expect(savePipelineAgentLibrary([savedAgent({ name: "Changed" })])).toBe(false);
    expect(values.get(PIPELINE_AGENT_LIBRARY_STORAGE_KEY)).toBe(original);
  });

  it("does not overwrite a library written by a newer schema", () => {
    const future = JSON.stringify({ schemaVersion: 2, agents: [savedAgent()] });
    values.set(PIPELINE_AGENT_LIBRARY_STORAGE_KEY, future);

    expect(savePipelineAgentLibrary([savedAgent({ name: "Downgrade write" })])).toBe(false);
    expect(values.get(PIPELINE_AGENT_LIBRARY_STORAGE_KEY)).toBe(future);
  });
});

describe("saved agent snapshots", () => {
  it("normalizes an agent node without retaining graph identity or position", () => {
    const node: PipelineAgentNode = {
      id: "node:one",
      type: "agent",
      name: "  Release writer  ",
      position: { x: 100, y: 200 },
      instructions: "  Write the notes.  ",
      model: "gpt-test",
      effort: "high",
      permission: "read-only",
      retryCount: 2,
      color: "yellow",
    };

    const saved = savedAgentFromNode(node, "saved:one");
    expect(saved).toEqual({
      id: "saved:one",
      name: "Release writer",
      instructions: "  Write the notes.  ",
      model: "gpt-test",
      effort: "high",
      permission: "read-only",
      retryCount: 2,
      color: "yellow",
    });
    expect(savedAgentMatchesNode(saved!, node)).toBe(true);
  });

  it("accepts exact text limits and rejects snapshots that would lose content", () => {
    const node: PipelineAgentNode = {
      id: "node:bounded",
      type: "agent",
      name: "n".repeat(120),
      position: { x: 0, y: 0 },
      instructions: "i".repeat(16_000),
      model: "gpt-test",
      effort: "medium",
      permission: "workspace-write",
      retryCount: 1,
      color: "purple",
    };

    expect(savedAgentFromNode(node, "saved:bounded")).not.toBeNull();
    expect(savedAgentFromNode({ ...node, instructions: `${node.instructions}x` })).toBeNull();
    expect(savedAgentFromNode({ ...node, name: `${node.name}x` })).toBeNull();
  });
});
