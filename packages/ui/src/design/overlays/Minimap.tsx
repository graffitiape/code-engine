import { For, Show, createMemo, createSignal, createEffect } from "solid-js";
import { Icon, FileIcon } from "../Icon";
import {
  activeBufferPath,
  getBuffer,
  listBufferPaths,
  useBuffersVersion,
} from "../../stores/buffers";

export interface MinimapProps {
  onClose: () => void;
  onOpenFile?: (path: string) => void;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function extension(path: string): string {
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : "file";
}

function lineClass(line: string): string {
  const trimmed = line.trim();
  if (!trimmed) return "dim";
  if (/^(\/\/|#|\/\*|\*)/.test(trimmed)) return "comment";
  if (/^(import|export|const|let|fn|pub|class|interface|type|function)\b/.test(trimmed)) {
    return "keyword";
  }
  if (/[{}()[\]]/.test(trimmed)) return "punct";
  return "text";
}

export function Minimap(props: MinimapProps) {
  const buffersVersion = useBuffersVersion();
  const [selectedPath, setSelectedPath] = createSignal(activeBufferPath());

  const paths = createMemo(() => {
    void buffersVersion();
    return listBufferPaths();
  });

  createEffect(() => {
    const available = paths();
    const active = activeBufferPath();
    if (active && available.includes(active)) setSelectedPath(active);
    else if (!selectedPath() || !available.includes(selectedPath()!)) {
      setSelectedPath(available[0] ?? null);
    }
  });

  const selectedBuffer = createMemo(() => {
    void buffersVersion();
    return getBuffer(selectedPath());
  });

  const lines = createMemo(() => {
    const source = selectedBuffer()?.content.split("\n") ?? [];
    const max = Math.max(1, ...source.map((line) => line.trimEnd().length));
    return source.slice(0, 300).map((line) => ({
      cls: lineClass(line),
      width: Math.max(3, Math.min(100, (line.trimEnd().length / max) * 100)),
    }));
  });

  const select = (path: string) => {
    setSelectedPath(path);
    props.onOpenFile?.(path);
  };

  return (
    <>
      <div class="scrim" onClick={props.onClose} />
      <div class="overlay minimap">
        <div class="minimap-header">
          <div>
            <h3>Buffer Overview</h3>
            <div class="subtitle">
              <Show when={selectedBuffer()} fallback="No open buffers">
                {(buffer) =>
                  `${basename(buffer().path)} · ${buffer().content.split("\n").length} lines · ${extension(buffer().path)}`
                }
              </Show>
            </div>
          </div>
          <button class="icon-btn" onClick={props.onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div class="minimap-body">
          <div class="minimap-buffers">
            <For
              each={paths()}
              fallback={<div class="minimap-empty">Open a file to see it here.</div>}
            >
              {(path) => {
                const buffer = () => getBuffer(path);
                return (
                  <button
                    type="button"
                    class={`minimap-buf ${path === selectedPath() ? "active" : ""}`}
                    title={path}
                    onClick={() => select(path)}
                  >
                    <FileIcon type={extension(path)} />
                    <span class="minimap-buffer-name">{basename(path)}</span>
                    <span class="lines">{buffer()?.content.split("\n").length ?? 0}L</span>
                  </button>
                );
              }}
            </For>
          </div>
          <div class="minimap-canvas">
            <Show
              when={lines().length}
              fallback={<div class="minimap-empty">Nothing to preview.</div>}
            >
              <div class="minimap-lines">
                <For each={lines()}>
                  {(line) => (
                    <div class={`minimap-line ${line.cls}`} style={{ width: `${line.width}%` }} />
                  )}
                </For>
              </div>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}
