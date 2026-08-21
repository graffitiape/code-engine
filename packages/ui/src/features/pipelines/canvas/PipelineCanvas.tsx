import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  createUniqueId,
} from "solid-js";
import type { JSX } from "solid-js";
import type {
  PipelineConnectionMode,
  PipelineEdge,
  PipelineEdgeRunState,
  PipelineNode,
  PipelineNodeRunState,
  PipelinePoint,
  PipelineViewport,
} from "../types";
import {
  PIPELINE_MAX_ZOOM,
  PIPELINE_MIN_ZOOM,
  clampPipelineZoom,
  connectionWouldCycle,
  fitPipelineViewport,
  pipelineNodeSize,
  pipelinePortPoint,
  pointInViewport,
} from "./geometry";
import { PipelineEdgeLayer } from "./PipelineEdgeLayer";
import { PipelineNodeCard } from "./PipelineNodeCard";
import "../../../styles/pipelines.css";

export type PipelineCanvasRunState = Pick<
  PipelineNodeRunState,
  "status" | "output" | "error"
>;

export interface PipelineCanvasProps {
  nodes: readonly PipelineNode[];
  edges: readonly PipelineEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  runStates: Readonly<Record<string, PipelineCanvasRunState | undefined>>;
  edgeRunStates: Readonly<Record<string, PipelineEdgeRunState | undefined>>;
  viewport: PipelineViewport;
  connectionSource: string | null;
  readOnly?: boolean;
  onSelectNode: (nodeId: string | null) => void;
  onSelectEdge: (edgeId: string | null) => void;
  onMoveCommit: (nodeId: string, position: PipelinePoint) => void;
  onConnect: (source: string, target: string, mode: PipelineConnectionMode) => boolean;
  onDeleteNode: (nodeId: string) => void;
  onDeleteEdge: (edgeId: string) => void;
  onViewportChange: (viewport: PipelineViewport) => void;
  onConnectionSourceChange: (nodeId: string | null) => void;
  onErrorAnnouncement?: (message: string) => void;
  ariaLabel?: string;
  class?: string;
}

interface DragPreview {
  nodeId: string;
  position: PipelinePoint;
}

interface CanvasPan {
  pointerId: number;
  clientX: number;
  clientY: number;
  viewport: PipelineViewport;
}

interface ConnectionChoice {
  sourceId: string;
  targetId: string;
  left: number;
  top: number;
}

const GRID_SIZE = 28;

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(target.closest("input, textarea, select, [contenteditable='true']"))
  );
}

function isCanvasControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest(
        ".pipeline-node-card, .pipeline-edge-hit, .pipeline-canvas-toolbar, button",
      ),
    )
  );
}

export function PipelineCanvas(props: PipelineCanvasProps) {
  const instructionsId = createUniqueId();
  const [dragPreview, setDragPreview] = createSignal<DragPreview | null>(null);
  const [previewTarget, setPreviewTarget] = createSignal<PipelinePoint | null>(null);
  const [announcement, setAnnouncement] = createSignal("");
  const [panning, setPanning] = createSignal(false);
  const [connectionChoice, setConnectionChoice] = createSignal<ConnectionChoice | null>(null);
  let viewportRef: HTMLDivElement | undefined;
  let pan: CanvasPan | null = null;
  let observedConnectionSource: string | null = null;

  const zoom = () => clampPipelineZoom(props.viewport.zoom);
  const nodeMap = createMemo(() => new Map(props.nodes.map((node) => [node.id, node])));
  const previewPositions = createMemo<Readonly<Record<string, PipelinePoint | undefined>>>(() => {
    const preview = dragPreview();
    return preview ? { [preview.nodeId]: preview.position } : {};
  });
  const incomingCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of props.edges) {
      counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
    }
    return counts;
  });
  const outgoingCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of props.edges) {
      counts.set(edge.source, (counts.get(edge.source) ?? 0) + 1);
    }
    return counts;
  });
  const joinReadyCounts = createMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of props.edges) {
      const sourceReady = props.runStates[edge.source]?.status === "completed";
      const approvalReady = edge.mode === "automatic" ||
        props.edgeRunStates[edge.id]?.status === "approved";
      if (sourceReady && approvalReady) {
        counts.set(edge.target, (counts.get(edge.target) ?? 0) + 1);
      }
    }
    return counts;
  });

  const worldStyle = (): JSX.CSSProperties => ({
    transform: `translate(${props.viewport.x}px, ${props.viewport.y}px) scale(${zoom()})`,
  });
  const gridStyle = (): JSX.CSSProperties => ({
    "background-position": [
      `${props.viewport.x}px ${props.viewport.y}px`,
      `${props.viewport.x}px ${props.viewport.y}px`,
      "center",
    ].join(", "),
    "background-size": [
      `${GRID_SIZE * zoom()}px ${GRID_SIZE * zoom()}px`,
      `${GRID_SIZE * zoom()}px ${GRID_SIZE * zoom()}px`,
      "auto",
    ].join(", "),
  });

  const announce = (message: string, error = false) => {
    setAnnouncement("");
    queueMicrotask(() => setAnnouncement(message));
    if (error) props.onErrorAnnouncement?.(message);
  };

  const selectNode = (nodeId: string) => {
    props.onSelectEdge(null);
    props.onSelectNode(nodeId);
  };

  const selectEdge = (edgeId: string) => {
    props.onSelectNode(null);
    props.onSelectEdge(edgeId);
  };

  const clearSelection = () => {
    props.onSelectNode(null);
    props.onSelectEdge(null);
  };

  const localPoint = (event: { clientX: number; clientY: number }): PipelinePoint => {
    const rect = viewportRef?.getBoundingClientRect();
    return {
      x: event.clientX - (rect?.left ?? 0),
      y: event.clientY - (rect?.top ?? 0),
    };
  };

  const setConnectionSource = (nodeId: string | null) => {
    props.onConnectionSourceChange(nodeId);
    if (!nodeId) setPreviewTarget(null);
  };

  const requestConnection = (nodeId: string) => {
    if (props.readOnly) {
      announce("Stop the active run before changing connections.", true);
      return;
    }
    setConnectionChoice(null);
    const node = nodeMap().get(nodeId);
    if (!node || node.type === "output") {
      announce("Only Task Input and Codex Agent nodes can start a connection.", true);
      return;
    }
    if (props.connectionSource === nodeId) {
      setConnectionSource(null);
      announce(`Connection from ${node.name} cancelled.`);
      return;
    }
    setConnectionSource(nodeId);
    setPreviewTarget(pointInViewport(pipelinePortPoint(node, "output"), props.viewport));
    announce(`Connecting from ${node.name}. Choose an input port.`);
  };

  const acceptConnection = (targetId: string) => {
    if (props.readOnly) {
      announce("Stop the active run before changing connections.", true);
      return;
    }
    const sourceId = props.connectionSource;
    const source = sourceId ? nodeMap().get(sourceId) : undefined;
    const target = nodeMap().get(targetId);
    if (!sourceId || !source) {
      announce("Choose an output port before selecting an input port.", true);
      return;
    }
    if (!target || target.type === "input") {
      announce("Task Input nodes cannot receive a connection.", true);
      return;
    }
    if (sourceId === targetId) {
      announce("A node cannot connect to itself.", true);
      return;
    }
    if (source.type === "input" && target.type === "output") {
      announce("Task input must pass through at least one executable step before the result.", true);
      return;
    }
    if (
      props.edges.some((edge) => edge.source === sourceId && edge.target === targetId)
    ) {
      announce(`${source.name} is already connected to ${target.name}.`, true);
      return;
    }
    if (connectionWouldCycle(props.edges, sourceId, targetId)) {
      announce("That connection would create a cycle. Pipelines must remain acyclic.", true);
      return;
    }

    const targetPoint = pointInViewport(pipelinePortPoint(target, "input"), props.viewport);
    const rect = viewportRef?.getBoundingClientRect();
    setConnectionChoice({
      sourceId,
      targetId,
      left: Math.max(12, Math.min(targetPoint.x + 12, (rect?.width ?? 600) - 284)),
      top: Math.max(12, Math.min(targetPoint.y - 54, (rect?.height ?? 500) - 174)),
    });
    setConnectionSource(null);
    announce(`Choose a connection type from ${source.name} to ${target.name}.`);
  };

  const chooseConnectionType = (mode: PipelineConnectionMode) => {
    const choice = connectionChoice();
    if (!choice) return;
    const source = nodeMap().get(choice.sourceId);
    const target = nodeMap().get(choice.targetId);
    if (!source || !target || !props.onConnect(choice.sourceId, choice.targetId, mode)) {
      announce("Could not create that connection.", true);
      return;
    }
    setConnectionChoice(null);
    announce(`${mode === "approval" ? "Approval" : "Automatic"} connection created from ${source.name} to ${target.name}.`);
  };

  const restoreCanvasFocus = () => {
    queueMicrotask(() => viewportRef?.focus({ preventScroll: true }));
  };

  const deleteSelection = (focusedNodeId?: string) => {
    if (props.readOnly) {
      announce("Stop the active run before deleting pipeline elements.", true);
      return;
    }
    if (props.selectedEdgeId) {
      props.onDeleteEdge(props.selectedEdgeId);
      props.onSelectEdge(null);
      announce("Connection deleted.");
      restoreCanvasFocus();
      return;
    }
    const nodeId = focusedNodeId ?? props.selectedNodeId;
    if (!nodeId) return;
    const node = nodeMap().get(nodeId);
    if (!node) return;
    if (node.type !== "agent" && node.type !== "integration" && node.type !== "approval") {
      announce(`${node.name} is required by the pipeline and cannot be deleted.`, true);
      return;
    }
    const connectionCount = props.edges.filter(
      (edge) => edge.source === node.id || edge.target === node.id,
    ).length;
    if (
      connectionCount > 0 &&
      !window.confirm(
        `Remove ${node.name} and ${connectionCount} connected ${connectionCount === 1 ? "wire" : "wires"}?`,
      )
    ) {
      announce("Agent deletion cancelled.");
      return;
    }
    if (props.connectionSource === node.id) setConnectionSource(null);
    props.onDeleteNode(node.id);
    props.onSelectNode(null);
    announce(`${node.name} deleted.`);
    restoreCanvasFocus();
  };

  const startPan = (event: PointerEvent) => {
    if ((event.button !== 0 && event.button !== 1) || isCanvasControl(event.target)) return;
    event.preventDefault();
    if (connectionChoice()) {
      setConnectionChoice(null);
      announce("Connection cancelled.");
    }
    clearSelection();
    if (props.connectionSource && event.button === 0) {
      setConnectionSource(null);
      announce("Connection cancelled.");
    }
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    pan = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      viewport: { ...props.viewport, zoom: zoom() },
    };
    setPanning(true);
  };

  const movePointer = (event: PointerEvent) => {
    if (props.connectionSource) setPreviewTarget(localPoint(event));
    if (!pan || pan.pointerId !== event.pointerId) return;
    event.preventDefault();
    props.onViewportChange({
      x: pan.viewport.x + event.clientX - pan.clientX,
      y: pan.viewport.y + event.clientY - pan.clientY,
      zoom: pan.viewport.zoom,
    });
  };

  const finishPan = (event: PointerEvent) => {
    if (!pan || pan.pointerId !== event.pointerId) return;
    pan = null;
    setPanning(false);
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
  };

  const cancelPan = (event?: PointerEvent) => {
    if (event && pan?.pointerId !== event.pointerId) return;
    const active = pan;
    pan = null;
    setPanning(false);
    if (active && viewportRef?.hasPointerCapture(active.pointerId)) {
      viewportRef.releasePointerCapture(active.pointerId);
    }
  };

  const zoomAt = (nextZoom: number, anchor?: PipelinePoint) => {
    const next = clampPipelineZoom(nextZoom);
    const rect = viewportRef?.getBoundingClientRect();
    const focus = anchor ?? {
      x: (rect?.width ?? 0) / 2,
      y: (rect?.height ?? 0) / 2,
    };
    const current = zoom();
    const worldX = (focus.x - props.viewport.x) / current;
    const worldY = (focus.y - props.viewport.y) / current;
    props.onViewportChange({
      x: focus.x - worldX * next,
      y: focus.y - worldY * next,
      zoom: next,
    });
  };

  const handleWheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta =
      event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY;
    const factor = Math.exp(-delta * 0.0015);
    zoomAt(zoom() * factor, localPoint(event));
  };

  const fitView = () => {
    const rect = viewportRef?.getBoundingClientRect();
    if (!rect) return;
    props.onViewportChange(fitPipelineViewport(props.nodes, rect.width, rect.height));
    announce("Pipeline fitted to the canvas.");
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      if (connectionChoice()) {
        event.preventDefault();
        setConnectionChoice(null);
        announce("Connection cancelled.");
      }
      if (props.connectionSource) {
        event.preventDefault();
        setConnectionSource(null);
        announce("Connection cancelled.");
      }
      setDragPreview(null);
      cancelPan();
      return;
    }
    if (isTextEditingTarget(event.target)) return;

    if (event.key === "Delete" || event.key === "Backspace") {
      if (event.target instanceof Element && event.target.closest("button:not(.pipeline-edge-hit)")) {
        return;
      }
      event.preventDefault();
      const focusedCard = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".pipeline-node-card")
        : null;
      deleteSelection(focusedCard?.dataset.nodeId);
      return;
    }

    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      if (event.target instanceof Element && event.target.closest("button")) return;
      const focusedCard = event.target instanceof Element
        ? event.target.closest<HTMLElement>(".pipeline-node-card")
        : null;
      const focusedNodeId = focusedCard?.dataset.nodeId;
      const node = focusedNodeId ? nodeMap().get(focusedNodeId) : undefined;
      event.preventDefault();
      if (!node || event.altKey) {
        const step = event.shiftKey ? 120 : 40;
        const deltaX = event.key === "ArrowLeft" ? step : event.key === "ArrowRight" ? -step : 0;
        const deltaY = event.key === "ArrowUp" ? step : event.key === "ArrowDown" ? -step : 0;
        props.onViewportChange({
          x: props.viewport.x + deltaX,
          y: props.viewport.y + deltaY,
          zoom: zoom(),
        });
        const direction = event.key.replace("Arrow", "").toLowerCase();
        announce(`Canvas panned ${direction}.`);
        return;
      }
      if (props.readOnly) {
        announce("Stop the active run before moving steps.", true);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      const deltaX = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
      const deltaY = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
      props.onMoveCommit(node.id, {
        x: node.position.x + deltaX,
        y: node.position.y + deltaY,
      });
      announce(
        `${node.name} moved to ${node.position.x + deltaX}, ${node.position.y + deltaY}.`,
      );
      return;
    }

    if (event.key === "0" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      fitView();
    }
  };

  createEffect(() => {
    if (!props.readOnly) return;
    setDragPreview(null);
    setConnectionChoice(null);
    if (props.connectionSource) {
      setConnectionSource(null);
      announce("Connection cancelled because the pipeline run started.");
    }
  });

  createEffect(() => {
    const sourceId = props.connectionSource;
    if (sourceId === observedConnectionSource) return;
    observedConnectionSource = sourceId;
    if (!sourceId) {
      setPreviewTarget(null);
      return;
    }
    const source = nodeMap().get(sourceId);
    if (source && source.type !== "output") {
      setPreviewTarget(pointInViewport(pipelinePortPoint(source, "output"), props.viewport));
    }
  });

  return (
    <section
      class={`pipeline-canvas-shell ${props.class ?? ""}`}
      aria-label={props.ariaLabel ?? "Pipeline canvas"}
    >
      <div
        ref={viewportRef}
        class="pipeline-canvas-viewport"
        classList={{
          panning: panning(),
          connecting: Boolean(props.connectionSource),
          "read-only": Boolean(props.readOnly),
        }}
        style={gridStyle()}
        role="region"
        tabindex="0"
        aria-label={props.ariaLabel ?? "Pipeline canvas"}
        aria-describedby={instructionsId}
        onPointerDown={startPan}
        onPointerMove={movePointer}
        onPointerUp={finishPan}
        onPointerCancel={cancelPan}
        onLostPointerCapture={() => {
          if (pan) cancelPan();
        }}
        onWheel={handleWheel}
        onKeyDown={handleKeyDown}
      >
        <PipelineEdgeLayer
          nodes={props.nodes}
          edges={props.edges}
          positions={previewPositions()}
          runStates={props.runStates}
          edgeRunStates={props.edgeRunStates}
          viewport={{ ...props.viewport, zoom: zoom() }}
          selectedEdgeId={props.selectedEdgeId}
          connectionSource={props.connectionSource}
          previewTarget={previewTarget()}
          onSelectEdge={selectEdge}
        />

        <div class="pipeline-canvas-world" style={worldStyle()}>
          <For each={props.nodes}>
            {(node) => (
              <PipelineNodeCard
                node={node}
                position={previewPositions()[node.id] ?? node.position}
                selected={props.selectedNodeId === node.id}
                runState={props.runStates[node.id]}
                zoom={zoom()}
                connectionSource={props.connectionSource}
                readOnly={props.readOnly}
                incomingCount={incomingCounts().get(node.id) ?? 0}
                joinReadyCount={props.runStates[node.id]
                  ? joinReadyCounts().get(node.id) ?? 0
                  : undefined}
                outgoingCount={outgoingCounts().get(node.id) ?? 0}
                onSelect={selectNode}
                onMovePreview={(nodeId, position) =>
                  setDragPreview(position ? { nodeId, position } : null)
                }
                onMoveCommit={props.onMoveCommit}
                onRequestConnection={requestConnection}
                onAcceptConnection={acceptConnection}
              />
            )}
          </For>
        </div>

        <Show when={connectionChoice()}>
          {(choice) => {
            const source = () => nodeMap().get(choice().sourceId);
            const target = () => nodeMap().get(choice().targetId);
            return (
              <section
                class="pipeline-connection-type-menu"
                role="dialog"
                aria-label="Choose connection type"
                style={{ left: `${choice().left}px`, top: `${choice().top}px` }}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <header>
                  <span>CONNECTION TYPE</span>
                  <strong>{source()?.name} → {target()?.name}</strong>
                </header>
                <button type="button" onClick={() => chooseConnectionType("automatic")}>
                  <span class="pipeline-connection-choice-mark automatic" aria-hidden="true">→</span>
                  <span><strong>Automatic handoff</strong><small>Continue as soon as inputs are ready</small></span>
                </button>
                <button type="button" onClick={() => chooseConnectionType("approval")}>
                  <span class="pipeline-connection-choice-mark approval" aria-hidden="true">!</span>
                  <span><strong>Require approval</strong><small>Pause before the next step starts</small></span>
                </button>
              </section>
            );
          }}
        </Show>

        <div class="pipeline-canvas-toolbar" role="toolbar" aria-label="Canvas zoom controls">
          <button
            type="button"
            onClick={() => zoomAt(zoom() / 1.15)}
            disabled={zoom() <= PIPELINE_MIN_ZOOM}
            aria-label="Zoom out"
            title="Zoom out"
          >
            −
          </button>
          <button
            type="button"
            class="pipeline-zoom-value"
            onClick={() => zoomAt(1)}
            aria-label={`Reset zoom, currently ${Math.round(zoom() * 100)} percent`}
            title="Reset zoom to 100%"
          >
            {Math.round(zoom() * 100)}%
          </button>
          <button
            type="button"
            onClick={() => zoomAt(zoom() * 1.15)}
            disabled={zoom() >= PIPELINE_MAX_ZOOM}
            aria-label="Zoom in"
            title="Zoom in"
          >
            +
          </button>
          <span aria-hidden="true" />
          <button
            type="button"
            onClick={fitView}
            aria-label="Fit pipeline to view"
            title="Fit view (⌘0)"
          >
            Fit
          </button>
        </div>
      </div>

      <p id={instructionsId} class="pipeline-sr-only">
        Use Tab to focus nodes and ports. Arrow keys pan when the canvas is focused and move a step
        when its card is focused. Alt plus an arrow pans from a focused node. Activate an output port,
        then an input port, to connect nodes. Delete removes the selected step or connection. Escape
        cancels a connection.
      </p>
      <div class="pipeline-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement()}
      </div>
    </section>
  );
}

export {
  clampPipelineZoom,
  connectionWouldCycle,
  fitPipelineViewport,
} from "./geometry";
