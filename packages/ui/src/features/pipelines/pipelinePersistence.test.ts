import { beforeEach, describe, expect, it } from "vitest";
import {
  createStarterPipeline,
  loadPipelines,
  savePipelines,
} from "./pipelinePersistence";

const values = new Map<string, string>();

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

describe("pipeline persistence", () => {
  it("round-trips approval connections with their reviewer message", () => {
    const pipeline = createStarterPipeline("Guarded pipeline", "gpt-test", "medium");
    const approval = pipeline.edges.at(-1)!;
    approval.mode = "approval";
    approval.approvalMessage = "Check the implementation and tests before continuing.";

    expect(savePipelines("/project", [pipeline], pipeline.id)).toBe(true);
    const loaded = loadPipelines("/project", createStarterPipeline());
    expect(loaded.pipelines[0].edges.find((edge) => edge.id === approval.id)).toMatchObject({
      mode: "approval",
      approvalMessage: "Check the implementation and tests before continuing.",
    });
  });

  it("loads legacy connections as automatic handoffs", () => {
    const pipeline = createStarterPipeline("Legacy pipeline", "gpt-test", "medium");
    const legacy = JSON.parse(JSON.stringify(pipeline)) as Record<string, unknown>;
    for (const edge of legacy.edges as Array<Record<string, unknown>>) {
      delete edge.mode;
      delete edge.approvalMessage;
    }
    values.set("ce.pipelines.v1:/legacy", JSON.stringify({
      schemaVersion: 1,
      selectedId: pipeline.id,
      pipelines: [legacy],
    }));
    const loaded = loadPipelines("/legacy", createStarterPipeline());
    expect(loaded.pipelines[0].edges.every(
      (edge) => edge.mode === "automatic" && edge.approvalMessage === "",
    )).toBe(true);
  });

  it("migrates a simple legacy approval node into an approval connection", () => {
    const pipeline = createStarterPipeline("Legacy approval", "gpt-test", "medium");
    const output = pipeline.nodes.find((node) => node.type === "output")!;
    const previous = pipeline.edges.find((edge) => edge.target === output.id)!;
    pipeline.nodes.splice(-1, 0, {
      id: "legacy-approval",
      type: "approval",
      name: "Release approval",
      position: { x: 1050, y: 220 },
      message: "Approve the release handoff.",
      color: "orange",
    });
    pipeline.edges = [
      ...pipeline.edges.filter((edge) => edge.id !== previous.id),
      { ...previous, id: "into-approval", target: "legacy-approval" },
      { ...previous, id: "out-of-approval", source: "legacy-approval" },
    ];

    savePipelines("/legacy-approval", [pipeline], pipeline.id);
    const loaded = loadPipelines("/legacy-approval", createStarterPipeline()).pipelines[0];
    expect(loaded.nodes.some((node) => node.type === "approval")).toBe(false);
    expect(loaded.edges).toContainEqual(expect.objectContaining({
      source: previous.source,
      target: output.id,
      mode: "approval",
      approvalMessage: "Approve the release handoff.",
    }));
  });
});
