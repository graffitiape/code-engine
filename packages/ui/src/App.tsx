import { Component, createSignal, lazy, onCleanup, onMount, Show } from "solid-js";
import EditorPage from "./pages/EditorPage";
import type { PageKey } from "./design";
import { initializeWorkspace } from "./stores/workspace";
import { initializeSettings } from "./stores/settings";
import { hasDirtyBuffers } from "./stores/buffers";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "@tauri-apps/api/core";

const AgentsPage = lazy(() => import("./pages/AgentsPage"));

function pageFromPath(path: string): PageKey {
  if (path.startsWith("/agents")) return "agents";
  return "editor";
}

const App: Component = () => {
  const [page, setPage] = createSignal<PageKey>(pageFromPath(window.location.pathname));
  const [agentsMounted, setAgentsMounted] = createSignal(page() === "agents");

  const navigate = (next: PageKey) => {
    const path = next === "agents" ? "/agents" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    if (next === "agents") setAgentsMounted(true);
    setPage(next);
  };

  onMount(() => {
    void initializeWorkspace();
    void initializeSettings();
    let allowClose = false;
    let removeCloseListener: (() => void) | undefined;
    if (isTauri()) {
      void getCurrentWindow()
        .onCloseRequested(async (event) => {
          if (allowClose || !hasDirtyBuffers()) return;
          event.preventDefault();
          if (!window.confirm("Close Code Engine and discard all unsaved changes?")) return;
          allowClose = true;
          await getCurrentWindow().close();
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
      if (next === "agents") setAgentsMounted(true);
      setPage(next);
    };
    window.addEventListener("popstate", onPop);
    onCleanup(() => {
      window.removeEventListener("popstate", onPop);
      removeCloseListener?.();
    });
  });

  return (
    <>
      <div style={{ display: page() === "editor" ? "contents" : "none" }}>
        <EditorPage activePage={page()} onNavigatePage={navigate} />
      </div>
      <Show when={agentsMounted()}>
        <div style={{ display: page() === "agents" ? "contents" : "none" }}>
          <AgentsPage activePage={page()} onNavigatePage={navigate} />
        </div>
      </Show>
    </>
  );
};

export default App;
