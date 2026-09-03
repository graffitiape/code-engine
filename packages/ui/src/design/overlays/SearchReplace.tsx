import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  type JSX,
} from "solid-js";
import {
  replaceAllWorkspace,
  searchWorkspace,
  type ReplaceRequest,
  type ReplaceResult,
  type SearchMatch,
  type SearchRequest,
  type SearchResult,
} from "../../bridge/tauri";
import { FileIcon, Icon } from "../Icon";

const SEARCH_DEBOUNCE_MS = 250;

export interface SearchResultLocation {
  path: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
}

export interface SearchReplaceProps {
  workspaceRoot: string | null;
  onSelectResult: (location: SearchResultLocation) => void | Promise<void>;
  onReplaced?: (summary: ReplaceResult) => void | Promise<void>;
  onClose: () => void;
}

interface IndexedMatch {
  index: number;
  match: SearchMatch;
}

interface MatchGroup {
  path: string;
  matches: IndexedMatch[];
}

function messageFromError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Search failed";
  }
}

function fileType(path: string): string {
  const name = path.split(/[\\/]/).pop() ?? path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "file";
}

function plural(count: number, singular: string): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : `${singular}s`}`;
}

function highlightedPreview(match: SearchMatch): JSX.Element {
  const exactIndex = match.preview.indexOf(match.matchedText);
  const index =
    exactIndex >= 0
      ? exactIndex
      : match.preview.toLocaleLowerCase().indexOf(match.matchedText.toLocaleLowerCase());

  if (index < 0 || !match.matchedText) return match.preview;
  return (
    <>
      {match.preview.slice(0, index)}
      <span class="hl">{match.preview.slice(index, index + match.matchedText.length)}</span>
      {match.preview.slice(index + match.matchedText.length)}
    </>
  );
}

export function SearchReplace(props: SearchReplaceProps) {
  const [query, setQuery] = createSignal("");
  const [replacement, setReplacement] = createSignal("");
  const [showReplace, setShowReplace] = createSignal(false);
  const [caseSensitive, setCaseSensitive] = createSignal(false);
  const [wholeWord, setWholeWord] = createSignal(false);
  const [regex, setRegex] = createSignal(false);
  const [result, setResult] = createSignal<SearchResult | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [replacing, setReplacing] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [replaceNotice, setReplaceNotice] = createSignal<string | null>(null);
  const [confirmReplace, setConfirmReplace] = createSignal(false);
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [durationMs, setDurationMs] = createSignal<number | null>(null);
  let requestGeneration = 0;
  let panelRef: HTMLDivElement | undefined;
  let searchInputRef: HTMLInputElement | undefined;

  const request = (): SearchRequest => ({
    query: query(),
    regex: regex(),
    caseSensitive: caseSensitive(),
    wholeWord: wholeWord(),
  });

  const groups = createMemo<MatchGroup[]>(() => {
    const grouped = new Map<string, IndexedMatch[]>();
    for (const [index, match] of (result()?.matches ?? []).entries()) {
      const matches = grouped.get(match.relativePath) ?? [];
      matches.push({ index, match });
      grouped.set(match.relativePath, matches);
    }
    return Array.from(grouped, ([path, matches]) => ({ path, matches }));
  });

  const matchCount = () => result()?.matches.length ?? 0;
  const skippedCount = () => {
    const current = result();
    return current
      ? current.skippedBinaryFiles +
          current.skippedOversizedFiles +
          current.skippedUnreadableFiles
      : 0;
  };

  async function performSearch(
    root: string,
    searchRequest: SearchRequest,
    generation: number,
  ): Promise<void> {
    const startedAt = performance.now();
    try {
      const next = await searchWorkspace(root, searchRequest);
      if (generation !== requestGeneration) return;
      setResult(next);
      setActiveIndex((index) => Math.min(index, Math.max(0, next.matches.length - 1)));
      setDurationMs(Math.round(performance.now() - startedAt));
      setError(null);
    } catch (searchError) {
      if (generation !== requestGeneration) return;
      setResult(null);
      setDurationMs(null);
      setError(messageFromError(searchError));
    } finally {
      if (generation === requestGeneration) setLoading(false);
    }
  }

  createEffect(() => {
    const root = props.workspaceRoot;
    const nextRequest = request();
    const generation = ++requestGeneration;
    setResult(null);
    setActiveIndex(0);
    setConfirmReplace(false);
    setReplaceNotice(null);
    setDurationMs(null);
    setError(null);

    if (!root || nextRequest.query.length === 0) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = window.setTimeout(() => {
      void performSearch(root, nextRequest, generation);
    }, SEARCH_DEBOUNCE_MS);
    onCleanup(() => window.clearTimeout(timer));
  });

  onMount(() => {
    searchInputRef?.focus();
    const handleGlobalSearchKey = (event: KeyboardEvent) => {
      if (event.key !== "F3") return;
      event.preventDefault();
      event.stopPropagation();
      moveActive(event.shiftKey ? -1 : 1, true);
    };
    window.addEventListener("keydown", handleGlobalSearchKey, true);
    onCleanup(() => window.removeEventListener("keydown", handleGlobalSearchKey, true));
  });
  onCleanup(() => {
    requestGeneration += 1;
  });

  function scrollToActive(index: number): void {
    queueMicrotask(() => {
      panelRef
        ?.querySelector<HTMLElement>(`[data-search-index="${index}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  }

  function moveActive(delta: number, navigate = false): void {
    const count = matchCount();
    if (!count) return;
    const next = (activeIndex() + delta + count) % count;
    setActiveIndex(next);
    scrollToActive(next);
    if (navigate) {
      const match = result()?.matches[next];
      if (match) void selectResult(match);
    }
  }

  async function selectResult(match: SearchMatch): Promise<void> {
    try {
      await props.onSelectResult({
        path: match.path,
        line: match.line,
        column: match.column,
        endLine: match.endLine,
        endColumn: match.endColumn,
      });
    } catch (selectionError) {
      setError(messageFromError(selectionError));
    }
  }

  async function replaceEveryMatch(): Promise<void> {
    const root = props.workspaceRoot;
    if (!root || !matchCount() || replacing()) return;

    const replaceRequest: ReplaceRequest = {
      search: request(),
      replacement: replacement(),
      confirmed: true,
    };
    setConfirmReplace(false);
    setReplacing(true);
    setError(null);
    setReplaceNotice(null);

    try {
      const summary = await replaceAllWorkspace(root, replaceRequest);
      if (props.workspaceRoot !== root) return;
      setReplaceNotice(
        `Replaced ${plural(summary.replacements, "match")} in ${plural(summary.filesChanged, "file")}.`,
      );
      const generation = ++requestGeneration;
      setLoading(true);
      const [, refreshResult] = await Promise.allSettled([
        performSearch(root, replaceRequest.search, generation),
        Promise.resolve().then(() => props.onReplaced?.(summary)),
      ]);
      if (refreshResult.status === "rejected") {
        setError(
          `Replacement completed, but refreshing open files failed: ${messageFromError(refreshResult.reason)}`,
        );
      }
    } catch (replaceError) {
      if (props.workspaceRoot === root) setError(messageFromError(replaceError));
    } finally {
      setReplacing(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (confirmReplace()) setConfirmReplace(false);
      else props.onClose();
      return;
    }
    const target = event.target;
    const resultHasFocus = target instanceof Element && target.closest(".match");
    if (target !== searchInputRef && !resultHasFocus) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveActive(event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter") {
      const match = result()?.matches[activeIndex()];
      if (match) {
        event.preventDefault();
        void selectResult(match);
      }
    }
  }

  const canReplace = () =>
    Boolean(props.workspaceRoot && query().length && matchCount()) &&
    !loading() &&
    !replacing() &&
    !error();

  return (
    <>
      <div class="scrim" onClick={() => !replacing() && props.onClose()} />
      <div
        ref={panelRef}
        class="overlay search-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search and replace in project"
        onKeyDown={handleKeyDown}
      >
        <div class="sp-body">
          <SearchHeader
            showReplace={showReplace()}
            loading={loading() || replacing()}
            count={matchCount()}
            fileCount={groups().length}
            truncated={result()?.truncated ?? false}
            onToggleReplace={() => {
              setShowReplace((visible) => !visible);
              setConfirmReplace(false);
            }}
            onClose={props.onClose}
          />

          <div class="field">
            <span class="icon"><Icon name="search" /></span>
            <input
              ref={searchInputRef}
              value={query()}
              onInput={(event) => setQuery(event.currentTarget.value)}
              placeholder={props.workspaceRoot ? "Find in project…" : "Open a project to search"}
              aria-label="Search query"
              aria-controls="project-search-results"
              aria-activedescendant={matchCount() ? `project-search-result-${activeIndex()}` : undefined}
              disabled={replacing() || !props.workspaceRoot}
              spellcheck={false}
            />
            <div class="toggles" aria-label="Search options">
              <OptionToggle
                label="Match case"
                text="Aa"
                active={caseSensitive()}
                disabled={replacing()}
                onToggle={() => setCaseSensitive((value) => !value)}
              />
              <OptionToggle
                label="Match whole word"
                text="ab"
                active={wholeWord()}
                disabled={replacing()}
                onToggle={() => setWholeWord((value) => !value)}
              />
              <OptionToggle
                label="Use regular expression"
                text=".*"
                active={regex()}
                disabled={replacing()}
                onToggle={() => setRegex((value) => !value)}
              />
            </div>
          </div>

          <Show when={showReplace()}>
            <div class="field">
              <span class="icon"><Icon name="replace" /></span>
              <input
                value={replacement()}
                onInput={(event) => {
                  setReplacement(event.currentTarget.value);
                  setConfirmReplace(false);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && canReplace()) {
                    event.preventDefault();
                    setConfirmReplace(true);
                  }
                }}
                placeholder="Replace with…"
                aria-label="Replacement text"
                disabled={replacing()}
                spellcheck={false}
              />
              <button
                type="button"
                class="tog"
                style={{ width: "auto", padding: "0 6px" }}
                disabled={!canReplace()}
                title="Review replace all"
                onClick={() => setConfirmReplace(true)}
              >
                All
              </button>
            </div>
          </Show>

          <Show when={confirmReplace()}>
            <ReplaceConfirmation
              matchCount={matchCount()}
              fileCount={groups().length}
              truncated={result()?.truncated ?? false}
              replacing={replacing()}
              onCancel={() => setConfirmReplace(false)}
              onConfirm={() => void replaceEveryMatch()}
            />
          </Show>

          <SearchResultList
            workspaceRoot={props.workspaceRoot}
            query={query()}
            loading={loading()}
            error={error()}
            result={result()}
            groups={groups()}
            activeIndex={activeIndex()}
            onActivate={(index) => setActiveIndex(index)}
            onSelect={(match) => void selectResult(match)}
          />

          <div
            role="status"
            aria-live="polite"
            style={{
              display: "flex",
              gap: "6px",
              "align-items": "center",
              "justify-content": "space-between",
              "font-size": "var(--ui-font-11)",
              color: error() ? "var(--red)" : "var(--fg-3)",
              "font-family": "var(--font-mono)",
            }}
          >
            <span>
              {replaceNotice() ??
                (error()
                  ? error()
                  : skippedCount()
                    ? `${plural(skippedCount(), "file")} skipped`
                    : durationMs() !== null
                      ? `${result()?.filesScanned.toLocaleString() ?? 0} files · ${durationMs()}ms`
                      : "Ready")}
            </span>
            <span><kbd class="key">F3</kbd> next · <kbd class="key">⇧F3</kbd> prev</span>
          </div>
        </div>
      </div>
    </>
  );
}

function SearchHeader(props: {
  showReplace: boolean;
  loading: boolean;
  count: number;
  fileCount: number;
  truncated: boolean;
  onToggleReplace: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: "8px", "align-items": "center", "margin-bottom": "2px" }}>
      <button
        type="button"
        class="icon-btn"
        onClick={props.onToggleReplace}
        aria-label={props.showReplace ? "Hide replacement input" : "Show replacement input"}
        aria-expanded={props.showReplace}
      >
        <Icon
          name="chevronRight"
          style={{
            transform: props.showReplace ? "rotate(90deg)" : "none",
            transition: "transform .15s",
          }}
        />
      </button>
      <strong style={{ "font-size": "var(--ui-font-12)", color: "var(--fg-0)" }}>Search</strong>
      <span style={{ "margin-left": "auto", color: "var(--fg-3)", "font-size": "var(--ui-font-11)", "font-family": "var(--font-mono)" }}>
        {props.loading
          ? "Searching…"
          : `${props.count.toLocaleString()}${props.truncated ? "+" : ""} matches · ${props.fileCount.toLocaleString()} files`}
      </span>
      <button type="button" class="icon-btn" onClick={props.onClose} aria-label="Close search">
        <Icon name="close" />
      </button>
    </div>
  );
}

function OptionToggle(props: {
  label: string;
  text: string;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      class={`tog ${props.active ? "on" : ""}`}
      title={props.label}
      aria-label={props.label}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={props.onToggle}
    >
      {props.text}
    </button>
  );
}

function ReplaceConfirmation(props: {
  matchCount: number;
  fileCount: number;
  truncated: boolean;
  replacing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-label="Confirm replace all"
      style={{
        padding: "9px 10px",
        border: "1px solid var(--orange)",
        "border-radius": "6px",
        background: "color-mix(in oklab, var(--orange) 8%, var(--bg-1))",
        color: "var(--fg-1)",
        "font-size": "var(--ui-font-11)",
      }}
    >
      <div style={{ "margin-bottom": "8px", "line-height": "1.45" }}>
        Replace {props.truncated ? "all project matches" : plural(props.matchCount, "match")} in {plural(props.fileCount, "file")}?{props.truncated ? ` The ${props.matchCount.toLocaleString()} shown results are truncated.` : ""}
      </div>
      <div style={{ display: "flex", "justify-content": "flex-end", gap: "6px" }}>
        <button
          type="button"
          onClick={props.onCancel}
          disabled={props.replacing}
          style={{ padding: "4px 8px", border: "1px solid var(--border-strong)", "border-radius": "4px" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onConfirm}
          disabled={props.replacing}
          style={{ padding: "4px 8px", background: "var(--orange)", color: "var(--bg-0)", "border-radius": "4px", "font-weight": "600" }}
        >
          {props.replacing ? "Replacing…" : "Replace all"}
        </button>
      </div>
    </div>
  );
}

function SearchResultList(props: {
  workspaceRoot: string | null;
  query: string;
  loading: boolean;
  error: string | null;
  result: SearchResult | null;
  groups: MatchGroup[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onSelect: (match: SearchMatch) => void;
}) {
  const emptyMessage = () => {
    if (!props.workspaceRoot) return "Open a project to search its files.";
    if (!props.query.length) return "Type a query to search the active project.";
    if (props.error) return props.error;
    if (props.loading) return "Searching project…";
    if (props.result && !props.result.matches.length) return "No matches found.";
    return null;
  };

  return (
    <div id="project-search-results" class="results" role="listbox" aria-label="Project search results" aria-busy={props.loading}>
      <Show when={emptyMessage()}>
        {(message) => (
          <div
            class="summary"
            role={props.error ? "alert" : "status"}
            style={{ padding: "18px 12px", color: props.error ? "var(--red)" : "var(--fg-2)" }}
          >
            {message()}
          </div>
        )}
      </Show>
      <For each={props.groups}>
        {(group) => (
          <div class="file-group" role="group" aria-label={group.path}>
            <div class="file-head">
              <Icon name="chevronDown" style={{ width: "10px", height: "10px", color: "var(--fg-3)" }} />
              <FileIcon type={fileType(group.path)} />
              <span title={group.path} style={{ overflow: "hidden", "text-overflow": "ellipsis", "white-space": "nowrap" }}>
                {group.path}
              </span>
              <span class="count">{group.matches.length.toLocaleString()}</span>
            </div>
            <For each={group.matches}>
              {(entry) => (
                <button
                  type="button"
                  id={`project-search-result-${entry.index}`}
                  data-search-index={entry.index}
                  class="match"
                  role="option"
                  aria-selected={entry.index === props.activeIndex}
                  aria-label={`${group.path}, line ${entry.match.line}, column ${entry.match.column}`}
                  title={`${group.path}:${entry.match.line}:${entry.match.column}`}
                  style={{
                    width: "100%",
                    background: entry.index === props.activeIndex ? "var(--bg-3)" : undefined,
                    color: entry.index === props.activeIndex ? "var(--fg-0)" : undefined,
                  }}
                  onMouseEnter={() => props.onActivate(entry.index)}
                  onFocus={() => props.onActivate(entry.index)}
                  onClick={() => props.onSelect(entry.match)}
                >
                  <span class="ln">{entry.match.line}</span>
                  <span class="text">{highlightedPreview(entry.match)}</span>
                </button>
              )}
            </For>
          </div>
        )}
      </For>
    </div>
  );
}
