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
import type {
  EditorCommandRequest,
  EditorFileNavigation,
} from "./pages/EditorPage";
import { WorkspaceOverlays } from "./design";
import type {
  EditorCommand,
  PageKey,
  TitleBarAction,
  WorkspaceOverlay,
} from "./design";
import type { FileLinkTarget } from "./design/MarkdownText";
import { initializeWorkspace, useWorkspace } from "./stores/workspace";
import { initializeSettings, updateSettings } from "./stores/settings";
import { hasDirtyBuffers } from "./stores/buffers";
import { appCloseReasons, prepareForAppClose } from "./stores/appLifecycle";
import { createAppZoomKeydownHandler } from "./lib/appZoom";
import {
  connectAgentListeners,
  initializeAgents,
} from "./features/agents/agentStore";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getCurrentWebview } from "@tauri-apps/api/webview";
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
  const [activeOverlay, setActiveOverlay] = createSignal<WorkspaceOverlay>(null);
  const [paletteMode, setPaletteMode] = createSignal<"files" | "commands">("files");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [fileNavigation, setFileNavigation] = createSignal<EditorFileNavigation | null>(null);
  const [editorCommand, setEditorCommand] = createSignal<EditorCommandRequest | null>(null);
  let fileNavigationId = 0;
  let editorCommandId = 0;
  let refreshEditor: (() => Promise<void>) | null = null;

  const markPageMounted = (next: PageKey) => {
    if (next === "agents") setAgentsMounted(true);
    if (next === "pipelines") setPipelinesMounted(true);
  };

  const activatePage = (next: PageKey, closeOverlay: boolean) => {
    const path = pathForPage(next);
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    if (closeOverlay) setActiveOverlay(null);
    markPageMounted(next);
    setPage(next);
  };

  const navigate = (next: PageKey) => activatePage(next, true);

  const openFile = (target: FileLinkTarget) => {
    setFileNavigation({ ...target, id: ++fileNavigationId });
    // Search, Git, and the buffer overview stay open while revealing the file.
    activatePage("editor", false);
  };

  const openFilePath = (path: string) => {
    setFileNavigation({ path, id: ++fileNavigationId });
    activatePage("editor", false);
  };

  const requestEditorCommand = (command: EditorCommand) => {
    setEditorCommand({ command, id: ++editorCommandId });
    navigate("editor");
  };

  const toggleSidebar = () => {
    setActiveOverlay(null);
    if (page() === "editor") {
      setSidebarOpen((open) => !open);
      return;
    }
    setSidebarOpen(true);
    navigate("editor");
  };

  const openOverlay = (overlay: Exclude<WorkspaceOverlay, null>) => {
    setActiveOverlay(overlay);
  };

  const handleTitleBarAction = (action: TitleBarAction) => {
    if (action === "sidebar") {
      toggleSidebar();
      return;
    }
    if (action === "palette") setPaletteMode("commands");
    setActiveOverlay((active) => active === action ? null : action);
  };

  onMount(() => {
    void initializeWorkspace();
    let disposed = false;
    let removeZoomShortcut: (() => void) | undefined;
    void initializeSettings().then((settings) => {
      if (disposed || !isTauri()) return;

      const webview = getCurrentWebview();
      let zoomApplications = Promise.resolve();
      const applyZoom = (zoom: number) => {
        zoomApplications = zoomApplications
          .catch(() => undefined)
          .then(() => webview.setZoom(zoom));
        void zoomApplications.catch((error) => {
          console.error("Failed to apply app zoom", error);
        });
      };
      const onAppZoomShortcut = createAppZoomKeydownHandler(settings.app_zoom, (zoom) => {
        updateSettings({ app_zoom: zoom });
        applyZoom(zoom);
      });

      applyZoom(settings.app_zoom);
      window.addEventListener("keydown", onAppZoomShortcut);
      removeZoomShortcut = () => window.removeEventListener("keydown", onAppZoomShortcut);
    });
    const onWorkspaceShortcut = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (command && event.shiftKey && key === "p") {
        event.preventDefault();
        setPaletteMode("commands");
        setActiveOverlay("palette");
      } else if (command && key === "p" && !event.shiftKey) {
        event.preventDefault();
        setPaletteMode("files");
        setActiveOverlay("palette");
      } else if (command && event.shiftKey && key === "f") {
        event.preventDefault();
        setActiveOverlay("search");
      } else if (command && event.shiftKey && key === "m") {
        event.preventDefault();
        setActiveOverlay("minimap");
      } else if (command && event.key === ",") {
        event.preventDefault();
        setActiveOverlay("settings");
      } else if (command && key === "b") {
        event.preventDefault();
        toggleSidebar();
      } else if (event.key === "Escape" && activeOverlay()) {
        setActiveOverlay(null);
      }
    };
    window.addEventListener("keydown", onWorkspaceShortcut);
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
      setActiveOverlay(null);
      markPageMounted(next);
      setPage(next);
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      disposed = true;
      disconnectAgents?.();
      removeZoomShortcut?.();
      window.removeEventListener("keydown", onWorkspaceShortcut);
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
        <EditorPage
          activePage={page()}
          onNavigatePage={navigate}
          fileNavigation={fileNavigation()}
          editorCommand={editorCommand()}
          sidebarOpen={sidebarOpen()}
          activeOverlay={activeOverlay()}
          onTitleBarAction={handleTitleBarAction}
          onRegisterRefresh={(refresh) => {
            refreshEditor = refresh;
          }}
        />
      </div>
      <Show when={agentsMounted()}>
        <div
          id="workspace-page-agents"
          role="tabpanel"
          aria-label="Agents workspace"
          style={{ display: page() === "agents" ? "contents" : "none" }}
        >
          <AgentsPage
            activePage={page()}
            onNavigatePage={navigate}
            onOpenFile={openFile}
            activeOverlay={activeOverlay()}
            onTitleBarAction={handleTitleBarAction}
          />
        </div>
      </Show>
      <Show when={pipelinesMounted()}>
        <div
          id="workspace-page-pipelines"
          role="tabpanel"
          aria-label="Pipelines workspace"
          style={{ display: page() === "pipelines" ? "contents" : "none" }}
        >
          <PipelinesPage
            activePage={page()}
            onNavigatePage={navigate}
            onOpenFile={openFile}
            activeOverlay={activeOverlay()}
            onTitleBarAction={handleTitleBarAction}
          />
        </div>
      </Show>
      <WorkspaceOverlays
        active={activeOverlay()}
        activePage={page()}
        paletteMode={paletteMode()}
        projectRoot={workspace.activeRoot()}
        sidebarOpen={sidebarOpen()}
        onClose={() => setActiveOverlay(null)}
        onEditorCommand={requestEditorCommand}
        onOpenFile={openFilePath}
        onOpenFileAt={openFile}
        onOpenOverlay={openOverlay}
        onNavigatePage={navigate}
        onRefreshEditor={() => refreshEditor?.() ?? Promise.resolve()}
        onToggleSidebar={toggleSidebar}
      />
    </>
  );
};

export default App;
