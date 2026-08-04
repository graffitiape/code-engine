import { For, Show, createSignal, onCleanup, onMount } from "solid-js";
import { Icon } from "../Icon";
import {
  chooseFolder,
  removeRecentProject,
  setActiveRoot,
  useWorkspace,
} from "../../stores/workspace";
import {
  getDirtyBufferPaths,
} from "../../stores/buffers";

function compactPath(path: string): string {
  const match = path.match(/^(\/Users\/[^/]+)(\/.*)?$/);
  return match ? `~${match[2] ?? ""}` : path;
}

export function ProjectSwitcher() {
  const workspace = useWorkspace();
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [localError, setLocalError] = createSignal<string | null>(null);
  let rootRef: HTMLDivElement | undefined;

  const activeProject = () =>
    workspace.projects().find((project) => project.path === workspace.activeRoot());

  const mayDiscardDirtyBuffers = (): boolean => {
    const dirty = getDirtyBufferPaths();
    if (!dirty.length) return true;
    const names = dirty
      .slice(0, 3)
      .map((path) => path.split(/[\\/]/).pop() ?? path)
      .join(", ");
    const remainder = dirty.length > 3 ? ` and ${dirty.length - 3} more` : "";
    return window.confirm(
      `Switch projects and discard unsaved changes in ${names}${remainder}?`,
    );
  };

  const activate = async (path: string) => {
    if (path === workspace.activeRoot()) {
      setOpen(false);
      return;
    }
    if (!mayDiscardDirtyBuffers()) return;

    setBusy(true);
    setLocalError(null);
    try {
      await setActiveRoot(path);
      setOpen(false);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const chooseProject = async () => {
    setLocalError(null);
    try {
      const path = await chooseFolder();
      if (path) await activate(path);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  };

  onMount(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef && !rootRef.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    onCleanup(() => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    });
  });

  return (
    <div class="project-switcher" ref={rootRef}>
      <button
        type="button"
        class={`project-badge ${open() ? "open" : ""}`}
        title={workspace.activeRoot() ?? "Open a project"}
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen((value) => !value)}
      >
        <span class="logo" aria-hidden="true">
          <svg viewBox="0 0 10 10" fill="none">
            <path d="M2 3l3-2 3 2v4L5 9 2 7V3z" stroke="white" stroke-width="0.8" />
            <circle cx="5" cy="5" r="1" fill="white" />
          </svg>
        </span>
        <span class="name">{activeProject()?.name ?? "Open project"}</span>
        <Icon
          name="chevronDown"
          style={{
            width: "10px",
            height: "10px",
            color: "var(--fg-3)",
            transform: open() ? "rotate(180deg)" : "none",
          }}
        />
      </button>

      <Show when={open()}>
        <div class="project-menu" role="menu">
          <div class="project-menu-head">
            <span>Projects</span>
            <Show when={busy() || workspace.switching()}>
              <span class="project-menu-busy">Opening…</span>
            </Show>
          </div>

          <div class="project-menu-list">
            <For
              each={workspace.projects()}
              fallback={<div class="project-menu-empty">No recent projects</div>}
            >
              {(project) => {
                const isActive = () => project.path === workspace.activeRoot();
                return (
                  <div class={`project-option ${isActive() ? "active" : ""}`}>
                    <button
                      type="button"
                      class="project-option-main"
                      role="menuitem"
                      disabled={busy()}
                      onClick={() => void activate(project.path)}
                    >
                      <span class="project-option-mark">{isActive() ? "●" : "○"}</span>
                      <span class="project-option-copy">
                        <strong>{project.name}</strong>
                        <small>{compactPath(project.path)}</small>
                      </span>
                    </button>
                    <Show when={!isActive()}>
                      <button
                        type="button"
                        class="project-option-remove"
                        title="Remove from recent projects"
                        aria-label={`Remove ${project.name} from recent projects`}
                        onClick={() => removeRecentProject(project.path)}
                      >
                        <Icon name="close" style={{ width: "10px", height: "10px" }} />
                      </button>
                    </Show>
                  </div>
                );
              }}
            </For>
          </div>

          <Show when={localError() ?? workspace.error()}>
            {(message) => <div class="project-menu-error">{message()}</div>}
          </Show>

          <button
            type="button"
            class="project-menu-open"
            role="menuitem"
            disabled={busy()}
            onClick={() => void chooseProject()}
          >
            <Icon name="folder" style={{ width: "13px", height: "13px" }} />
            Open Folder…
            <span class="kbd">⌘O</span>
          </button>
        </div>
      </Show>
    </div>
  );
}
