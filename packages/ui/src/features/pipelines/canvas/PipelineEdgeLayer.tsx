import { For, Show, createMemo, createUniqueId } from "solid-js";
import type {
  PipelineEdge,
  PipelineEdgeRunState,
  PipelineNode,
  PipelineNodeRunState,
  PipelinePoint,
  PipelineViewport,
} from "../types";
import {
  pipelineEdgePath,
  pipelineNodeSize,
  pointInViewport,
} from "./geometry";
import { pipelineRunTone, type PipelineRunTone } from "./runState";

type EdgeRunState = Pick<PipelineNodeRunState, "status" | "output" | "error">;

export interface PipelineEdgeLayerProps {
  nodes: readonly PipelineNode[];
  edges: readonly PipelineEdge[];
  positions: Readonly<Record<string, PipelinePoint | undefined>>;
  runStates: Readonly<Record<string, EdgeRunState | undefined>>;
  edgeRunStates: Readonly<Record<string, PipelineEdgeRunState | undefined>>;
  viewport: PipelineViewport;
  selectedEdgeId: string | null;
  connectionSource: string | null;
  previewTarget: PipelinePoint | null;
  onSelectEdge: (edgeId: string) => void;
}

interface EdgePoints {
  from: PipelinePoint;
  to: PipelinePoint;
  source: PipelineNode;
  target: PipelineNode;
}

function edgeTone(
  edge: PipelineEdge,
  runStates: Readonly<Record<string, EdgeRunState | undefined>>,
  edgeRunStates: Readonly<Record<string, PipelineEdgeRunState | undefined>>,
): PipelineRunTone {
  const approvalStatus = edge.mode === "approval" ? edgeRunStates[edge.id]?.status : undefined;
  if (approvalStatus === "waitingForApproval") return "attention";
  if (approvalStatus === "approved") return "success";
  if (approvalStatus === "rejected") return "failed";
  if (approvalStatus === "cancelled" || approvalStatus === "skipped") return "cancelled";
  const source = pipelineRunTone(runStates[edge.source]?.status);
  const target = pipelineRunTone(runStates[edge.target]?.status);
  if (source === "failed" || target === "failed") return "failed";
  if (source === "attention" || target === "attention") return "attention";
  if (source === "active" || target === "active") return "active";
  if (source === "success" || target === "success") return "success";
  if (source === "cancelled" || target === "cancelled") return "cancelled";
  if (source === "ready" || target === "ready") return "ready";
  return "idle";
}

function edgeStatusLabel(tone: PipelineRunTone): string {
  if (tone === "active") return "active";
  if (tone === "attention") return "waiting for approval";
  if (tone === "success") return "completed";
  if (tone === "failed") return "failed";
  if (tone === "cancelled") return "cancelled";
  if (tone === "ready") return "ready";
  return "idle";
}

export function PipelineEdgeLayer(props: PipelineEdgeLayerProps) {
  const markerPrefix = createUniqueId().replace(/[^a-zA-Z0-9_-]/g, "");
  const nodeMap = createMemo(() => new Map(props.nodes.map((node) => [node.id, node])));
  const outgoingCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of props.edges) counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    return counts;
  });

  const nodePosition = (node: PipelineNode): PipelinePoint =>
    props.positions[node.id] ?? node.position;

  const portPoint = (node: PipelineNode, port: "input" | "output"): PipelinePoint => {
    const position = nodePosition(node);
    const size = pipelineNodeSize(node);
    return pointInViewport(
      {
        x: position.x + (port === "output" ? size.width : 0),
        y: position.y + size.height / 2,
      },
      props.viewport,
    );
  };

  const pointsFor = (edge: PipelineEdge): EdgePoints | null => {
    const source = nodeMap().get(edge.source);
    const target = nodeMap().get(edge.target);
    if (!source || !target) return null;
    return {
      from: portPoint(source, "output"),
      to: portPoint(target, "input"),
      source,
      target,
    };
  };

  const markerId = (tone: PipelineRunTone) => `${markerPrefix}-${tone}`;

  const preview = () => {
    if (!props.connectionSource || !props.previewTarget) return null;
    const source = nodeMap().get(props.connectionSource);
    if (!source || source.type === "output") return null;
    return {
      from: portPoint(source, "output"),
      to: props.previewTarget,
    };
  };

  return (
    <svg class="pipeline-edge-layer" aria-label="Pipeline connections">
      <defs>
        <For each={["idle", "ready", "active", "attention", "success", "failed", "cancelled"] as PipelineRunTone[]}>
          {(tone) => (
            <marker
              id={markerId(tone)}
              class={`pipeline-edge-marker tone-${tone}`}
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="8"
              markerHeight="8"
              orient="auto-start-reverse"
              markerUnits="userSpaceOnUse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" />
            </marker>
          )}
        </For>
        <marker
          id={`${markerPrefix}-preview`}
          class="pipeline-edge-marker tone-active"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
        <marker
          id={`${markerPrefix}-approval`}
          class="pipeline-edge-marker approval"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="8"
          markerHeight="8"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" />
        </marker>
      </defs>

      <For each={props.edges}>
        {(edge) => (
          <Show when={pointsFor(edge)}>
            {(points) => {
              const tone = () => edgeTone(edge, props.runStates, props.edgeRunStates);
              const path = () => pipelineEdgePath(points().from, points().to);
              const selected = () => props.selectedEdgeId === edge.id;
              const label = () =>
                `${points().source.name} to ${points().target.name}, ${edge.mode === "approval" ? "approval connection" : "automatic connection"}, ${edgeStatusLabel(tone())}`;
              const midpoint = () => ({
                x: (points().from.x + points().to.x) / 2,
                y: (points().from.y + points().to.y) / 2,
              });
              return (
                <g class={`pipeline-edge mode-${edge.mode} tone-${tone()} ${selected() ? "selected" : ""}`}>
                  <path
                    class="pipeline-edge-visible"
                    d={path()}
                    marker-end={`url(#${edge.mode === "approval" ? `${markerPrefix}-approval` : markerId(tone())})`}
                    aria-hidden="true"
                  />
                  <Show when={tone() === "active" || tone() === "attention"}>
                    <path class="pipeline-edge-flow" d={path()} aria-hidden="true" />
                  </Show>
                  <path
                    class="pipeline-edge-hit"
                    d={path()}
                    fill="none"
                    stroke="transparent"
                    stroke-width="24"
                    tabindex="0"
                    role="button"
                    aria-label={label()}
                    aria-pressed={selected()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      props.onSelectEdge(edge.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        props.onSelectEdge(edge.id);
                      }
                    }}
                  >
                    <title>{label()}</title>
                  </path>
                  <Show when={edge.mode === "approval"}>
                    <g
                      class={`pipeline-edge-gate tone-${tone()}`}
                      transform={`translate(${midpoint().x}, ${midpoint().y})`}
                      aria-hidden="true"
                    >
                      <rect x="-15" y="-7" width="30" height="14" rx="5" />
                      <text text-anchor="middle" dominant-baseline="central">GATE</text>
                    </g>
                  </Show>
                  <Show when={(outgoingCounts().get(edge.source) ?? 0) > 1}>
                    <text
                      class="pipeline-edge-order"
                      x={midpoint().x}
                      y={midpoint().y - 8}
                      text-anchor="middle"
                      aria-hidden="true"
                    >
                      {edge.order + 1}
                    </text>
                  </Show>
                </g>
              );
            }}
          </Show>
        )}
      </For>

      <Show when={preview()}>
        {(points) => (
          <path
            class="pipeline-edge-preview"
            d={pipelineEdgePath(points().from, points().to)}
            marker-end={`url(#${markerPrefix}-preview)`}
            aria-hidden="true"
          />
        )}
      </Show>
    </svg>
  );
}
