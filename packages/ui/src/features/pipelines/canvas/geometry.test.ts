import { describe, expect, it } from "vitest";
import type { PipelineEdge, PipelineNode } from "../types";
import {
  PIPELINE_MAX_ZOOM,
  PIPELINE_MIN_ZOOM,
  clampPipelineZoom,
  connectionWouldCycle,
  fitPipelineViewport,
  pipelinePortPoint,
  pointFromViewport,
  pointInViewport,
} from "./geometry";

const nodes: PipelineNode[] = [
  { id: "input", type: "input", name: "Task", position: { x: 0, y: 100 } },
  {
    id: "agent",
    type: "agent",
    name: "Builder",
    position: { x: 320, y: 60 },
    instructions: "Build the requested change.",
    model: "codex",
    effort: "medium",
    permission: "workspace-write",
    retryCount: 1,
    color: "purple",
  },
  { id: "output", type: "output", name: "Result", position: { x: 680, y: 100 } },
];

const edges: PipelineEdge[] = [
  { id: "a", source: "input", target: "agent", order: 0, mode: "automatic", approvalMessage: "" },
  { id: "b", source: "agent", target: "output", order: 0, mode: "automatic", approvalMessage: "" },
];

describe("pipeline canvas geometry", () => {
  it("clamps zoom and preserves the pointer anchor through coordinate conversion", () => {
    expect(clampPipelineZoom(0.1)).toBe(PIPELINE_MIN_ZOOM);
    expect(clampPipelineZoom(4)).toBe(PIPELINE_MAX_ZOOM);

    const viewport = { x: 120, y: -40, zoom: 1.5 };
    const world = { x: 200, y: 90 };
    expect(pointFromViewport(pointInViewport(world, viewport), viewport)).toEqual(world);
  });

  it("places terminal and agent ports at the vertical midpoint", () => {
    expect(pipelinePortPoint(nodes[0], "output")).toEqual({ x: 208, y: 150 });
    expect(pipelinePortPoint(nodes[1], "input")).toEqual({ x: 320, y: 152 });
    expect(pipelinePortPoint(nodes[1], "output")).toEqual({ x: 584, y: 152 });
  });

  it("distributes fan-in anchors vertically in stable slot order", () => {
    expect(pipelinePortPoint(nodes[1], "input", 0, 3)).toEqual({ x: 320, y: 92 });
    expect(pipelinePortPoint(nodes[1], "input", 1, 3)).toEqual({ x: 320, y: 152 });
    expect(pipelinePortPoint(nodes[1], "input", 2, 3)).toEqual({ x: 320, y: 212 });
    expect(pipelinePortPoint(nodes[2], "input", 0, 3)).toEqual({ x: 680, y: 122 });
    expect(pipelinePortPoint(nodes[2], "input", 2, 3)).toEqual({ x: 680, y: 178 });
  });

  it("detects only connections that close a directed cycle", () => {
    expect(connectionWouldCycle(edges, "output", "input")).toBe(true);
    expect(connectionWouldCycle(edges, "input", "output")).toBe(false);
  });

  it("fits every node into a finite bounded viewport", () => {
    const viewport = fitPipelineViewport(nodes, 1200, 720);
    expect(Number.isFinite(viewport.x)).toBe(true);
    expect(Number.isFinite(viewport.y)).toBe(true);
    expect(viewport.zoom).toBeGreaterThanOrEqual(PIPELINE_MIN_ZOOM);
    expect(viewport.zoom).toBeLessThanOrEqual(PIPELINE_MAX_ZOOM);

    for (const node of nodes) {
      const point = pointInViewport(node.position, viewport);
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.y).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThan(1200);
      expect(point.y).toBeLessThan(720);
    }
  });
});
