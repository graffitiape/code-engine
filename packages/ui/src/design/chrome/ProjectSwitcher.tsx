import {
  For,
  Show,
  createSignal,
  createUniqueId,
  onCleanup,
  onMount,
} from "solid-js";
import { Icon } from "../Icon";
import { AppLogo } from "../AppLogo";
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
  const switcherId = createUniqueId();
  let rootRef: HTMLDivElement | undefined;
  let triggerRef: HTMLButtonElement | undefined;
  let choosingFolder = false;

  const triggerId = `${switcherId}-trigger`;
  const panelId = `${switcherId}-panel`;

  const navigationButtons = () =>
    Array.from(
      rootRef?.querySelectorAll<HTMLButtonElement>(
        '[data-project-menu-navigation="true"]:not(:disabled)',
      ) ?? [],
    );

  const restoreFocus = (target?: HTMLButtonElement) => {
    queueMicrotask(() => {
      if (target?.isConnected) target.focus();
      else triggerRef?.focus();
    });
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) restoreFocus();
  };

  const focusNavigationEdge = (edge: "first" | "last") => {
    queueMicrotask(() => {
      const buttons = navigationButtons();
      const target = edge === "first" ? buttons[0] : buttons.at(-1);
      (target ?? triggerRef)?.focus();
    });
  };

  const openMenu = (focusEdge?: "first" | "last") => {
    if (busy() || workspace.switching()) return;
    setOpen(true);
    if (focusEdge) focusNavigationEdge(focusEdge);
  };

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

  const activate = async (path: string, invoker?: HTMLButtonElement) => {
    if (path === workspace.activeRoot()) {
      closeMenu(true);
      return;
    }
    if (!mayDiscardDirtyBuffers()) {
      restoreFocus(invoker);
      return;
    }

    setBusy(true);
    setLocalError(null);
    try {
      if (await setActiveRoot(path)) closeMenu(true);
      else restoreFocus(invoker);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      restoreFocus(invoker);
    } finally {
      setBusy(false);
    }
  };

  const chooseProject = async (invoker: HTMLButtonElement) => {
    setLocalError(null);
    choosingFolder = true;
    try {
      const path = await chooseFolder();
      if (path) await activate(path, invoker);
      else restoreFocus(invoker);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
      restoreFocus(invoker);
    } finally {
      choosingFolder = false;
    }
  };

  const removeProject = (path: string, invoker: HTMLButtonElement) => {
    const row = invoker.closest(".project-option");
    const projectButton = row?.querySelector<HTMLButtonElement>(
      '[data-project-menu-navigation="true"]',
    );
    const currentButtons = navigationButtons();
    const currentIndex = projectButton ? currentButtons.indexOf(projectButton) : 0;

    removeRecentProject(path);

    queueMicrotask(() => {
      const nextButtons = navigationButtons();
      const nextIndex = Math.min(Math.max(currentIndex, 0), nextButtons.length - 1);
      (nextButtons[nextIndex] ?? triggerRef)?.focus();
    });
  };

  const handleTriggerKeyDown = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      openMenu(event.key === "ArrowDown" ? "first" : "last");
      return;
    }
    if (event.key === "Escape" && open()) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
    }
  };

  const handlePanelKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }

    if (
      event.key !== "ArrowDown" &&
      event.key !== "ArrowUp" &&
      event.key !== "Home" &&
      event.key !== "End"
    ) {
      return;
    }

    const target = event.target;
    if (
      !(target instanceof HTMLButtonElement) ||
      target.dataset.projectMenuNavigation !== "true"
    ) {
      return;
    }

    const buttons = navigationButtons();
    const currentIndex = buttons.indexOf(target);
    if (currentIndex < 0) return;

    event.preventDefault();
    let nextIndex: number;
    if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = buttons.length - 1;
    else if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % buttons.length;
    else nextIndex = (currentIndex - 1 + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  };

  const handleFocusOut = () => {
    queueMicrotask(() => {
      if (
        open() &&
        !busy() &&
        !choosingFolder &&
        rootRef &&
        !rootRef.contains(document.activeElement)
      ) {
        setOpen(false);
      }
    });
  };

  onMount(() => {
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (rootRef && !rootRef.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open()) {
        event.preventDefault();
        closeMenu(true);
      }
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    onCleanup(() => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    });
  });

  return (
    <div class="project-switcher" ref={rootRef} onFocusOut={handleFocusOut}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        class={`project-badge ${open() ? "open" : ""}`}
        title={workspace.activeRoot() ?? "Open a project"}
        aria-expanded={open()}
        aria-controls={panelId}
        onClick={() => (open() ? closeMenu() : openMenu())}
        onKeyDown={handleTriggerKeyDown}
      >
        <span class="logo" aria-hidden="true">
          <AppLogo />
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
        <div
          id={panelId}
          class="project-menu"
          role="region"
          aria-label="Project selector"
          aria-busy={busy() || workspace.switching()}
          onKeyDown={handlePanelKeyDown}
        >
          <div class="project-menu-head">
            <span>Projects</span>
            <Show when={busy() || workspace.switching()}>
              <span class="project-menu-busy">Opening…</span>
            </Show>
          </div>

          <div class="project-menu-list" role="list" aria-label="Recent projects">
            <For
              each={workspace.projects()}
              fallback={
                <div class="project-menu-empty" role="listitem">
                  No recent projects
                </div>
              }
            >
              {(project) => {
                const isActive = () => project.path === workspace.activeRoot();
                return (
                  <div
                    class={`project-option ${isActive() ? "active" : ""}`}
                    role="listitem"
                  >
                    <button
                      type="button"
                      class="project-option-main"
                      data-project-menu-navigation="true"
                      aria-current={isActive() ? "true" : undefined}
                      disabled={busy()}
                      onClick={async (event) => {
                        await activate(project.path, event.currentTarget);
                      }}
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
                        disabled={busy()}
                        onClick={(event) => removeProject(project.path, event.currentTarget)}
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
            data-project-menu-navigation="true"
            disabled={busy()}
            onClick={async (event) => {
              await chooseProject(event.currentTarget);
            }}
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
