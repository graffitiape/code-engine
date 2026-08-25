import { Component, Show, createEffect, createMemo, createSignal } from "solid-js";
import { Icon, PageSwitcher, ProjectSwitcher } from "../design";
import type { PageKey } from "../design";
import type { FileLinkTarget } from "../design/MarkdownText";
import { PipelineTaskBoard } from "../features/pipelines/PipelineTaskBoard";
import { PipelineTemplateWorkspace } from "../features/pipelines/PipelineTemplateWorkspace";
import {
  respondToPipelineApproval,
  respondToPipelineConnectionApproval,
  respondToPipelineRequest,
  retryPipelineRunStep,
  startPipelineRun,
  stopPipelineRun,
} from "../features/pipelines/pipelineExecution";
import {
  addPipelineTask,
  clearPipelineError,
  deletePipelineTask,
  initializePipelines,
  pipelineRunIsActive,
  selectPipeline,
  selectPipelineTask,
  selectPipelineRun,
  selectedPipeline,
  syncPipelineModels,
  updatePipelineTask,
  usePipelineState,
} from "../features/pipelines/pipelineStore";
import { openAgentThread, useAgentState } from "../features/agents/agentStore";
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from "../lib/titlebar";
import { useWorkspace } from "../stores/workspace";
import "../styles/agents.css";

interface PipelinesPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
  onOpenFile: (target: FileLinkTarget) => void;
}

const PipelinesPage: Component<PipelinesPageProps> = (props) => {
  const workspace = useWorkspace();
  const agents = useAgentState();
  const state = usePipelineState();
  const pipeline = createMemo(selectedPipeline);
  const [view, setView] = createSignal<"tasks" | "templates">("tasks");
  const active = () => pipelineRunIsActive();
  const codexReady = () => Boolean(
    workspace.activeRoot() &&
    agents.cwd === workspace.activeRoot() &&
    agents.server?.ready &&
    agents.account?.account,
  );
  createEffect(() => {
    initializePipelines(workspace.activeRoot());
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
            <main class="pipelines-page-root">
                <header class="pipeline-section-bar">
                  <nav aria-label="Pipeline workspace view">
                    <button
                      type="button"
                      class={view() === "tasks" ? "active" : ""}
                      aria-current={view() === "tasks" ? "page" : undefined}
                      onClick={() => setView("tasks")}
                    >
                      Task runs <span>{state.tasks.length}</span>
                    </button>
                    <button
                      type="button"
                      class={view() === "templates" ? "active" : ""}
                      aria-current={view() === "templates" ? "page" : undefined}
                      onClick={() => setView("templates")}
                    >
                      Templates <span>{state.pipelines.length}</span>
                    </button>
                  </nav>
                  <p>{view() === "tasks" ? "Choose a pipeline for each task, then run it whenever you need." : "Build reusable flows from Codex agents and deterministic integrations."}</p>
                </header>

                <Show
                  when={view() === "templates"}
                  fallback={
                    <PipelineTaskBoard
                      tasks={state.tasks}
                      pipelines={state.pipelines}
                      selectedTaskId={state.selectedTaskId}
                      selectedPipelineId={state.selectedId}
                      projectPath={workspace.activeRoot()!}
                      run={state.run}
                      runs={state.runs}
                      selectedRunId={state.selectedRunId}
                      requests={state.pendingRequests}
                      codexReady={codexReady()}
                      active={active()}
                      error={state.error}
                      onSelect={selectPipelineTask}
                      onSelectRun={selectPipelineRun}
                      onCreate={addPipelineTask}
                      onEdit={(taskId, title, description, pipelineId, attachments) => updatePipelineTask(taskId, {
                        title,
                        description,
                        pipelineId,
                        attachments,
                      })}
                      onPipeline={(taskId, pipelineId) => updatePipelineTask(taskId, { pipelineId })}
                      onDelete={deletePipelineTask}
                      onRun={(taskId) => void startPipelineRun(workspace.activeRoot()!, taskId)}
                      onRetryStep={(runId, nodeId) => {
                        void retryPipelineRunStep(workspace.activeRoot()!, runId, nodeId);
                      }}
                      onOpenAgentThread={async (threadId, cwd) => {
                        await openAgentThread(threadId, cwd);
                        props.onNavigatePage("agents");
                      }}
                      onStop={() => void stopPipelineRun()}
                      onRespond={respondToPipelineRequest}
                      onApproval={(kind, id, decision) => {
                        if (kind === "edge") respondToPipelineConnectionApproval(id, decision);
                        else respondToPipelineApproval(id, decision);
                      }}
                      onOpenAgents={() => props.onNavigatePage("agents")}
                      onOpenTemplate={(pipelineId) => {
                        selectPipeline(pipelineId);
                        setView("templates");
                      }}
                      onClearError={clearPipelineError}
                      onOpenFile={props.onOpenFile}
                    />
                  }
                >
                  <PipelineTemplateWorkspace active={active()} />
                </Show>
            </main>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export default PipelinesPage;
