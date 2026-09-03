import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  gitBranches,
  gitCheckoutBranch,
  gitCommit,
  gitDiff,
  gitPublishBranch,
  gitPush,
  gitRecentLog,
  gitRepositoryInfo,
  gitStageAll,
  gitStageFile,
  gitStash,
  gitStatus,
  gitUnstageAll,
  gitUnstageFile,
  type GitBranchInfo,
  type GitDiffKind,
  type GitDiffResult,
  type GitFileStatus,
  type GitLogEntry,
  type GitRepositoryInfo,
  type GitRepoStatus,
} from "../../bridge/tauri";
import { Icon } from "../Icon";
import { GitSetupDialog, gitProviderLabel } from "./GitSetupDialog";

export interface GitPanelProps {
  onClose: () => void;
  workspaceRoot: string | null;
  onOpenFile?: (path: string) => void;
  onRepositoryChanged?: () => void | Promise<void>;
}

type GitTab = "status" | "log" | "branches";
interface SelectedFile {
  file: GitFileStatus;
  diffKind: GitDiffKind;
}

const TABS: GitTab[] = ["status", "log", "branches"];
const messageFor = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function statusBadge(file: GitFileStatus): string {
  return { new: "A", modified: "M", deleted: "D", renamed: "R", conflict: "U" }[
    file.kind
  ] ?? "?";
}

function kindFor(file: GitFileStatus): GitDiffKind {
  if (file.state === "staged") return "staged";
  if (file.state === "untracked") return "untracked";
  return "unstaged";
}

function absolutePath(root: string, relative: string): string {
  return `${root.replace(/[\\/]+$/, "")}/${relative}`;
}

export function GitPanel(props: GitPanelProps) {
  const [status, setStatus] = createSignal<GitRepoStatus | null>(null);
  const [repositoryInfo, setRepositoryInfo] = createSignal<GitRepositoryInfo | null>(null);
  const [selected, setSelected] = createSignal<SelectedFile | null>(null);
  const [diff, setDiff] = createSignal<GitDiffResult | null>(null);
  const [logs, setLogs] = createSignal<GitLogEntry[]>([]);
  const [branches, setBranches] = createSignal<GitBranchInfo[]>([]);
  const [activeTab, setActiveTab] = createSignal<GitTab>("status");
  const [commitMessage, setCommitMessage] = createSignal("");
  const [stashMessage, setStashMessage] = createSignal("");
  const [loading, setLoading] = createSignal(true);
  const [diffLoading, setDiffLoading] = createSignal(false);
  const [operation, setOperation] = createSignal<string | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [notice, setNotice] = createSignal<string | null>(null);
  const [setupOpen, setSetupOpen] = createSignal(false);
  const [pendingSetupAction, setPendingSetupAction] = createSignal<"commit" | "stash" | null>(null);
  let statusGeneration = 0;
  let diffGeneration = 0;

  const allFiles = createMemo<SelectedFile[]>(() => {
    const snapshot = status();
    if (!snapshot) return [];
    return [...snapshot.staged, ...snapshot.unstaged, ...snapshot.untracked].map((file) => ({
      file,
      diffKind: kindFor(file),
    }));
  });

  function reconcileSelection(snapshot: GitRepoStatus) {
    const current = selected();
    const files = [...snapshot.staged, ...snapshot.unstaged, ...snapshot.untracked].map((file) => ({
      file,
      diffKind: kindFor(file),
    }));
    setSelected(
      files.find(
        (item) =>
          item.file.path === current?.file.path && item.diffKind === current.diffKind,
      ) ?? files[0] ?? null,
    );
  }

  async function refresh(silent = false) {
    const root = props.workspaceRoot;
    const generation = ++statusGeneration;
    if (!root) {
      setStatus(null);
      setError("Open a project to use source control.");
      setLoading(false);
      return;
    }
    if (!silent) setLoading(true);
    try {
      const snapshot = await gitStatus(root);
      if (generation !== statusGeneration || props.workspaceRoot !== root) return;
      setStatus(snapshot);
      reconcileSelection(snapshot);
      if (!silent) setError(null);
    } catch (refreshError) {
      if (generation !== statusGeneration) return;
      setStatus(null);
      setSelected(null);
      setError(messageFor(refreshError));
    } finally {
      if (generation === statusGeneration) setLoading(false);
    }
  }

  async function loadAuxiliary(tab: GitTab) {
    const root = props.workspaceRoot;
    if (!root || tab === "status") return;
    setLoading(true);
    setError(null);
    try {
      if (tab === "log") setLogs(await gitRecentLog(root, 100));
      if (tab === "branches") setBranches(await gitBranches(root));
    } catch (loadError) {
      setError(messageFor(loadError));
    } finally {
      setLoading(false);
    }
  }

  async function refreshRepositoryInfo() {
    const root = props.workspaceRoot;
    if (!root) {
      setRepositoryInfo(null);
      return;
    }
    try {
      const snapshot = await gitRepositoryInfo(root);
      if (props.workspaceRoot === root) setRepositoryInfo(snapshot);
    } catch {
      if (props.workspaceRoot === root) setRepositoryInfo(null);
    }
  }

  async function mutate(
    label: string,
    action: (root: string) => Promise<unknown>,
    refreshEditor = false,
  ): Promise<boolean> {
    const root = props.workspaceRoot;
    if (!root || operation()) return false;
    setOperation(label);
    setError(null);
    setNotice(null);
    try {
      await action(root);
      if (props.workspaceRoot !== root) return false;
      setNotice(`${label} completed.`);
      await refresh(true);
      await refreshRepositoryInfo();
      await loadAuxiliary(activeTab());
      if (refreshEditor) {
        try {
          await props.onRepositoryChanged?.();
        } catch (refreshError) {
          setError(`Repository changed, but the editor refresh failed: ${messageFor(refreshError)}`);
        }
      }
      return true;
    } catch (mutationError) {
      const message = messageFor(mutationError);
      setError(message);
      if (message.toLowerCase().includes("git identity is not configured")) {
        if (label === "Commit") setPendingSetupAction("commit");
        if (label === "Stash") setPendingSetupAction("stash");
        setSetupOpen(true);
      }
      return false;
    } finally {
      setOperation(null);
    }
  }

  async function commit() {
    if (repositoryInfo() && !repositoryInfo()!.identity.configured) {
      setPendingSetupAction("commit");
      setSetupOpen(true);
      return;
    }
    const message = commitMessage();
    if (await mutate("Commit", (root) => gitCommit(root, message))) {
      setCommitMessage("");
    }
  }

  async function stashAll() {
    if (repositoryInfo() && !repositoryInfo()!.identity.configured) {
      setPendingSetupAction("stash");
      setSetupOpen(true);
      return;
    }
    if (
      await mutate(
        "Stash",
        (root) => gitStash(root, stashMessage().trim() || undefined),
        true,
      )
    ) {
      setStashMessage("");
    }
  }

  async function pushOrPublish() {
    const info = repositoryInfo();
    if (!info?.remote) {
      setError("This repository has no remote. Add one before publishing or pushing.");
      setSetupOpen(true);
      return;
    }
    const publishing = !info.upstream;
    await mutate(
      publishing ? "Publish branch" : "Push",
      (root) => publishing ? gitPublishBranch(root) : gitPush(root),
    );
  }

  function closeSetup() {
    setSetupOpen(false);
    setPendingSetupAction(null);
  }

  function handleIdentitySaved(snapshot: GitRepositoryInfo) {
    setRepositoryInfo(snapshot);
    const pending = pendingSetupAction();
    setSetupOpen(false);
    setPendingSetupAction(null);
    if (pending === "commit") queueMicrotask(() => void commit());
    if (pending === "stash") queueMicrotask(() => void stashAll());
  }

  createEffect(() => {
    void props.workspaceRoot;
    setSelected(null);
    setDiff(null);
    void refresh();
    void refreshRepositoryInfo();
  });

  createEffect(() => {
    const tab = activeTab();
    void loadAuxiliary(tab);
  });

  createEffect(() => {
    const root = props.workspaceRoot;
    const item = selected();
    const generation = ++diffGeneration;
    if (!root || !item) {
      setDiff(null);
      return;
    }
    setDiffLoading(true);
    void gitDiff(root, item.file.path, item.diffKind)
      .then((result) => {
        if (generation === diffGeneration) setDiff(result);
      })
      .catch((diffError) => {
        if (generation === diffGeneration) {
          setDiff(null);
          setError(messageFor(diffError));
        }
      })
      .finally(() => {
        if (generation === diffGeneration) setDiffLoading(false);
      });
  });

  onMount(() => {
    const timer = window.setInterval(() => {
      if (!operation()) void refresh(true);
    }, 3_000);
    onCleanup(() => window.clearInterval(timer));
  });

  function selectFile(file: GitFileStatus) {
    setError(null);
    setSelected({ file, diffKind: kindFor(file) });
  }

  function fileRow(file: GitFileStatus) {
    const isStaged = file.state === "staged";
    const active = () =>
      selected()?.file.path === file.path && selected()?.diffKind === kindFor(file);
    return (
      <div
        class={`row ${active() ? "active" : ""}`}
        onClick={() => selectFile(file)}
        onDblClick={() => {
          if (file.kind !== "deleted" && status()) {
            props.onOpenFile?.(absolutePath(status()!.repoRoot, file.path));
          }
        }}
        title="Select for diff · double-click to open"
      >
        <span class={`status ${statusBadge(file)}`}>{statusBadge(file)}</span>
        <span class="path">{file.path}</span>
        <button
          class="icon-btn"
          disabled={Boolean(operation())}
          title={isStaged ? "Unstage file" : "Stage file"}
          onClick={(event) => {
            event.stopPropagation();
            void mutate(isStaged ? "Unstage file" : "Stage file", (root) =>
              isStaged ? gitUnstageFile(root, file.path) : gitStageFile(root, file.path),
            );
          }}
        >
          {isStaged ? "−" : "+"}
        </button>
      </div>
    );
  }

  function fileGroup(title: string, files: GitFileStatus[], staged: boolean) {
    return (
      <>
        <div class="group">
          <span>{title}</span>
          <span class="count">{files.length}</span>
          <Show when={files.length > 0}>
            <button
              class="icon-btn"
              disabled={Boolean(operation())}
              title={staged ? "Unstage all" : "Stage all changes"}
              onClick={() =>
                void mutate(staged ? "Unstage all" : "Stage all", (root) =>
                  staged ? gitUnstageAll(root) : gitStageAll(root),
                )
              }
            >
              {staged ? "−" : "+"}
            </button>
          </Show>
        </div>
        <div class="list" style={{ flex: "none", "max-height": "150px" }}>
          <For each={files}>{fileRow}</For>
        </div>
      </>
    );
  }

  const patchLines = createMemo(() => diff()?.patch.split("\n") ?? []);

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay git-panel" role="dialog" aria-label="Source control">
        <div class="git-header">
          <div class="title"><Icon name="git" /> Source Control</div>
          <Show when={status()}>
            <div class="branch-pill"><Icon name="branch" /> {status()!.branch}</div>
            <span class="ahead-behind">↑{status()!.ahead} · ↓{status()!.behind}</span>
          </Show>
          <Show when={repositoryInfo()?.remote}>
            {(remote) => (
              <button class="git-remote-pill" type="button" onClick={() => setSetupOpen(true)} title={remote().displayUrl}>
                {gitProviderLabel(remote().provider)} <small>{remote().name}</small>
              </button>
            )}
          </Show>
          <Show when={repositoryInfo() && !repositoryInfo()!.identity.configured}>
            <button class="git-identity-warning" type="button" onClick={() => setSetupOpen(true)}>
              Set Git identity
            </button>
          </Show>
          <div class="tabs-row">
            <For each={TABS}>
              {(tab) => (
                <button class={`gtab ${activeTab() === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                  {tab[0].toUpperCase() + tab.slice(1)}
                </button>
              )}
            </For>
          </div>
          <Show when={repositoryInfo()?.remote}>
            <button
              class="git-header-action"
              type="button"
              disabled={Boolean(operation())}
              onClick={() => void pushOrPublish()}
            >
              {operation() === "Push" || operation() === "Publish branch"
                ? `${operation()}…`
                : repositoryInfo()!.upstream ? "Push" : "Publish branch"}
            </button>
          </Show>
          <button class="icon-btn" type="button" onClick={() => setSetupOpen(true)} title="Git setup"><Icon name="settings" /></button>
          <button class="icon-btn" disabled={loading()} onClick={() => void refresh()} title="Refresh">↻</button>
          <button class="icon-btn" onClick={props.onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <Show when={error() || notice() || operation()}>
          <div style={{ padding: "7px 14px", color: error() ? "var(--red)" : operation() ? "var(--fg-2)" : "var(--green)", "border-bottom": "1px solid var(--border)", "font-size": "var(--ui-font-11)" }}>
            {error() ?? (operation() ? `${operation()}…` : notice())}
          </div>
        </Show>

        <Show when={activeTab() === "status"}>
          <div class="git-body">
            <div class="git-files">
              <div style={{ flex: "1", overflow: "auto", "min-height": "0" }}>
                <Show when={loading() && !status()}><div class="muted" style={{ padding: "14px" }}>Loading repository…</div></Show>
                <Show when={status()}>
                  {fileGroup("Staged", status()!.staged, true)}
                  {fileGroup("Changes", status()!.unstaged, false)}
                  {fileGroup("Untracked", status()!.untracked, false)}
                  <Show when={allFiles().length === 0}><div class="muted" style={{ padding: "18px" }}>Working tree clean.</div></Show>
                </Show>
              </div>
              <div class="git-commit" style={{ "flex-direction": "column" }}>
                <textarea value={commitMessage()} onInput={(event) => setCommitMessage(event.currentTarget.value)} placeholder="Commit message…" />
                <input style={{ width: "100%", padding: "6px 8px", background: "var(--bg-1)", color: "var(--fg-0)", border: "1px solid var(--border-strong)", "border-radius": "5px" }} value={stashMessage()} onInput={(event) => setStashMessage(event.currentTarget.value)} placeholder="Optional stash message…" />
                <div class="commit-actions" style={{ width: "100%", "flex-direction": "row" }}>
                  <button disabled={!commitMessage().trim() || !status()?.staged.length || Boolean(operation())} onClick={() => void commit()}>{operation() === "Commit" ? "Committing…" : "Commit"}</button>
                  <button class="sec" disabled={!allFiles().length || Boolean(operation())} onClick={() => void stashAll()}>{operation() === "Stash" ? "Stashing…" : "Stash all"}</button>
                </div>
              </div>
            </div>
            <div class="git-diff">
              <div class="diff-head">
                <span class="path">{selected()?.file.path ?? "Select a changed file"}</span>
                <Show when={diff()?.truncated}><span style={{ color: "var(--yellow)" }}>truncated</span></Show>
                <Show when={selected() && selected()!.file.kind !== "deleted"}>
                  <button class="btn" style={{ "margin-left": "auto" }} onClick={() => props.onOpenFile?.(absolutePath(status()!.repoRoot, selected()!.file.path))}>Open file</button>
                </Show>
              </div>
              <div class="diff-body" style={{ overflow: "auto" }}>
                <Show when={diffLoading()}><div class="muted" style={{ padding: "18px" }}>Loading diff…</div></Show>
                <Show when={!diffLoading() && diff()?.binary}><div class="muted" style={{ padding: "18px" }}>Binary file — no text diff available.</div></Show>
                <Show when={!diffLoading() && diff() && !diff()!.binary && !diff()!.patch}><div class="muted" style={{ padding: "18px" }}>No textual changes.</div></Show>
                <Show when={!diffLoading() && diff()?.patch}>
                  <For each={patchLines()}>
                    {(line) => line.startsWith("@@") ? (
                      <div class="hunk-header">{line}</div>
                    ) : (
                      <div class={`diff-line ${line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : "ctx"}`}>
                        <span class="sign">{line[0] === "+" || line[0] === "-" ? line[0] : " "}</span>
                        <span class="text" style={{ overflow: "visible" }}>{line[0] === "+" || line[0] === "-" ? line.slice(1) : line}</span>
                      </div>
                    )}
                  </For>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        <Show when={activeTab() === "log"}>
          <div style={{ overflow: "auto", padding: "10px 14px", flex: "1" }}>
            <Show when={loading()}><div class="muted">Loading history…</div></Show>
            <For each={logs()}>{(entry) => (
              <div style={{ display: "grid", "grid-template-columns": "90px 1fr auto", gap: "12px", padding: "9px 4px", "border-bottom": "1px solid var(--border)", "font-size": "var(--ui-font-12)" }}>
                <code style={{ color: "var(--purple)" }}>{entry.shortId}</code>
                <div><div style={{ color: "var(--fg-0)" }}>{entry.summary || "(no subject)"}</div><small style={{ color: "var(--fg-3)" }}>{entry.authorName} · {entry.authorEmail}</small></div>
                <time style={{ color: "var(--fg-3)" }}>{new Date(entry.timestamp * 1000).toLocaleString()}</time>
              </div>
            )}</For>
            <Show when={!loading() && logs().length === 0}><div class="muted">No commits yet.</div></Show>
          </div>
        </Show>

        <Show when={activeTab() === "branches"}>
          <div style={{ overflow: "auto", padding: "10px 14px", flex: "1" }}>
            <Show when={loading()}><div class="muted">Loading branches…</div></Show>
            <For each={branches()}>{(branch) => (
              <div style={{ display: "flex", "align-items": "center", gap: "12px", padding: "8px 4px", "border-bottom": "1px solid var(--border)", "font-size": "var(--ui-font-12)" }}>
                <Icon name="branch" /><code style={{ color: branch.current ? "var(--green)" : "var(--fg-0)" }}>{branch.name}</code>
                <span style={{ color: "var(--fg-3)" }}>{branch.kind}{branch.upstream ? ` · ${branch.upstream}` : ""}</span>
                <button class="btn" style={{ "margin-left": "auto" }} disabled={branch.current || branch.kind !== "local" || Boolean(operation())} onClick={() => void mutate("Checkout", (root) => gitCheckoutBranch(root, branch.name), true)}>{branch.current ? "Current" : "Checkout"}</button>
              </div>
            )}</For>
          </div>
        </Show>
      </div>
      <Show when={setupOpen() && props.workspaceRoot}>
        <GitSetupDialog
          workspaceRoot={props.workspaceRoot!}
          onClose={closeSetup}
          onSaved={handleIdentitySaved}
        />
      </Show>
    </>
  );
}
