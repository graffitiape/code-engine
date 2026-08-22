import { Component, Show } from "solid-js";
import { PageSwitcher, ProjectSwitcher } from "../design";
import type { PageKey } from "../design";
import type { FileLinkTarget } from "../design/MarkdownText";
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from "../lib/titlebar";
import { useWorkspace } from "../stores/workspace";
import { AgentComposer } from "../features/agents/AgentComposer";
import { AgentOnboarding } from "../features/agents/AgentOnboarding";
import { AgentRail } from "../features/agents/AgentRail";
import { AgentRuntimeBar } from "../features/agents/AgentRuntimeBar";
import { AgentThreadView } from "../features/agents/AgentThreadView";
import {
  archiveAgentThread,
  clearAgentError,
  createAgentTask,
  interruptAgentTurn,
  logoutAgentAccount,
  refreshAgents,
  renameAgentThread,
  respondToServerRequest,
  restartCodex,
  selectAgentThread,
  sendAgentMessage,
  setAgentComposerOpen,
  setAgentEffort,
  setAgentModel,
  setAgentPermission,
  useAgentState,
} from "../features/agents/agentStore";
import "../styles/agents.css";

interface AgentsPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
  onOpenFile: (target: FileLinkTarget) => void;
}

const AgentsPage: Component<AgentsPageProps> = (props) => {
  const workspace = useWorkspace();
  const state = useAgentState();

  const ready = () => {
    const root = workspace.activeRoot();
    return Boolean(
      root &&
      !state.booting &&
      state.cwd === root &&
      state.server?.ready &&
      state.account?.account
    );
  };
  const selectedItems = () =>
    state.selectedThreadId ? state.feedByThread[state.selectedThreadId] ?? [] : [];
  const selectedActive = () =>
    Boolean(state.selectedThreadId && state.activeTurnByThread[state.selectedThreadId]);

  return (
    <div class="desktop agents-desktop">
      <div class="window">
        <div
          class="titlebar"
          data-screen-label="AgentsTitleBar"
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
          <Show when={state.server?.state === "ready"}>
            <div class="agent-titlebar-status"><span /> Codex connected</div>
          </Show>
        </div>

        <Show
          when={ready()}
          fallback={
            <AgentOnboarding
              state={state}
              hasProject={Boolean(workspace.activeRoot())}
              onOpenEditor={() => props.onNavigatePage("editor")}
            />
          }
        >
          <div class="agents-root">
            <AgentRail
              threads={state.threads}
              currentId={state.selectedThreadId}
              loading={state.booting}
              onNew={() => setAgentComposerOpen(true)}
              onRefresh={() => void refreshAgents()}
              onSelect={(threadId) => {
                const cwd = workspace.activeRoot();
                if (cwd) void selectAgentThread(threadId, cwd);
              }}
            />
            <section class="agent-workspace">
              <AgentRuntimeBar
                server={state.server!}
                account={state.account!}
                limits={state.rateLimits}
                projectPath={workspace.activeRoot()!}
                onRestart={() => void restartCodex()}
                onLogout={() => void logoutAgentAccount()}
              />
              <Show
                when={!state.composerOpen && state.selectedThread}
                fallback={
                  <AgentComposer
                    models={state.models}
                    model={state.model}
                    effort={state.effort}
                    permission={state.permission}
                    projectPath={workspace.activeRoot()!}
                    submitting={state.submitting}
                    onModel={setAgentModel}
                    onEffort={setAgentEffort}
                    onPermission={setAgentPermission}
                    onSubmit={(prompt) => void createAgentTask(prompt, workspace.activeRoot()!)}
                    onCancel={state.selectedThread ? () => setAgentComposerOpen(false) : undefined}
                  />
                }
              >
                {(thread) => (
                  <AgentThreadView
                    thread={thread()}
                    items={selectedItems()}
                    requests={state.pendingRequests}
                    models={state.models}
                    model={state.model}
                    effort={state.effort}
                    permission={state.permission}
                    active={selectedActive()}
                    loading={state.loadingThread}
                    submitting={state.submitting}
                    error={state.error}
                    onModel={setAgentModel}
                    onEffort={setAgentEffort}
                    onPermission={setAgentPermission}
                    onSend={(text) => void sendAgentMessage(text, workspace.activeRoot()!)}
                    onInterrupt={() => void interruptAgentTurn()}
                    onArchive={() => void archiveAgentThread(thread().id)}
                    onRename={(name) => renameAgentThread(thread().id, name)}
                    onRespond={respondToServerRequest}
                    onClearError={clearAgentError}
                    onOpenFile={props.onOpenFile}
                  />
                )}
              </Show>
            </section>
          </div>
        </Show>
      </div>
    </div>
  );
};

export default AgentsPage;
