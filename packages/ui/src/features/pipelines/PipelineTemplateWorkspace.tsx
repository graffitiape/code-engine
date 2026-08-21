import { Show, createMemo } from "solid-js";
import { useAgentState } from "../agents/agentStore";
import { PipelineCanvas } from "./canvas/PipelineCanvas";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineRail } from "./PipelineRail";
import { PipelineAddStepMenu } from "./PipelineAddStepMenu";
import type { PipelineAgentPresetId } from "./agentPresets";
import {
  addAgentNode,
  addIntegrationNode,
  connectNodes,
  createPipeline,
  deleteEdge,
  deleteNode,
  deleteSelectedPipeline,
  duplicateSelectedPipeline,
  moveNode,
  renameSelectedPipeline,
  selectPipeline,
  selectedPipeline,
  selectPipelineEdge,
  selectPipelineNode,
  setConnectionSource,
  setPipelineError,
  setViewport,
  updateNode,
  updateEdge,
  usePipelineState,
} from "./pipelineStore";

interface PipelineTemplateWorkspaceProps {
  active: boolean;
}

export function PipelineTemplateWorkspace(props: PipelineTemplateWorkspaceProps) {
  const agents = useAgentState();
  const state = usePipelineState();
  const pipeline = createMemo(selectedPipeline);
  let canvasRegionRef: HTMLDivElement | undefined;
  const runStates = () => {
    const run = state.run;
    if (!run || run.pipelineId !== pipeline()?.id) return {};
    return run.nodes;
  };
  const edgeRunStates = () => {
    const run = state.run;
    if (!run || run.pipelineId !== pipeline()?.id) return {};
    return run.edges;
  };
  const focusNode = (nodeId: string | null) => {
    if (!nodeId) return;
    queueMicrotask(() => {
      const cards = canvasRegionRef?.querySelectorAll<HTMLElement>("[data-node-id]");
      [...(cards ?? [])]
        .find((card) => card.dataset.nodeId === nodeId)
        ?.focus({ preventScroll: true });
    });
  };
  const addAgent = (presetId: PipelineAgentPresetId) => {
    const rect = canvasRegionRef?.getBoundingClientRect();
    focusNode(addAgentNode(
      agents.model,
      agents.effort || "medium",
      rect ? { width: rect.width, height: rect.height } : undefined,
      presetId,
    ));
  };
  const addIntegration = () => {
    const rect = canvasRegionRef?.getBoundingClientRect();
    focusNode(addIntegrationNode(rect ? { width: rect.width, height: rect.height } : undefined));
  };

  return (
    <Show when={pipeline()}>
      {(definition) => (
        <div class="pipelines-template-root">
          <PipelineRail
            pipelines={state.pipelines}
            selectedId={state.selectedId}
            disabled={props.active}
            onSelect={selectPipeline}
            onCreate={createPipeline}
            onDuplicate={duplicateSelectedPipeline}
            onDelete={deleteSelectedPipeline}
          />

          <section class="pipeline-workspace">
            <header class="pipeline-workspace-head">
              <div>
                <span class="pipeline-eyebrow">PIPELINE TEMPLATE</span>
                <strong>{definition().name}</strong>
                <small>{definition().nodes.length} stations · {definition().edges.length} connections</small>
              </div>
              <div class="pipeline-workspace-actions">
                <Show when={state.connectionSource}>
                  <span class="pipeline-connect-hint">Choose a downstream input · Esc to cancel</span>
                </Show>
                <PipelineAddStepMenu
                  disabled={props.active}
                  agentDisabled={!agents.model}
                  onAddAgent={addAgent}
                  onAddGit={addIntegration}
                />
              </div>
            </header>

            <div ref={canvasRegionRef} class="pipeline-canvas-region">
              <PipelineCanvas
                nodes={definition().nodes}
                edges={definition().edges}
                selectedNodeId={state.selectedNodeId}
                selectedEdgeId={state.selectedEdgeId}
                runStates={runStates()}
                edgeRunStates={edgeRunStates()}
                viewport={definition().viewport}
                connectionSource={state.connectionSource}
                readOnly={props.active}
                onSelectNode={selectPipelineNode}
                onSelectEdge={selectPipelineEdge}
                onMoveCommit={moveNode}
                onConnect={connectNodes}
                onDeleteNode={deleteNode}
                onDeleteEdge={deleteEdge}
                onViewportChange={setViewport}
                onConnectionSourceChange={setConnectionSource}
                onErrorAnnouncement={setPipelineError}
                ariaLabel={`${definition().name} pipeline canvas`}
              />
            </div>
          </section>

          <PipelineInspector
            pipeline={definition()}
            selectedNodeId={state.selectedNodeId}
            selectedEdgeId={state.selectedEdgeId}
            models={agents.models}
            disabled={props.active}
            onRenamePipeline={renameSelectedPipeline}
            onUpdateNode={updateNode}
            onUpdateEdge={updateEdge}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      )}
    </Show>
  );
}
