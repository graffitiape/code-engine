import {
  Component,
  createEffect,
  createSignal,
  lazy,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import EditorPage from "./pages/EditorPage";
import type { PageKey } from "./design";
import { initializeWorkspace, useWorkspace } from "./stores/workspace";
import { initializeSettings } from "./stores/settings";
import { hasDirtyBuffers } from "./stores/buffers";
import { appCloseReasons, prepareForAppClose } from "./stores/appLifecycle";
import {
  connectAgentListeners,
  initializeAgents,
} from "./features/agents/agentStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

const AgentsPage = lazy(() => import("./pages/AgentsPage"));
const PipelinesPage = lazy(() => import("./pages/PipelinesPage"));

function pageFromPath(path: string): PageKey {
  if (path.startsWith("/pipelines")) return "pipelines";
  if (path.startsWith("/agents")) return "agents";
  return "editor";
}

function pathForPage(page: PageKey): string {
  if (page === "agents") return "/agents";
  if (page === "pipelines") return "/pipelines";
  return "/";
}

const App: Component = () => {
  const workspace = useWorkspace();
  const [page, setPage] = createSignal<PageKey>(pageFromPath(window.location.pathname));
  const [agentsMounted, setAgentsMounted] = createSignal(page() === "agents");
  const [pipelinesMounted, setPipelinesMounted] = createSignal(page() === "pipelines");

  const markPageMounted = (next: PageKey) => {
    if (next === "agents") setAgentsMounted(true);
    if (next === "pipelines") setPipelinesMounted(true);
  };

  const navigate = (next: PageKey) => {
    const path = pathForPage(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    markPageMounted(next);
    setPage(next);
  };

  onMount(() => {
    void initializeWorkspace();
    void initializeSettings();
    let disposed = false;
    let disconnectAgents: (() => void) | undefined;
    void connectAgentListeners()
      .then((disconnect) => {
        if (disposed) disconnect();
        else disconnectAgents = disconnect;
      })
      .catch((error) => {
        console.error("Failed to connect agent event listeners", error);
      });
    let allowClose = false;
    let preparingClose = false;
    let removeCloseListener: (() => void) | undefined;
    if (isTauri()) {
      const appWindow = getCurrentWindow();
      void appWindow
        .onCloseRequested(async (event) => {
          if (allowClose) return;
          const dirtyBuffers = hasDirtyBuffers();
          const reasons = appCloseReasons();
          if (!dirtyBuffers && reasons.length === 0) return;
          event.preventDefault();
          if (preparingClose) return;

          const consequences = [
            ...(dirtyBuffers ? ["Unsaved editor changes will be discarded."] : []),
            ...reasons,
          ];
          const preparationNote = reasons.length
            ? "\n\nCode Engine will stop active work before closing."
            : "";
          const confirmed = window.confirm(
            `Close Code Engine?\n\n${consequences.map((reason) => `• ${reason}`).join("\n")}${preparationNote}`,
          );
          if (!confirmed) return;

          preparingClose = true;
          try {
            await prepareForAppClose();
            allowClose = true;
            await appWindow.close();
          } catch (error) {
            allowClose = false;
            const message = error instanceof Error ? error.message : String(error);
            window.alert(`Code Engine could not safely stop active work: ${message}`);
          } finally {
            preparingClose = false;
          }
        })
        .then((unlisten) => {
          removeCloseListener = unlisten;
        })
        .catch(() => {
          // Closing must remain available even if a platform listener fails.
        });
    }
    const onPop = () => {
      const next = pageFromPath(window.location.pathname);
      markPageMounted(next);
      setPage(next);
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      disposed = true;
      disconnectAgents?.();
      window.removeEventListener("popstate", onPop);
      removeCloseListener?.();
    });
  });

  createEffect(() => {
    void initializeAgents(workspace.activeRoot());
  });

  return (
    <>
      <div
        id="workspace-page-editor"
        role="tabpanel"
        aria-label="Editor workspace"
        style={{ display: page() === "editor" ? "contents" : "none" }}
      >
        <EditorPage activePage={page()} onNavigatePage={navigate} />
      </div>
      <Show when={agentsMounted()}>
        <div
          id="workspace-page-agents"
          role="tabpanel"
          aria-label="Agents workspace"
          style={{ display: page() === "agents" ? "contents" : "none" }}
        >
          <AgentsPage activePage={page()} onNavigatePage={navigate} />
        </div>
      </Show>
      <Show when={pipelinesMounted()}>
        <div
          id="workspace-page-pipelines"
          role="tabpanel"
          aria-label="Pipelines workspace"
          style={{ display: page() === "pipelines" ? "contents" : "none" }}
        >
          <PipelinesPage activePage={page()} onNavigatePage={navigate} />
        </div>
      </Show>
    </>
  );
};

export default App;
