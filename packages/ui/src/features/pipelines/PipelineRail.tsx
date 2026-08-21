import { For } from "solid-js";
import { Icon } from "../../design";
import type { PipelineDefinition } from "./types";

interface PipelineRailProps {
  pipelines: readonly PipelineDefinition[];
  selectedId: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

export function PipelineRail(props: PipelineRailProps) {
  return (
    <aside class="pipeline-rail" aria-label="Pipeline templates">
      <header class="pipeline-rail-head">
        <div>
          <span class="pipeline-eyebrow">REUSABLE</span>
          <strong>Templates</strong>
        </div>
        <button
          type="button"
          class="pipeline-icon-button"
          onClick={props.onCreate}
          disabled={props.disabled}
          title="New pipeline"
          aria-label="Create pipeline"
        >
          <Icon name="plus" />
        </button>
      </header>

      <div class="pipeline-rail-list">
        <For each={props.pipelines}>
          {(pipeline, index) => {
            const stepCount = () => pipeline.nodes.filter(
              (node) => node.type === "agent" || node.type === "integration" || node.type === "approval",
            ).length;
            return (
              <button
                type="button"
                class={`pipeline-rail-item ${props.selectedId === pipeline.id ? "active" : ""}`}
                aria-current={props.selectedId === pipeline.id ? "page" : undefined}
                disabled={props.disabled && props.selectedId !== pipeline.id}
                onClick={() => props.onSelect(pipeline.id)}
              >
                <span class="pipeline-rail-number">{String(index() + 1).padStart(2, "0")}</span>
                <span class="pipeline-rail-copy">
                  <strong>{pipeline.name}</strong>
                  <small>{stepCount()} {stepCount() === 1 ? "step" : "steps"} · {pipeline.edges.length} wires</small>
                </span>
                <span class="pipeline-rail-led" aria-hidden="true" />
              </button>
            );
          }}
        </For>
      </div>

      <footer class="pipeline-rail-actions">
        <button type="button" disabled={props.disabled} onClick={props.onDuplicate}>
          Duplicate
        </button>
        <button type="button" class="danger" disabled={props.disabled} onClick={props.onDelete}>
          Delete
        </button>
      </footer>
    </aside>
  );
}
