import { Show, createEffect, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { Icon } from "../../../design";
import type {
  PipelineNode,
  PipelineNodeRunState,
  PipelinePoint,
} from "../types";
import { clampPipelineZoom, pipelineNodeSize } from "./geometry";
import { pipelineRunLabel, pipelineRunTone } from "./runState";

export type PipelineCanvasNodeRunState = Pick<
  PipelineNodeRunState,
  "status" | "output" | "error"
>;

export interface PipelineNodeCardProps {
  node: PipelineNode;
  position: PipelinePoint;
  selected: boolean;
  runState?: PipelineCanvasNodeRunState;
  zoom: number;
  connectionSource: string | null;
  readOnly?: boolean;
  incomingCount: number;
  outgoingCount: number;
  onSelect: (nodeId: string) => void;
  onMovePreview: (nodeId: string, position: PipelinePoint | null) => void;
  onMoveCommit: (nodeId: string, position: PipelinePoint) => void;
  onRequestConnection: (nodeId: string) => void;
  onAcceptConnection: (nodeId: string) => void;
}

interface NodeDrag {
  pointerId: number;
  captureTarget: HTMLElement;
  clientX: number;
  clientY: number;
  start: PipelinePoint;
  latest: PipelinePoint;
  moved: boolean;
}

const NODE_COLORS = new Set(["cyan", "purple", "green", "blue", "orange"]);

function nodeColor(node: PipelineNode): string {
  if (node.type !== "agent") return node.type === "input" ? "cyan" : "green";
  return NODE_COLORS.has(node.color) ? node.color : "purple";
}

function nodeIcon(node: PipelineNode): string {
  if (node.type === "input") return "play";
  if (node.type === "output") return "download";
  return "command";
}

function nodeKindLabel(node: PipelineNode): string {
  if (node.type === "input") return "Task input";
  if (node.type === "output") return "Pipeline result";
  return "Codex agent";
}

function permissionLabel(permission: string): string {
  if (permission === "read-only") return "Read only";
  if (permission === "full-access") return "Full access";
  return "Workspace";
}

function roundPosition(value: number): number {
  return Math.round(value * 10) / 10;
}

export function PipelineNodeCard(props: PipelineNodeCardProps) {
  const [isDragging, setIsDragging] = createSignal(false);
  let cardRef: HTMLElement | undefined;
  let drag: NodeDrag | null = null;

  const locked = () => props.node.type !== "agent" || Boolean(props.readOnly);
  const size = () => pipelineNodeSize(props.node);
  const tone = () => pipelineRunTone(props.runState?.status);
  const statusLabel = () => pipelineRunLabel(props.runState?.status);
  const canReceive = () => props.node.type !== "input";
  const canSend = () => props.node.type !== "output";
  const connectionReady = () =>
    !props.readOnly && canReceive() && Boolean(props.connectionSource) && props.connectionSource !== props.node.id;
  const runMessage = () => {
    const message = props.runState?.error ?? props.runState?.output;
    if (!message) return null;
    const flattened = message.replace(/\s+/g, " ").trim();
    return flattened.length > 180 ? `${flattened.slice(0, 177)}…` : flattened;
  };

  const cardStyle = (): JSX.CSSProperties => ({
    left: `${props.position.x}px`,
    top: `${props.position.y}px`,
    width: `${size().width}px`,
    height: `${size().height}px`,
    "--pipeline-port-scale": `${1 / clampPipelineZoom(props.zoom)}`,
  });

  const ariaLabel = () => {
    const selection = props.selected ? "Selected. " : "";
    const lock = locked() ? "Position locked. " : "Use arrow keys to move. ";
    return `${selection}${nodeKindLabel(props.node)} ${props.node.name}. ${statusLabel()}. ${props.incomingCount} incoming and ${props.outgoingCount} outgoing connections. ${lock}`;
  };

  const clearDrag = () => {
    const active = drag;
    if (!active) return;
    drag = null;
    setIsDragging(false);
    props.onMovePreview(props.node.id, null);
    if (active.captureTarget.hasPointerCapture(active.pointerId)) {
      active.captureTarget.releasePointerCapture(active.pointerId);
    }
  };

  const startDrag = (event: PointerEvent) => {
    props.onSelect(props.node.id);
    cardRef?.focus({ preventScroll: true });
    if (locked() || event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    const captureTarget = event.currentTarget as HTMLElement;
    captureTarget.setPointerCapture(event.pointerId);
    drag = {
      pointerId: event.pointerId,
      captureTarget,
      clientX: event.clientX,
      clientY: event.clientY,
      start: { ...props.position },
      latest: { ...props.position },
      moved: false,
    };
    setIsDragging(true);
  };

  const moveDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const zoom = clampPipelineZoom(props.zoom);
    const next = {
      x: roundPosition(drag.start.x + (event.clientX - drag.clientX) / zoom),
      y: roundPosition(drag.start.y + (event.clientY - drag.clientY) / zoom),
    };
    drag.latest = next;
    drag.moved = drag.moved || next.x !== drag.start.x || next.y !== drag.start.y;
    props.onMovePreview(props.node.id, next);
  };

  const finishDrag = (event: PointerEvent) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const completed = drag;
    drag = null;
    setIsDragging(false);
    if (completed.moved) props.onMoveCommit(props.node.id, completed.latest);
    props.onMovePreview(props.node.id, null);
    if (completed.captureTarget.hasPointerCapture(completed.pointerId)) {
      completed.captureTarget.releasePointerCapture(completed.pointerId);
    }
  };

  const cancelDrag = (event?: PointerEvent) => {
    if (event && drag?.pointerId !== event.pointerId) return;
    clearDrag();
  };

  createEffect(() => {
    if (props.readOnly && drag) clearDrag();
  });

  return (
    <article
      ref={cardRef}
      class={`pipeline-node-card pipeline-node-${props.node.type} pipeline-node-color-${nodeColor(props.node)} tone-${tone()} ${props.selected ? "selected" : ""} ${isDragging() ? "dragging" : ""} ${props.readOnly ? "read-only" : ""}`}
      data-node-id={props.node.id}
      data-node-type={props.node.type}
      tabindex="0"
      aria-label={ariaLabel()}
      aria-roledescription={locked() ? "locked pipeline node" : "draggable pipeline node"}
      style={cardStyle()}
      onPointerDown={(event) => {
        if (!(event.target as Element).closest("button")) {
          props.onSelect(props.node.id);
          cardRef?.focus({ preventScroll: true });
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag) {
          event.preventDefault();
          clearDrag();
        }
      }}
    >
      <span class="pipeline-node-bolt bolt-tl" aria-hidden="true" />
      <span class="pipeline-node-bolt bolt-tr" aria-hidden="true" />
      <span class="pipeline-node-bolt bolt-bl" aria-hidden="true" />
      <span class="pipeline-node-bolt bolt-br" aria-hidden="true" />

      <Show when={canReceive()}>
        <button
          type="button"
          class={`pipeline-node-port port-input ${connectionReady() ? "connection-ready" : ""}`}
          aria-label={`Connect into ${props.node.name}`}
          title={`Connect into ${props.node.name}`}
          disabled={props.readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(props.node.id);
            props.onAcceptConnection(props.node.id);
          }}
        >
          <span aria-hidden="true" />
        </button>
      </Show>

      <Show when={canSend()}>
        <button
          type="button"
          class={`pipeline-node-port port-output ${props.connectionSource === props.node.id ? "connection-source" : ""}`}
          aria-label={`Connect from ${props.node.name}`}
          aria-pressed={props.connectionSource === props.node.id}
          title={`Connect from ${props.node.name}`}
          disabled={props.readOnly}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            props.onSelect(props.node.id);
            props.onRequestConnection(props.node.id);
          }}
        >
          <span aria-hidden="true" />
        </button>
      </Show>

      <header
        class="pipeline-node-head"
        title={locked() ? `${nodeKindLabel(props.node)} position is locked` : "Drag to move agent"}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={finishDrag}
        onPointerCancel={cancelDrag}
        onLostPointerCapture={() => {
          if (drag) clearDrag();
        }}
      >
        <span class="pipeline-node-icon" aria-hidden="true">
          <Icon name={nodeIcon(props.node)} />
        </span>
        <span class="pipeline-node-heading">
          <strong>{props.node.name}</strong>
          <small>{nodeKindLabel(props.node)}</small>
        </span>
        <span class={`pipeline-node-state tone-${tone()}`}>
          <span aria-hidden="true" />
          {statusLabel()}
        </span>
      </header>

      <Show
        when={props.node.type === "agent" ? props.node : null}
        fallback={
          <div class="pipeline-terminal-copy">
            {props.node.type === "input"
              ? "Receives the task supplied when this pipeline starts."
              : "Collects the final output from upstream agents."}
          </div>
        }
      >
        {(agent) => (
          <>
            <div class="pipeline-node-meta">
              <span title={agent().model}>{agent().model}</span>
              <span>{agent().effort}</span>
              <span>{permissionLabel(agent().permission)}</span>
            </div>
            <p class="pipeline-node-instructions">
              {agent().instructions.trim() || "No instructions configured."}
            </p>
          </>
        )}
      </Show>

      <Show when={runMessage()}>
        {(message) => (
          <div class={`pipeline-node-message ${props.runState?.error ? "error" : "output"}`}>
            {message()}
          </div>
        )}
      </Show>

      <footer class="pipeline-node-foot">
        <span>{props.incomingCount} in</span>
        <Show when={props.node.type === "agent"}>
          <span>{props.node.type === "agent" ? `${props.node.retryCount} retries` : ""}</span>
        </Show>
        <span>{props.outgoingCount} out</span>
      </footer>
    </article>
  );
}
