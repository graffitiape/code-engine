import { Component, Show, createEffect, createMemo } from "solid-js";
import { Icon, PageSwitcher, ProjectSwitcher } from "../design";
import type { PageKey } from "../design";
import { PipelineCanvas } from "../features/pipelines/canvas/PipelineCanvas";
import { PipelineInspector } from "../features/pipelines/PipelineInspector";
import { PipelineRail } from "../features/pipelines/PipelineRail";
import { PipelineRunDock } from "../features/pipelines/PipelineRunDock";
import {
  respondToPipelineRequest,
  startPipelineRun,
  stopPipelineRun,
} from "../features/pipelines/pipelineExecution";
import {
  addAgentNode,
  clearPipelineError,
  connectNodes,
  createPipeline,
  deleteEdge,
  deleteNode,
  deleteSelectedPipeline,
  duplicateSelectedPipeline,
  initializePipelines,
  moveNode,
  pipelineRunIsActive,
  renameSelectedPipeline,
  selectPipeline,
  selectedPipeline,
  selectPipelineEdge,
  selectPipelineNode,
  setConnectionSource,
  setPipelineError,
  setPipelineTask,
  setViewport,
  syncPipelineModels,
  updateNode,
  usePipelineState,
} from "../features/pipelines/pipelineStore";
import { useAgentState } from "../features/agents/agentStore";
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from "../lib/titlebar";
import { useWorkspace } from "../stores/workspace";
import "../styles/agents.css";

interface PipelinesPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
}

const PipelinesPage: Component<PipelinesPageProps> = (props) => {
  const workspace = useWorkspace();
  const agents = useAgentState();
  const state = usePipelineState();
  const pipeline = createMemo(selectedPipeline);
  let canvasRegionRef: HTMLDivElement | undefined;
  const active = () => pipelineRunIsActive();
  const codexReady = () => Boolean(
    workspace.activeRoot() &&
    agents.cwd === workspace.activeRoot() &&
    agents.server?.ready &&
    agents.account?.account,
  );
  const runStates = () => {
    const run = state.run;
    if (!run || run.pipelineId !== pipeline()?.id) return {};
    return run.nodes;
  };

  const addAgent = () => {
    const rect = canvasRegionRef?.getBoundingClientRect();
    const nodeId = addAgentNode(
      agents.model,
      agents.effort || "medium",
      rect ? { width: rect.width, height: rect.height } : undefined,
    );
    if (!nodeId) return;
    queueMicrotask(() => {
      const cards = canvasRegionRef?.querySelectorAll<HTMLElement>("[data-node-id]");
      [...(cards ?? [])]
        .find((card) => card.dataset.nodeId === nodeId)
        ?.focus({ preventScroll: true });
    });
  };

  createEffect(() => {
    initializePipelines(workspace.activeRoot(), agents.model, agents.effort || "medium");
  });

  createEffect(() => {
    syncPipelineModels(agents.models);
  });

  return (
    <div class="desktop pipelines-desktop">
      <div class="window">
        <div
          class="titlebar"
          data-screen-label="PipelinesTitleBar"
          onMouseDown={handleTitlebarMouseDown}
          onMouseUp={handleTitlebarMouseUp}
        >
          <div class="traffic-lights">
            <span class="tl close" />
            <span class="tl min" />
            <span class="tl max" />
          </div>
          <ProjectSwitcher />
          <PageSwitcher active={props.activePage} onNavigate={props.onNavigatePage} />
          <div class="tabs" />
          <div class={`pipeline-title-status ${codexReady() ? "connected" : ""}`}>
            <span aria-hidden="true" /> {codexReady() ? "Codex ready" : "Codex setup required"}
          </div>
        </div>

        <Show
          when={workspace.activeRoot()}
          fallback={
            <main class="pipeline-empty-project">
              <div class="pipeline-empty-mark"><Icon name="branch" size={28} /></div>
              <span class="pipeline-eyebrow">MULTI-AGENT FACTORY</span>
              <h1>Open a project to design its pipelines</h1>
              <p>Pipeline designs are stored per project and every Codex stage is bound to that project root.</p>
              <button type="button" class="pipeline-run-button" onClick={() => props.onNavigatePage("editor")}>
                Open a project in Editor
              </button>
            </main>
          }
        >
          <Show when={pipeline()}>
            {(definition) => (
              <main class="pipelines-root">
                <PipelineRail
                  pipelines={state.pipelines}
                  selectedId={state.selectedId}
                  disabled={active()}
                  onSelect={selectPipeline}
                  onCreate={() => createPipeline(agents.model, agents.effort || "medium")}
                  onDuplicate={duplicateSelectedPipeline}
                  onDelete={() => deleteSelectedPipeline(agents.model, agents.effort || "medium")}
                />

                <section class="pipeline-workspace">
                  <header class="pipeline-workspace-head">
                    <div>
                      <span class="pipeline-eyebrow">ACTIVE PIPELINE</span>
                      <strong>{definition().name}</strong>
                      <small>{definition().nodes.length} stations · {definition().edges.length} connections</small>
                    </div>
                    <div class="pipeline-workspace-actions">
                      <Show when={state.connectionSource}>
                        <span class="pipeline-connect-hint">Choose a downstream input · Esc to cancel</span>
                      </Show>
                      <button
                        type="button"
                        class="pipeline-add-agent"
                        disabled={active() || !agents.model}
                        onClick={addAgent}
                      >
                        <Icon name="plus" /> Add agent
                      </button>
                    </div>
                  </header>

                  <div ref={canvasRegionRef} class="pipeline-canvas-region">
                    <PipelineCanvas
                      nodes={definition().nodes}
                      edges={definition().edges}
                      selectedNodeId={state.selectedNodeId}
                      selectedEdgeId={state.selectedEdgeId}
                      runStates={runStates()}
                      viewport={definition().viewport}
                      connectionSource={state.connectionSource}
                      readOnly={active()}
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

                  <PipelineRunDock
                    pipeline={definition()}
                    task={state.task}
                    run={state.run}
                    requests={state.pendingRequests}
                    codexReady={codexReady()}
                    active={active()}
                    error={state.error}
                    onTask={setPipelineTask}
                    onRun={() => void startPipelineRun(workspace.activeRoot()!)}
                    onStop={() => void stopPipelineRun()}
                    onRespond={respondToPipelineRequest}
                    onOpenAgents={() => props.onNavigatePage("agents")}
                    onClearError={clearPipelineError}
                  />
                </section>

                <PipelineInspector
                  pipeline={definition()}
                  selectedNodeId={state.selectedNodeId}
                  selectedEdgeId={state.selectedEdgeId}
                  models={agents.models}
                  disabled={active()}
                  onRenamePipeline={renameSelectedPipeline}
                  onUpdateNode={updateNode}
                  onDeleteNode={deleteNode}
                  onDeleteEdge={deleteEdge}
                />
              </main>
            )}
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default PipelinesPage;
