import { Match, Switch } from "solid-js";
import type { PageKey } from "../chrome/PageSwitcher";
import type { TitleBarAction } from "../chrome/TitleBarActions";
import type { FileLinkTarget } from "../MarkdownText";
import { CommandPalette } from "./CommandPalette";
import { GitPanel } from "./GitPanel";
import { Minimap } from "./Minimap";
import { SearchReplace } from "./SearchReplace";
import { SettingsPanel } from "./SettingsPanel";

export type WorkspaceOverlay = Exclude<TitleBarAction, "sidebar"> | null;
export type EditorCommand = "chooseFolder" | "newTab";

export interface WorkspaceOverlaysProps {
  active: WorkspaceOverlay;
  activePage: PageKey;
  paletteMode: "files" | "commands";
  projectRoot: string | null;
  sidebarOpen: boolean;
  onClose: () => void;
  onEditorCommand: (command: EditorCommand) => void;
  onOpenFile: (path: string) => void;
  onOpenFileAt: (target: FileLinkTarget) => void;
  onOpenOverlay: (overlay: Exclude<WorkspaceOverlay, null>) => void;
  onNavigatePage: (page: PageKey) => void;
  onRefreshEditor: () => void | Promise<void>;
  onToggleSidebar: () => void;
}

export function WorkspaceOverlays(props: WorkspaceOverlaysProps) {
  const sidebarCommandLabel = () => {
    if (props.activePage !== "editor") return "Open Explorer";
    return props.sidebarOpen ? "Hide Explorer" : "Show Explorer";
  };

  return (
    <Switch>
      <Match when={props.active === "palette"}>
        <CommandPalette
          onClose={props.onClose}
          onOpenFile={props.onOpenFile}
          workspaceRoot={props.projectRoot}
          mode={props.paletteMode}
          commands={[
            {
              id: "file.new",
              label: "New File",
              detail: "Create an untitled editor buffer",
              shortcut: "⌘T",
              icon: "plus",
              run: () => props.onEditorCommand("newTab"),
            },
            {
              id: "project.open",
              label: "Open Folder…",
              detail: "Switch to another project",
              shortcut: "⌘O",
              icon: "folder",
              run: () => props.onEditorCommand("chooseFolder"),
            },
            {
              id: "search.project",
              label: "Find in Project",
              detail: "Search and replace across the active project",
              shortcut: "⌘⇧F",
              icon: "search",
              run: () => props.onOpenOverlay("search"),
            },
            {
              id: "git.open",
              label: "Open Source Control",
              detail: "Review, stage, and commit changes",
              icon: "git",
              run: () => props.onOpenOverlay("git"),
            },
            {
              id: "view.sidebar",
              label: sidebarCommandLabel(),
              shortcut: "⌘B",
              icon: "file",
              run: props.onToggleSidebar,
            },
            {
              id: "view.agents",
              label: "Open Agents",
              detail: "Work with Codex on this project",
              icon: "bolt",
              run: () => props.onNavigatePage("agents"),
            },
            {
              id: "view.pipelines",
              label: "Open Pipelines",
              detail: "Design and run multi-agent workflows",
              icon: "branch",
              run: () => props.onNavigatePage("pipelines"),
            },
            {
              id: "settings.open",
              label: "Open Settings",
              shortcut: "⌘,",
              icon: "settings",
              run: () => props.onOpenOverlay("settings"),
            },
          ]}
        />
      </Match>
      <Match when={props.active === "minimap"}>
        <Minimap onClose={props.onClose} onOpenFile={props.onOpenFile} />
      </Match>
      <Match when={props.active === "search"}>
        <SearchReplace
          workspaceRoot={props.projectRoot}
          onSelectResult={props.onOpenFileAt}
          onReplaced={props.onRefreshEditor}
          onClose={props.onClose}
        />
      </Match>
      <Match when={props.active === "git"}>
        <GitPanel
          onClose={props.onClose}
          workspaceRoot={props.projectRoot}
          onOpenFile={props.onOpenFile}
          onRepositoryChanged={props.onRefreshEditor}
        />
      </Match>
      <Match when={props.active === "settings"}>
        <SettingsPanel onClose={props.onClose} />
      </Match>
    </Switch>
  );
}
