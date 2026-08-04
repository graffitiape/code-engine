import { For, Show, createMemo, createResource, createSignal, onMount } from "solid-js";
import type { JSX } from "solid-js";
import { Icon, FileIcon } from "../Icon";
import { listWorkspaceFiles } from "../../bridge/tauri";

export interface PaletteCommand {
  id: string;
  label: string;
  detail?: string;
  shortcut?: string;
  icon?: string;
  run: () => void | Promise<void>;
}

export interface CommandPaletteProps {
  onClose: () => void;
  onOpenFile: (path: string) => void;
  workspaceRoot: string | null;
  mode?: "files" | "commands";
  commands?: PaletteCommand[];
}

interface PaletteRow {
  kind: "file" | "command";
  primary: string;
  secondary: string;
  path?: string;
  icon: string;
  shortcut?: string;
  command?: PaletteCommand;
}

function extension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : "file";
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index >= 0 ? path.slice(index + 1) : path;
}

function score(text: string, query: string): number | null {
  if (!query) return 0;
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const contiguous = haystack.indexOf(needle);
  if (contiguous >= 0) return contiguous;

  let cursor = 0;
  let total = 0;
  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found < 0) return null;
    total += found - cursor;
    cursor = found + 1;
  }
  return total + 20;
}

export function CommandPalette(props: CommandPaletteProps) {
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;

  const [files] = createResource(
    () => props.workspaceRoot,
    async (root) => {
      if (!root) return [] as string[];
      try {
        return await listWorkspaceFiles(root, 20_000);
      } catch {
        return [] as string[];
      }
    },
  );

  onMount(() => inputRef?.focus());

  const rows = createMemo<PaletteRow[]>(() => {
    const queryText = query().trim();
    if (props.mode === "commands") {
      return (props.commands ?? [])
        .map((command) => ({
          command,
          value: score(`${command.label} ${command.detail ?? ""}`, queryText),
        }))
        .filter((entry) => entry.value !== null)
        .sort((left, right) => left.value! - right.value!)
        .map(({ command }) => ({
          kind: "command" as const,
          primary: command.label,
          secondary: command.detail ?? "",
          icon: command.icon ?? "command",
          shortcut: command.shortcut,
          command,
        }));
    }

    const rootLength = (props.workspaceRoot?.length ?? 0) + 1;
    return (files() ?? [])
      .map((path) => {
        const relative = path.slice(rootLength);
        return { path, relative, value: score(relative, queryText) };
      })
      .filter((entry) => entry.value !== null)
      .sort((left, right) => left.value! - right.value!)
      .slice(0, queryText ? 200 : 100)
      .map(({ path, relative }) => {
        const name = basename(relative);
        return {
          kind: "file" as const,
          primary: name,
          secondary: relative,
          path,
          icon: extension(name),
        };
      });
  });

  const execute = async (row: PaletteRow | undefined) => {
    if (!row) return;
    props.onClose();
    if (row.kind === "file" && row.path) props.onOpenFile(row.path);
    else if (row.command) await row.command.run();
  };

  const handleKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => Math.min(rows().length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void execute(rows()[activeIndex()]);
    } else if (event.key === "Escape") {
      props.onClose();
    }
  };

  const highlight = (text: string): JSX.Element => {
    const needle = query().trim();
    if (!needle) return text;
    const index = text.toLowerCase().indexOf(needle.toLowerCase());
    if (index < 0) return text;
    return (
      <>
        {text.slice(0, index)}
        <span class="hl">{text.slice(index, index + needle.length)}</span>
        {text.slice(index + needle.length)}
      </>
    );
  };

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay palette" onKeyDown={handleKey}>
        <div class="search">
          <span class="icon"><Icon name={props.mode === "commands" ? "command" : "search"} /></span>
          <input
            ref={inputRef}
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            placeholder={
              props.mode === "commands"
                ? "Type a command…"
                : props.workspaceRoot
                  ? "Search files in workspace…"
                  : "Open a folder first (⌘O)"
            }
          />
          <kbd>{props.mode === "commands" ? "⌘⇧P" : "⌘P"}</kbd>
        </div>
        <div class="list">
          <Show when={props.mode !== "commands" && files.loading}>
            <div class="section-label">Indexing workspace…</div>
          </Show>
          <Show when={!rows().length && !files.loading}>
            <div class="section-label">No results</div>
          </Show>
          <For each={rows()}>
            {(row, index) => (
              <div
                class={`row ${index() === activeIndex() ? "active" : ""}`}
                onMouseEnter={() => setActiveIndex(index())}
                onClick={() => void execute(row)}
              >
                <span class="icon">
                  <Show when={row.kind === "file"} fallback={<Icon name={row.icon} />}>
                    <FileIcon type={row.icon} />
                  </Show>
                </span>
                <div class="palette-row-copy">
                  <span class="primary">{highlight(row.primary)}</span>
                  <Show when={row.secondary}>
                    <span class="secondary">{highlight(row.secondary)}</span>
                  </Show>
                </div>
                <Show when={row.shortcut}><kbd>{row.shortcut}</kbd></Show>
              </div>
            )}
          </For>
        </div>
        <div class="footer">
          <div class="hints">
            <span class="hint-item"><kbd>↑↓</kbd> navigate</span>
            <span class="hint-item"><kbd>↵</kbd> run</span>
            <span class="hint-item"><kbd>esc</kbd> close</span>
          </div>
          <span>{rows().length} {props.mode === "commands" ? "commands" : "matches"}</span>
        </div>
      </div>
    </>
  );
}
