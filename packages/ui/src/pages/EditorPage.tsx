import { Component, For, createSignal, createEffect, onMount, onCleanup, Show } from "solid-js";
import { createStore } from "solid-js/store";
import {
  TitleBar,
  PageSwitcher,
  ProjectSwitcher,
  Sidebar,
  Breadcrumbs,
  StatusBar,
  CommandPalette,
  GitPanel,
  Minimap,
  SearchReplace,
  SettingsPanel,
} from "../design";
import { save as showSaveDialog } from "@tauri-apps/plugin-dialog";
import type { FileNode, Tab } from "../design/types";
import type { PageKey } from "../design";
import CodeEditor from "../components/editor/CodeEditor";
import {
  createDirectory,
  createFile,
  listTrash,
  readDir,
  renamePath,
  restoreFromTrash,
  trashPath,
  type FsNode,
  type TrashEntry,
} from "../bridge/tauri";
import {
  chooseFolder as showFolderDialog,
  setActiveRoot,
  useWorkspace,
} from "../stores/workspace";
import {
  acceptExternalVersion,
  activeBufferPath,
  clearBuffers,
  closeBuffer,
  createUntitledBuffer,
  ensureBuffer,
  getBuffer,
  getDirtyBufferPaths,
  isDirty,
  isUntitled,
  keepLocalVersion,
  refreshBuffersFromDisk,
  remapBufferPaths,
  saveBuffer,
  saveBufferAs,
  setActivePath,
  updateCursor,
  useBuffersVersion,
} from "../stores/buffers";
import { basename, dirname, iconForName } from "../lib/fileIcon";
import { handleTitlebarMouseDown, handleTitlebarMouseUp } from "../lib/titlebar";
import { loadEditorSession, saveEditorSession } from "../stores/editor-session";
import { useSettingsStore } from "../stores/settings";

type OverlayName = "palette" | "git" | "minimap" | "search" | "settings" | null;

const messageForError = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

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

function collectExpandedPaths(nodes: FileNode[], paths = new Set<string>()): Set<string> {
  for (const node of nodes) {
    if (node.type === "dir" && node.expanded && node.path) paths.add(node.path);
    if (node.children?.length) collectExpandedPaths(node.children, paths);
  }
  return paths;
}

interface EditorPageProps {
  activePage: PageKey;
  onNavigatePage: (page: PageKey) => void;
}

const EditorPage: Component<EditorPageProps> = (props) => {
  const [treeStore, setTreeStore] = createStore<{ nodes: FileNode[] }>({
    nodes: [],
  });
  const [tabs, setTabs] = createSignal<Tab[]>([]);
  const [activeTabId, setActiveTabId] = createSignal<string>("");
  const [sidebarOpen, setSidebarOpen] = createSignal(true);
  const [activeOverlay, setActiveOverlay] = createSignal<OverlayName>(null);
  const [paletteMode, setPaletteMode] = createSignal<"files" | "commands">("files");
  const [error, setError] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal<string | null>(null);
  const [trashEntries, setTrashEntries] = createSignal<TrashEntry[]>([]);
  let loadedRoot: string | null | undefined;
  let rootLoadGeneration = 0;
  let sessionGeneration = 0;
  let sessionReadyRoot: string | null = null;
  let fileNavigationGeneration = 0;

  const workspace = useWorkspace();
  const { settings: appSettings } = useSettingsStore();
  const buffersVer = useBuffersVersion();

  async function loadRootTree(rootPath: string, announce = true) {
    const generation = ++rootLoadGeneration;
    const expandedPaths = collectExpandedPaths(treeStore.nodes);
    expandedPaths.add(rootPath);
    if (announce) setBusy("Loading workspace…");
    try {
      const loadChildren = async (directory: string, depth: number): Promise<FileNode[]> => {
        const entries = await readDir(directory);
        return Promise.all(
          entries.map(async (entry) => {
            const node = nodeFromFs(entry, depth);
            if (node.type === "dir" && node.path && expandedPaths.has(node.path)) {
              node.expanded = true;
              node.children = await loadChildren(node.path, depth + 1);
            }
            return node;
          }),
        );
      };
      const children = await loadChildren(rootPath, 1);
      if (generation !== rootLoadGeneration || workspace.activeRoot() !== rootPath) return;
      const rootName = basename(rootPath);
      const root: FileNode = {
        type: "dir",
        name: rootName || rootPath,
        depth: 0,
        path: rootPath,
        expanded: true,
        children,
      };
      setTreeStore("nodes", [root]);
    } finally {
      if (announce && generation === rootLoadGeneration) setBusy(null);
    }
  }

  const confirmDiscardDirty = (): boolean => {
    const dirty = getDirtyBufferPaths();
    if (!dirty.length) return true;
    return window.confirm(
      `Discard unsaved changes in ${dirty.length} open ${dirty.length === 1 ? "file" : "files"}?`,
    );
  };

  async function activateWorkspace(path: string) {
    if (path === workspace.activeRoot()) return;
    if (!confirmDiscardDirty()) return;
    await setActiveRoot(path);
  }

  async function chooseFolder() {
    setError(null);
    try {
      const picked = await showFolderDialog();
      if (!picked) return;
      await activateWorkspace(picked);
    } catch (e) {
      console.error("[CE] chooseFolder failed:", e);
      setError(String(e));
    }
  }

  async function openRecent(path: string) {
    setError(null);
    try {
      await activateWorkspace(path);
    } catch (e) {
      console.error("[CE] openRecent failed:", e);
      setError(String(e));
    }
  }

  // Keyboard shortcuts (workspace-level, NOT editor-level — those live inside CodeMirror)
  onMount(async () => {
    const handler = (e: KeyboardEvent) => {
      if (props.activePage !== "editor") return;
      const cmd = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (cmd && e.shiftKey && key === "p") {
        e.preventDefault();
        setPaletteMode("commands");
        setActiveOverlay("palette");
      } else if (cmd && key === "p" && !e.shiftKey) {
        e.preventDefault();
        setPaletteMode("files");
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
        void chooseFolder();
      } else if (cmd && key === "t" && !e.shiftKey) {
        e.preventDefault();
        void newTab();
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
    const refreshWorkspace = () => {
      if (props.activePage !== "editor") return;
      void refreshProjectFiles().catch((refreshError) => setError(messageForError(refreshError)));
    };
    const refreshTimer = window.setInterval(refreshWorkspace, 5000);
    window.addEventListener("focus", refreshWorkspace);
    onCleanup(() => {
      window.removeEventListener("keydown", handler);
      window.removeEventListener("focus", refreshWorkspace);
      window.clearInterval(refreshTimer);
    });
  });

  // Project changes are global (the selector is shared by Editor and Agents).
  // Reset editor-local state and load the new tree whenever that root changes.
  createEffect(() => {
    const root = workspace.activeRoot();
    if (root === loadedRoot) return;
    loadedRoot = root;
    const generation = ++sessionGeneration;
    sessionReadyRoot = null;
    rootLoadGeneration += 1;
    fileNavigationGeneration += 1;
    clearBuffers();
    setTabs([]);
    setActiveTabId("");
    setTreeStore("nodes", []);
    setTrashEntries([]);
    setError(null);
    if (!root) return;

    void loadRootTree(root);
    void listTrash()
      .then((entries) => {
        if (generation === sessionGeneration) setTrashEntries(entries);
      })
      .catch(() => undefined);
    const session = loadEditorSession(root);
    if (!session?.tabs.length) {
      sessionReadyRoot = root;
      return;
    }

    const restoredTabs: Tab[] = session.tabs.map((path) => ({
      id: path,
      name: basename(path),
      icon: iconForName(path),
      dirty: false,
    }));
    const active =
      session.activeTabId && session.tabs.includes(session.activeTabId)
        ? session.activeTabId
        : session.tabs[0];
    setTabs(restoredTabs);
    setActiveTabId(active);
    setActivePath(active);
    void ensureBuffer(active)
      .catch((restoreError) => {
        if (generation !== sessionGeneration) return;
        setTabs((items) => items.filter((tab) => tab.id !== active));
        setActiveTabId("");
        setActivePath(null);
        setError(
          `Could not restore ${basename(active)}: ${
            restoreError instanceof Error ? restoreError.message : String(restoreError)
          }`,
        );
      })
      .finally(() => {
        if (generation === sessionGeneration) sessionReadyRoot = root;
      });
  });

  let observedFilesVersion = workspace.filesVersion();
  createEffect(() => {
    const version = workspace.filesVersion();
    if (version === observedFilesVersion) return;
    observedFilesVersion = version;
    void refreshProjectFiles().catch((refreshError) => setError(messageForError(refreshError)));
  });

  let previousPage = props.activePage;
  createEffect(() => {
    const page = props.activePage;
    if (page === "editor" && previousPage !== "editor") {
      void refreshProjectFiles().catch((refreshError) => setError(messageForError(refreshError)));
    }
    previousPage = page;
  });

  createEffect(() => {
    const root = workspace.activeRoot();
    const currentTabs = tabs();
    const currentActive = activeTabId();
    if (!root || sessionReadyRoot !== root) return;
    saveEditorSession(root, currentTabs, currentActive);
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

  function collapseAll() {
    const collapse = (nodes: FileNode[]): FileNode[] =>
      nodes.map((node) => ({
        ...node,
        expanded: node.type === "dir" ? false : node.expanded,
        children: node.children ? collapse(node.children) : node.children,
      }));
    setTreeStore("nodes", collapse(treeStore.nodes));
  }

  const joinWorkspacePath = (parent: string, child: string) =>
    `${parent.replace(/[\\/]+$/, "")}/${child}`;

  async function createExplorerFile(parent?: FileNode) {
    const root = workspace.activeRoot();
    const directory = parent?.type === "dir" ? parent.path : root;
    if (!directory) return;
    const name = window.prompt("New file path", "");
    if (!name?.trim()) return;
    const path = joinWorkspacePath(directory, name.trim());
    setBusy("Creating file…");
    setError(null);
    try {
      await createFile(path);
      if (workspace.activeRoot() !== root) return;
      await loadRootTree(root!);
      await openFile(path);
    } catch (createError) {
      setError(messageForError(createError));
    } finally {
      setBusy(null);
    }
  }

  async function createExplorerDirectory(parent?: FileNode) {
    const root = workspace.activeRoot();
    const directory = parent?.type === "dir" ? parent.path : root;
    if (!directory) return;
    const name = window.prompt("New folder path", "");
    if (!name?.trim()) return;
    setBusy("Creating folder…");
    setError(null);
    try {
      await createDirectory(joinWorkspacePath(directory, name.trim()));
      if (workspace.activeRoot() !== root) return;
      await loadRootTree(root!);
    } catch (createError) {
      setError(messageForError(createError));
    } finally {
      setBusy(null);
    }
  }

  async function renameExplorerNode(node: FileNode) {
    if (!node.path || node.depth === 0) return;
    const source = node.path;
    const root = workspace.activeRoot();
    const name = window.prompt("Rename to", node.name)?.trim();
    if (!name || name === node.name) return;
    if (name === "." || name === ".." || /[\\/]/.test(name)) {
      setError("Enter a single file or folder name without path separators.");
      return;
    }
    const destination = joinWorkspacePath(dirname(source), name);
    const remappedTabs = tabs().map((tab) =>
      tab.id === source || tab.id.startsWith(`${source}/`)
        ? `${destination}${tab.id.slice(source.length)}`
        : tab.id,
    );
    if (new Set(remappedTabs).size !== remappedTabs.length) {
      setError("The renamed path conflicts with another open tab.");
      return;
    }

    setBusy("Renaming…");
    setError(null);
    try {
      await renamePath(source, destination);
      if (workspace.activeRoot() !== root) return;
      remapBufferPaths(source, destination);
      setTabs((items) =>
        items.map((tab) => {
          if (tab.id !== source && !tab.id.startsWith(`${source}/`)) return tab;
          const id = `${destination}${tab.id.slice(source.length)}`;
          return { ...tab, id, name: basename(id), icon: iconForName(id) };
        }),
      );
      const active = activeTabId();
      if (active === source || active.startsWith(`${source}/`)) {
        const id = `${destination}${active.slice(source.length)}`;
        setActiveTabId(id);
        setActivePath(id);
      }
      await loadRootTree(root!);
    } catch (renameError) {
      setError(messageForError(renameError));
    } finally {
      setBusy(null);
    }
  }

  async function trashExplorerNode(node: FileNode) {
    if (!node.path || node.depth === 0) return;
    const source = node.path;
    const root = workspace.activeRoot();
    const affects = (path: string) => path === source || path.startsWith(`${source}/`);
    const affectedTabs = tabs().filter((tab) => affects(tab.id));
    const dirtyCount = getDirtyBufferPaths().filter(affects).length;
    const warning = dirtyCount
      ? ` This will discard unsaved changes in ${dirtyCount} open ${dirtyCount === 1 ? "file" : "files"}.`
      : "";
    if (!window.confirm(`Move ${node.name} to recoverable trash?${warning}`)) return;

    setBusy("Moving to trash…");
    setError(null);
    try {
      const entry = await trashPath(source);
      if (workspace.activeRoot() !== root) return;
      affectedTabs.forEach((tab) => closeBuffer(tab.id));
      const remaining = tabs().filter((tab) => !affects(tab.id));
      setTabs(remaining);
      if (affects(activeTabId())) {
        const next = remaining[0]?.id ?? "";
        setActiveTabId(next);
        setActivePath(next || null);
      }
      setTrashEntries((entries) => [entry, ...entries.filter((item) => item.trashedPath !== entry.trashedPath)]);
      await loadRootTree(root!);
    } catch (trashError) {
      setError(messageForError(trashError));
    } finally {
      setBusy(null);
    }
  }

  async function restoreTrashEntry(entry: TrashEntry) {
    const root = workspace.activeRoot();
    setBusy("Restoring file…");
    setError(null);
    try {
      await restoreFromTrash(entry);
      if (workspace.activeRoot() !== root) return;
      setTrashEntries(await listTrash());
      await loadRootTree(root!);
    } catch (restoreError) {
      setError(messageForError(restoreError));
    } finally {
      setBusy(null);
    }
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

  async function openFileAt(path: string, line: number, column: number) {
    const generation = ++fileNavigationGeneration;
    const reopenActive = activeTabId() === path;
    try {
      await ensureBuffer(path);
      if (generation !== fileNavigationGeneration) return;
      updateCursor(path, line, column);
      // CodeMirror seeds its selection from the buffer when it mounts. Briefly
      // unmount an already-active file so repeated results in one file also
      // move the caret and viewport to the requested location.
      if (reopenActive) {
        setActiveTabId("");
        setActivePath(null);
        await Promise.resolve();
        if (generation !== fileNavigationGeneration) return;
      }
      ensureTab(path);
    } catch (openError) {
      setError(messageForError(openError));
    }
  }

  async function refreshProjectFiles() {
    const changes = await refreshBuffersFromDisk();
    if (changes.some((change) => change.state === "conflict" || change.state === "missing")) {
      setError("One or more open files changed outside Code Engine.");
    }
    const root = workspace.activeRoot();
    if (root) await loadRootTree(root, false);
  }

  function closeTab(id: string) {
    if (isDirty(id) && !window.confirm(`Close ${basename(id)} without saving?`)) {
      return;
    }
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
    const id = `untitled-${Date.now()}`;
    setTabs([...tabs(), { id, name: "untitled", icon: "file", dirty: false }]);
    setActiveTabId(id);
    setActivePath(id);
    createUntitledBuffer(id);
  }

  async function savePath(path: string) {
    setError(null);
    try {
      if (!isUntitled(path)) {
        await saveBuffer(path);
        return;
      }

      const root = workspace.activeRoot();
      const destination = await showSaveDialog({
        title: "Save File",
        defaultPath: root ? `${root}/untitled` : "untitled",
      });
      if (typeof destination !== "string") return;
      await saveBufferAs(path, destination);
      setTabs((items) =>
        items.map((tab) =>
          tab.id === path
            ? {
                ...tab,
                id: destination,
                name: basename(destination),
                icon: iconForName(destination),
                dirty: false,
              }
            : tab,
        ),
      );
      setActiveTabId(destination);
      setActivePath(destination);
      if (root) await loadRootTree(root);
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : String(saveError);
      setError(message);
      throw saveError;
    }
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

  const currentConflict = () => {
    void buffersVer();
    const buffer = getBuffer(activeTabId());
    if (!buffer || (!buffer.missingOnDisk && buffer.externalContent === null)) return null;
    return buffer;
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
              </div>
              <EmptyWorkspace
                onPick={chooseFolder}
                onOpenRecent={openRecent}
                recents={workspace.recents()}
                busy={busy()}
                error={error() ?? workspace.error()}
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
            onCommandPalette={() => {
              setPaletteMode("commands");
              setActiveOverlay("palette");
            }}
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
              onNewFile={() => void createExplorerFile()}
              onNewFileIn={(node) => void createExplorerFile(node)}
              onNewFolder={(node) => void createExplorerDirectory(node)}
              onRename={(node) => void renameExplorerNode(node)}
              onTrash={(node) => void trashExplorerNode(node)}
              trashEntries={trashEntries()}
              onRestore={(entry) => void restoreTrashEntry(entry)}
              onCollapseAll={collapseAll}
            />
            <div class="workspace">
              <Show when={breadcrumbsFile()}>
                <Breadcrumbs
                  file={breadcrumbsFile()}
                  diagCounts={diagCounts}
                />
              </Show>
              <Show when={currentConflict()}>
                {(buffer) => (
                  <div class="external-change-banner">
                    <div>
                      <strong>{buffer().missingOnDisk ? "File removed on disk" : "File changed on disk"}</strong>
                      <span>
                        {buffer().missingOnDisk
                          ? "Keep your buffer to recreate it, or close the tab."
                          : "Choose which version should remain open."}
                      </span>
                    </div>
                    <Show when={buffer().externalContent !== null}>
                      <button
                        type="button"
                        onClick={() => acceptExternalVersion(buffer().path)}
                      >
                        Use disk version
                      </button>
                    </Show>
                    <button
                      type="button"
                      class="primary"
                      onClick={() =>
                        void keepLocalVersion(buffer().path).catch((saveError) =>
                          setError(messageForError(saveError)),
                        )
                      }
                    >
                      Keep mine
                    </button>
                  </div>
                )}
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
                    <CodeEditor
                      path={activeTabId()}
                      onSave={savePath}
                      onError={setError}
                      fontFamily={appSettings.font_family}
                      fontSize={appSettings.font_size}
                      lineHeight={appSettings.line_height}
                      wordWrap={appSettings.word_wrap}
                      tabSize={appSettings.tab_size}
                    />
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
            mode={paletteMode()}
            commands={[
              {
                id: "file.new",
                label: "New File",
                detail: "Create an untitled editor buffer",
                shortcut: "⌘T",
                icon: "plus",
                run: newTab,
              },
              {
                id: "project.open",
                label: "Open Folder…",
                detail: "Switch to another project",
                shortcut: "⌘O",
                icon: "folder",
                run: chooseFolder,
              },
              {
                id: "search.project",
                label: "Find in Project",
                detail: "Search and replace across the active project",
                shortcut: "⌘⇧F",
                icon: "search",
                run: () => { setActiveOverlay("search"); },
              },
              {
                id: "git.open",
                label: "Open Source Control",
                detail: "Review, stage, and commit changes",
                icon: "git",
                run: () => { setActiveOverlay("git"); },
              },
              {
                id: "view.sidebar",
                label: sidebarOpen() ? "Hide Explorer" : "Show Explorer",
                shortcut: "⌘B",
                icon: "file",
                run: () => { setSidebarOpen((value) => !value); },
              },
              {
                id: "view.agents",
                label: "Open Agents",
                detail: "Work with Codex on this project",
                icon: "bolt",
                run: () => props.onNavigatePage("agents"),
              },
              {
                id: "settings.open",
                label: "Open Settings",
                shortcut: "⌘,",
                icon: "settings",
                run: () => { setActiveOverlay("settings"); },
              },
            ]}
          />
        </Show>
        <Show when={activeOverlay() === "minimap"}>
          <Minimap onClose={() => setActiveOverlay(null)} onOpenFile={openFile as any} />
        </Show>
        <Show when={activeOverlay() === "search"}>
          <SearchReplace
            workspaceRoot={workspace.activeRoot()}
            onSelectResult={(location) =>
              openFileAt(location.path, location.line, location.column)
            }
            onReplaced={refreshProjectFiles}
            onClose={() => setActiveOverlay(null)}
          />
        </Show>
        <Show when={activeOverlay() === "git"}>
          <GitPanel
            onClose={() => setActiveOverlay(null)}
            workspaceRoot={workspace.activeRoot()}
            onOpenFile={(p: string) => openFile(p)}
            onRepositoryChanged={refreshProjectFiles}
          />
        </Show>
        <Show when={activeOverlay() === "settings"}>
          <SettingsPanel onClose={() => setActiveOverlay(null)} />
        </Show>
        <Show when={error() && hasWorkspace()}>
          <div class="editor-error-toast" role="alert">
            <span>{error()}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss error">
              ×
            </button>
          </div>
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
