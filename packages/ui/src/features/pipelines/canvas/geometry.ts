import type {
  PipelineEdge,
  PipelineNode,
  PipelinePoint,
  PipelineViewport,
} from "../types";

export interface PipelineNodeSize {
  width: number;
  height: number;
}

export const PIPELINE_MIN_ZOOM = 0.35;
export const PIPELINE_MAX_ZOOM = 2;

const AGENT_NODE_SIZE: PipelineNodeSize = { width: 264, height: 184 };
const TERMINAL_NODE_SIZE: PipelineNodeSize = { width: 208, height: 100 };

export function pipelineNodeSize(node: PipelineNode): PipelineNodeSize {
  return node.type === "agent" ? AGENT_NODE_SIZE : TERMINAL_NODE_SIZE;
}

export function pipelinePortPoint(
  node: PipelineNode,
  port: "input" | "output",
): PipelinePoint {
  const size = pipelineNodeSize(node);
  return {
    x: node.position.x + (port === "output" ? size.width : 0),
    y: node.position.y + size.height / 2,
  };
}

export function pointInViewport(
  point: PipelinePoint,
  viewport: PipelineViewport,
): PipelinePoint {
  return {
    x: viewport.x + point.x * viewport.zoom,
    y: viewport.y + point.y * viewport.zoom,
  };
}

export function pointFromViewport(
  point: PipelinePoint,
  viewport: PipelineViewport,
): PipelinePoint {
  const zoom = clampPipelineZoom(viewport.zoom);
  return {
    x: (point.x - viewport.x) / zoom,
    y: (point.y - viewport.y) / zoom,
  };
}

export function clampPipelineZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(PIPELINE_MAX_ZOOM, Math.max(PIPELINE_MIN_ZOOM, zoom));
}

export function pipelineEdgePath(from: PipelinePoint, to: PipelinePoint): string {
  const distance = Math.abs(to.x - from.x);
  const bend = Math.max(48, Math.min(260, distance * 0.48));
  return [
    `M ${from.x} ${from.y}`,
    `C ${from.x + bend} ${from.y}`,
    `${to.x - bend} ${to.y}`,
    `${to.x} ${to.y}`,
  ].join(" ");
}

export function fitPipelineViewport(
  nodes: readonly PipelineNode[],
  width: number,
  height: number,
  padding = 72,
): PipelineViewport {
  if (!nodes.length || width <= 0 || height <= 0) {
    return { x: 0, y: 0, zoom: 1 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const size = pipelineNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  const contentWidth = Math.max(1, maxX - minX);
  const contentHeight = Math.max(1, maxY - minY);
  const availableWidth = Math.max(1, width - padding * 2);
  const availableHeight = Math.max(1, height - padding * 2);
  const zoom = clampPipelineZoom(
    Math.min(availableWidth / contentWidth, availableHeight / contentHeight, 1.25),
  );

  return {
    x: (width - contentWidth * zoom) / 2 - minX * zoom,
    y: (height - contentHeight * zoom) / 2 - minY * zoom,
    zoom,
  };
}

export function connectionWouldCycle(
  edges: readonly PipelineEdge[],
  source: string,
  target: string,
): boolean {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const targets = outgoing.get(edge.source) ?? [];
    targets.push(edge.target);
    outgoing.set(edge.source, targets);
  }

  const pending = [target];
  const visited = new Set<string>();
  while (pending.length) {
    const current = pending.pop()!;
    if (current === source) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    pending.push(...(outgoing.get(current) ?? []));
  }
  return false;
}
