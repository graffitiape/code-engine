import { Icon } from "../Icon";

export type TitleBarAction =
  | "sidebar"
  | "palette"
  | "search"
  | "minimap"
  | "git"
  | "settings";

export interface TitleBarActionsProps {
  activeOverlay: string | null;
  sidebarOpen: boolean;
  onAction: (action: TitleBarAction) => void;
}

export function TitleBarActions(props: TitleBarActionsProps) {
  return (
    <div class="titlebar-right" role="toolbar" aria-label="Workspace actions">
      <button
        type="button"
        class={`icon-btn ${props.sidebarOpen ? "active" : ""}`}
        onClick={() => props.onAction("sidebar")}
        title="Toggle sidebar (⌘B)"
        aria-label="Toggle sidebar"
        aria-pressed={props.sidebarOpen}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
          <path d="M6 2.5v11" />
        </svg>
      </button>
      <button
        type="button"
        class={`icon-btn ${props.activeOverlay === "palette" ? "active" : ""}`}
        onClick={() => props.onAction("palette")}
        title="Command palette (⌘⇧P)"
        aria-label="Open command palette"
        aria-pressed={props.activeOverlay === "palette"}
      >
        <Icon name="command" />
      </button>
      <button
        type="button"
        class={`icon-btn ${props.activeOverlay === "search" ? "active" : ""}`}
        onClick={() => props.onAction("search")}
        title="Search (⌘⇧F)"
        aria-label="Open project search"
        aria-pressed={props.activeOverlay === "search"}
      >
        <Icon name="search" />
      </button>
      <button
        type="button"
        class={`icon-btn ${props.activeOverlay === "minimap" ? "active" : ""}`}
        onClick={() => props.onAction("minimap")}
        title="Minimap (⌘⇧M)"
        aria-label="Open buffer overview"
        aria-pressed={props.activeOverlay === "minimap"}
      >
        <Icon name="minimap" />
      </button>
      <button
        type="button"
        class={`icon-btn ${props.activeOverlay === "git" ? "active" : ""}`}
        onClick={() => props.onAction("git")}
        title="Git panel"
        aria-label="Open Git panel"
        aria-pressed={props.activeOverlay === "git"}
      >
        <Icon name="git" />
      </button>
      <button
        type="button"
        class={`icon-btn ${props.activeOverlay === "settings" ? "active" : ""}`}
        onClick={() => props.onAction("settings")}
        title="Settings (⌘,)"
        aria-label="Open settings"
        aria-pressed={props.activeOverlay === "settings"}
      >
        <Icon name="settings" />
      </button>
    </div>
  );
}
