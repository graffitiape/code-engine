import { Show, createMemo, onCleanup, onMount } from "solid-js";
import { Icon } from "../../design";
import { useAgentState } from "../agents/agentStore";
import { PipelineCanvas } from "./canvas/PipelineCanvas";
import { PipelineInspector } from "./PipelineInspector";
import { PipelineRail } from "./PipelineRail";
import { PipelineAddStepMenu } from "./PipelineAddStepMenu";
import type { PipelineAgentPresetId } from "./agentPresets";
import { PIPELINE_AGENT_LIBRARY_STORAGE_KEY } from "./pipelineAgentLibrary";
import {
  addAgentNode,
  addIntegrationNode,
  addSavedAgentNode,
  connectNodes,
  createPipeline,
  deleteEdge,
  deleteNode,
  deleteSavedAgent,
  deleteSelectedPipeline,
  duplicateSelectedPipeline,
  moveNode,
  refreshSavedAgentLibrary,
  renameSelectedPipeline,
  saveAgentNodeForReuse,
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
  onMount(() => {
    refreshSavedAgentLibrary();
    const refreshLibrary = (event: StorageEvent) => {
      if (event.key === null || event.key === PIPELINE_AGENT_LIBRARY_STORAGE_KEY) {
        refreshSavedAgentLibrary();
      }
    };
    window.addEventListener("storage", refreshLibrary);
    onCleanup(() => window.removeEventListener("storage", refreshLibrary));
  });
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
  const addSavedAgent = (savedAgentId: string) => {
    const rect = canvasRegionRef?.getBoundingClientRect();
    focusNode(addSavedAgentNode(
      savedAgentId,
      agents.models,
      agents.model,
      rect ? { width: rect.width, height: rect.height } : undefined,
    ));
  };

  return (
    <Show when={pipeline()}>
      {(definition) => (
        <div class="pipelines-template-root">
          <div class="pipeline-sr-only" role="status" aria-live="polite" aria-atomic="true">
            {state.announcement}
          </div>
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
                  savedAgents={state.savedAgents}
                  onAddAgent={addAgent}
                  onAddSavedAgent={addSavedAgent}
                  onDeleteSavedAgent={deleteSavedAgent}
                  onAddGit={addIntegration}
                />
              </div>
            </header>

            <div ref={canvasRegionRef} class="pipeline-canvas-region">
              <Show when={state.error}>
                <div class="pipeline-template-error" role="alert">
                  <span>{state.error}</span>
                  <button
                    type="button"
                    aria-label="Dismiss pipeline error"
                    onClick={() => setPipelineError(null)}
                  >
                    <Icon name="close" />
                  </button>
                </div>
              </Show>
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
            savedAgents={state.savedAgents}
            disabled={props.active}
            onRenamePipeline={renameSelectedPipeline}
            onUpdateNode={updateNode}
            onUpdateEdge={updateEdge}
            onSaveAgent={saveAgentNodeForReuse}
            onDeleteNode={deleteNode}
            onDeleteEdge={deleteEdge}
          />
        </div>
      )}
    </Show>
  );
}
