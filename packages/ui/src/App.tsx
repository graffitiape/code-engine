import { Component, createSignal, onCleanup, onMount, Show } from "solid-js";
import EditorPage from "./pages/EditorPage";
import AgentsPage from "./pages/AgentsPage";
import type { PageKey } from "./design";

function pageFromPath(path: string): PageKey {
  if (path.startsWith("/agents")) return "agents";
  return "editor";
}

const App: Component = () => {
  const [page, setPage] = createSignal<PageKey>(pageFromPath(window.location.pathname));

  const navigate = (next: PageKey) => {
    const path = next === "agents" ? "/agents" : "/";
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path);
    }
    setPage(next);
  };

  onMount(() => {
    const onPop = () => setPage(pageFromPath(window.location.pathname));
    window.addEventListener("popstate", onPop);
    onCleanup(() => window.removeEventListener("popstate", onPop));
  });

  return (
    <>
      <Show when={page() === "editor"}>
        <EditorPage activePage={page()} onNavigatePage={navigate} />
      </Show>
      <Show when={page() === "agents"}>
        <AgentsPage activePage={page()} onNavigatePage={navigate} />
      </Show>
    </>
  );
};

export default App;
