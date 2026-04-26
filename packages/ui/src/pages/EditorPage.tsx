import { Component, For, createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
  TitleBar,
  Sidebar,
  Breadcrumbs,
  StatusBar,
  CommandPalette,
  GitPanel,
  Minimap,
  SearchReplace,
  SettingsPanel,
} from "../design";
import type { FileNode, Tab } from "../design/types";
import type { PageKey } from "../design";
import CodeEditor from "../components/editor/CodeEditor";
import { readDir, type FsNode } from "../bridge/tauri";
import {
  pickFolder,
  restoreActiveRoot,
  setActiveRoot,
  useWorkspace,
} from "../stores/workspace";
import {
  activeBufferPath,
  clearBuffers,
  closeBuffer,
  ensureBuffer,
  getBuffer,
  isDirty,
  saveBuffer,
  setActivePath,
  useBuffersVersion,
} from "../stores/buffers";
import { basename, dirname, iconForName } from "../lib/fileIcon";
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from "../lib/titlebar";

const isTauri = (): boolean =>
  typeof window !== "undefined" &&
  ("__TAURI_INTERNALS__" in window || "__TAURI__" in window);

type OverlayName = "palette" | "git" | "minimap" | "search" | "settings" | null;

const TWEAK_DEFAULTS = {
  theme: "tokyonight",
  vibrancy: "on",
  density: "compact",
};

function nodeFromFs(entry: FsNode, depth: number): FileNode {
  return {
    type: entry.kind === "dir" ? "dir" : "file",
    name: entry.name,
    depth,
    path: entry.path,
    expanded: false,
    children: entry.kind === "dir" ? [] : undefined,
    icon: entry.kind === "file" ? iconForName(entry.name) : undefined,
  };
}

// Recursively look up a node by absolute path; returns indices into the tree.
function findIndexPath(
  tree: FileNode[],
  target: string,
): number[] | null {
  for (let i = 0; i < tree.length; i++) {
    const n = tree[i];
    if (n.path === target) return [i];
    if (n.children && n.children.length) {
      const sub = findIndexPath(n.children, target);
      if (sub) return [i, ...sub];
    }
  }
  return null;
}

interface EditorPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
}

const EditorPage: Component<EditorPageProps> = (props) => {
  const [settings, setSettings] = createStore({ ...TWEAK_DEFAULTS });
  const [treeStore, setTreeStore] = createStore<{ nodes: FileNode[] }>({
    nodes: [],
  });
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string>("");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [activeOverlay, setActiveOverlay] = createSignal<OverlayName>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);

  const tauriHost = isTauri();
  const workspace = useWorkspace();
  const buffersVer = useBuffersVersion();

  // Theme + density attrs
  createEffect(() => {
    document.documentElement.setAttribute("data-theme", settings.theme);
    document.documentElement.setAttribute("data-density", settings.density);
    document.documentElement.setAttribute("data-vibrancy", settings.vibrancy);
  });

  async function loadRootTree(rootPath: string) {
    setBusy("Loading workspace…");
    try {
      const entries = await readDir(rootPath);
      const rootName = basename(rootPath);
      const root: FileNode = {
        type: "dir",
        name: rootName || rootPath,
        depth: 0,
        path: rootPath,
        expanded: true,
        children: entries.map((e) => nodeFromFs(e, 1)),
      };
      setTreeStore("nodes", [root]);
    } finally {
      setBusy(null);
    }
  }

  async function bootstrap() {
    if (!tauriHost) return;
    const restored = await restoreActiveRoot();
    if (restored) {
      await loadRootTree(restored);
    }
  }

  async function chooseFolder() {
    setError(null);
    try {
      const picked = await pickFolder();
      if (!picked) return;
      // Reset buffer state when switching workspaces.
      clearBuffers();
      setTabs([]);
      setActiveTabId("");
      await loadRootTree(picked);
    } catch (e) {
      console.error("[CE] chooseFolder failed:", e);
      setError(String(e));
    }
  }

  async function openRecent(path: string) {
    setError(null);
    try {
      clearBuffers();
      setTabs([]);
      setActiveTabId("");
      await setActiveRoot(path);
      await loadRootTree(path);
    } catch (e) {
      console.error("[CE] openRecent failed:", e);
      setError(String(e));
    }
  }

  // Keyboard shortcuts (workspace-level, NOT editor-level — those live inside CodeMirror)
  onMount(async () => {
    await bootstrap();

    const handler = (e: KeyboardEvent) => {
      const cmd = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (cmd && e.shiftKey && key === "p") {
        e.preventDefault();
        setActiveOverlay("palette");
      } else if (cmd && key === "p" && !e.shiftKey) {
        e.preventDefault();
        setActiveOverlay("palette");
      } else if (cmd && e.shiftKey && key === "f") {
        e.preventDefault();
        setActiveOverlay("search");
      } else if (cmd && e.shiftKey && key === "m") {
        e.preventDefault();
        setActiveOverlay("minimap");
      } else if (cmd && e.key === ",") {
        e.preventDefault();
        setActiveOverlay("settings");
      } else if (cmd && key === "b") {
        e.preventDefault();
        setSidebarOpen((o) => !o);
      } else if (cmd && key === "o" && !e.shiftKey) {
        e.preventDefault();
        chooseFolder();
      } else if (cmd && key === "w" && !e.shiftKey) {
        // Close active tab
        const id = activeTabId();
        if (id) {
          e.preventDefault();
          closeTab(id);
        }
      } else if (e.key === "Escape" && activeOverlay()) {
        setActiveOverlay(null);
      }
    };
    window.addEventListener("keydown", handler);
    onCleanup(() => window.removeEventListener("keydown", handler));
  });

  // Lazy-load child entries for a directory the first time it expands.
  async function toggleNode(target: FileNode) {
    if (!target.path) return;
    const idx = findIndexPath(treeStore.nodes, target.path);
    if (!idx) return;

    const accessor = () =>
      idx.reduce<any>((acc, i, depth) => {
        if (depth === 0) return acc[i];
        return acc.children[i];
      }, treeStore.nodes);

    const node = accessor();
    if (!node || node.type !== "dir") return;

    const willExpand = !node.expanded;
    setNestedNode(target.path, "expanded", willExpand);

    if (willExpand && (!node.children || node.children.length === 0)) {
      setNestedNode(target.path, "loading", true);
      try {
        const entries = await readDir(target.path);
        const children = entries.map((e) => nodeFromFs(e, target.depth + 1));
        setNestedNode(target.path, "children", children);
      } catch (e) {
        console.error("[CE] readDir failed:", e);
      } finally {
        setNestedNode(target.path, "loading", false);
      }
    }
  }

  function setNestedNode<K extends keyof FileNode>(
    path: string,
    field: K,
    value: FileNode[K],
  ) {
    const idx = findIndexPath(treeStore.nodes, path);
    if (!idx) return;
    const args: any[] = ["nodes"];
    for (let d = 0; d < idx.length; d++) {
      args.push(idx[d]);
      if (d < idx.length - 1) args.push("children");
    }
    args.push(field, value);
    (setTreeStore as any)(...args);
  }

  function ensureTab(path: string) {
    setTabs((arr) => {
      if (arr.some((t) => t.id === path)) return arr;
      return [
        ...arr,
        {
          id: path,
          name: basename(path),
          icon: iconForName(path),
          dirty: false,
        },
      ];
    });
    setActiveTabId(path);
    setActivePath(path);
  }

  async function openFile(node: FileNode | string) {
    const path = typeof node === "string" ? node : node.path ?? node.name;
    if (!path) return;
    try {
      await ensureBuffer(path);
      ensureTab(path);
    } catch (e) {
      console.error("[CE] openFile failed:", e);
      setError(String(e));
    }
  }

  function closeTab(id: string) {
    const arr = tabs();
    const idx = arr.findIndex((t) => t.id === id);
    setTabs(arr.filter((t) => t.id !== id));
    closeBuffer(id);
    if (activeTabId() === id) {
      const next = arr[idx + 1] || arr[idx - 1];
      if (next) {
        setActiveTabId(next.id);
        setActivePath(next.id);
      } else {
        setActiveTabId("");
        setActivePath(null);
      }
    }
  }

  async function newTab() {
    // Create an unsaved scratch buffer in memory.
    const id = `untitled-${Date.now()}`;
    setTabs([...tabs(), { id, name: "untitled", icon: "file", dirty: false }]);
    setActiveTabId(id);
    setActivePath(id);
    await ensureBuffer(id);
  }

  // Sync tab dirty state with buffer dirty
  createEffect(() => {
    void buffersVer();
    const updated = tabs().map((t) => ({
      ...t,
      dirty: isDirty(t.id),
    }));
    // Avoid setting if no diff (cheap structural check)
    const cur = tabs();
    const changed =
      cur.length !== updated.length ||
      cur.some((t, i) => t.dirty !== updated[i].dirty);
    if (changed) setTabs(updated);
  });

  const openFilePaths = () => new Set(tabs().map((t) => t.id));
  const diagCounts = { error: 0, warn: 0 };

  const currentFile = () => {
    const id = activeTabId();
    if (!id || id.startsWith("untitled-")) return undefined;
    return id;
  };

  const breadcrumbsFile = () => {
    const path = currentFile();
    if (!path) return undefined;
    const root = workspace.activeRoot();
    const display = root && path.startsWith(root) ? path.slice(root.length + 1) : path;
    const parts = display.split("/").filter(Boolean);
    return {
      path: parts,
      language: iconForName(path),
      lines: [],
    } as any;
  };

  const cursor = () => {
    const path = activeBufferPath();
    void buffersVer();
    const buf = path ? getBuffer(path) : null;
    return buf?.cursor ?? { line: 0, col: 0 };
  };

  const toggleOverlay = (name: Exclude<OverlayName, null>) =>
    setActiveOverlay((o) => (o === name ? null : name));

  const hasWorkspace = () => Boolean(workspace.activeRoot());

  return (
    <div class="desktop">
      <div class="window">
        <Show
          when={hasWorkspace()}
          fallback={
            <>
              <div
                class="titlebar titlebar-empty"
                aria-hidden="true"
                onMouseDown={handleTitlebarMouseDown}
                onMouseUp={handleTitlebarMouseUp}
              >
                <div class="traffic-lights">
                  <span class="tl close" />
                  <span class="tl min" />
                  <span class="tl max" />
                </div>
              </div>
              <EmptyWorkspace
                onPick={chooseFolder}
                onOpenRecent={openRecent}
                recents={workspace.recents()}
                busy={busy()}
                error={error()}
              />
            </>
          }
        >
          <TitleBar
            tabs={tabs()}
            activeTabId={activeTabId()}
            onTabClick={(id) => {
              setActiveTabId(id);
              setActivePath(id);
            }}
            onTabClose={closeTab}
            onNewTab={newTab}
            onCommandPalette={() => setActiveOverlay("palette")}
            toggleSidebar={() => setSidebarOpen((o) => !o)}
            toggleGit={() => toggleOverlay("git")}
            toggleMinimap={() => toggleOverlay("minimap")}
            toggleSettings={() => toggleOverlay("settings")}
            toggleSearch={() => toggleOverlay("search")}
            sidebarOpen={sidebarOpen()}
            activeOverlay={activeOverlay()}
            activePage={props.activePage}
            onNavigatePage={props.onNavigatePage}
          />
          <div class="body">
            <Sidebar
              tree={treeStore.nodes}
              toggleNode={toggleNode}
              openFile={openFile as any}
              openFilePaths={openFilePaths()}
              collapsed={!sidebarOpen()}
            />
            <div class="workspace">
              <Show when={breadcrumbsFile()}>
                <Breadcrumbs
                  file={breadcrumbsFile()}
                  diagCounts={diagCounts}
                  lspName="text"
                />
              </Show>
              <div class="panes">
                <Show
                  when={activeTabId()}
                  fallback={
                    <div class="pane-loading">
                      Open a file from the sidebar (⌘P to fuzzy-find).
                    </div>
                  }
                >
                  <div class="pane focused" style={{ flex: "1", "min-width": "0" }}>
                    <CodeEditor path={activeTabId()} />
                  </div>
                </Show>
              </div>
              <StatusBar
                mode={"EDIT"}
                file={breadcrumbsFile()}
                cursor={cursor()}
                diagCounts={diagCounts}
                task={busy() ?? null}
                language={
                  activeTabId() ? iconForName(activeTabId()) : null
                }
              />
            </div>
          </div>
        </Show>

        <Show when={activeOverlay() === "palette"}>
          <CommandPalette
            onClose={() => setActiveOverlay(null)}
            onOpenFile={openFile as any}
            workspaceRoot={workspace.activeRoot()}
          />
        </Show>
        <Show when={activeOverlay() === "minimap"}>
          <Minimap onClose={() => setActiveOverlay(null)} onOpenFile={openFile as any} />
        </Show>
        <Show when={activeOverlay() === "search"}>
          <SearchReplace onClose={() => setActiveOverlay(null)} />
        </Show>
        <Show when={activeOverlay() === "git"}>
          <GitPanel
            onClose={() => setActiveOverlay(null)}
            workspaceRoot={workspace.activeRoot()}
            onOpenFile={(p: string) => openFile(p)}
          />
        </Show>
        <Show when={activeOverlay() === "settings"}>
          <SettingsPanel
            onClose={() => setActiveOverlay(null)}
            settings={settings}
            setSettings={(updater: any) => {
              const next =
                typeof updater === "function" ? updater(settings) : updater;
              setSettings(next);
            }}
          />
        </Show>
      </div>
    </div>
  );
};

function tildify(path: string, recents: string[]): string {
  // Infer ~ prefix from any path that looks like /Users/<name>/...
  const probe = recents.find((p) => /^\/Users\/[^/]+\//.test(p)) ?? path;
  const m = probe.match(/^(\/Users\/[^/]+)\//);
  if (m && path.startsWith(m[1] + "/")) return "~" + path.slice(m[1].length);
  return path;
}

const EmptyWorkspace: Component<{
  onPick: () => void;
  onOpenRecent: (path: string) => void;
  recents: string[];
  busy: string | null;
  error: string | null;
}> = (props) => {
  return (
    <div class="empty-workspace">
      <div class="welcome">
        <header class="welcome-hero">
          <span class="welcome-logo" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M5 7l3-2 7 4v6l-3 2-7-4V7z"
                stroke="white"
                stroke-width="1.4"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="11" r="2" fill="white" />
            </svg>
          </span>
          <h1>Code Engine</h1>
          <p class="welcome-tagline">
            A fast, focused place to write code.
          </p>
        </header>

        <section class="welcome-actions">
          <button type="button" class="primary-btn" onClick={props.onPick}>
            <span>Open Folder…</span>
            <span class="kbd">⌘O</span>
          </button>
        </section>

        <Show when={props.recents.length > 0}>
          <section class="welcome-recents">
            <h3 class="welcome-section-label">Recent</h3>
            <ul>
              <For each={props.recents.slice(0, 6)}>
                {(p) => {
                  const display = () => tildify(p, props.recents);
                  const name = basename(p);
                  const parent = tildify(dirname(p), props.recents);
                  return (
                    <li>
                      <button
                        type="button"
                        class="welcome-recent"
                        title={display()}
                        onClick={() => props.onOpenRecent(p)}
                      >
                        <span class="welcome-recent-name">{name}</span>
                        <span class="welcome-recent-parent">{parent}</span>
                      </button>
                    </li>
                  );
                }}
              </For>
            </ul>
          </section>
        </Show>

        <footer class="welcome-hints">
          <span><span class="kbd">⌘O</span> Open folder</span>
          <span><span class="kbd">⌘P</span> Find file</span>
          <span><span class="kbd">⌘,</span> Settings</span>
        </footer>

        <Show when={props.error}>
          <p class="welcome-error">Error: {props.error}</p>
        </Show>
        <Show when={props.busy}>
          <p class="welcome-muted">{props.busy}</p>
        </Show>
      </div>
    </div>
  );
};

export default EditorPage;
