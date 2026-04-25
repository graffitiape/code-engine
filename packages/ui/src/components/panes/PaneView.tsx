import { Component, createEffect, onMount, onCleanup, createSignal } from "solid-js";
import { GridRenderer } from "../../renderer/GridRenderer";
import { useSettingsStore } from "../../stores/settings";
import { nvimResize } from "../../bridge/tauri";
import { onPaneFlush } from "../../bridge/channel";
import type { GridSnapshot } from "../../bridge/types";

interface PaneViewProps {
  paneId: string;
  isActive: boolean;
  onFocus: () => void;
}

const PaneView: Component<PaneViewProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let canvasRef: HTMLCanvasElement | undefined;
  let renderer: GridRenderer | undefined;

  const settings = useSettingsStore();

  const [gridSize, setGridSize] = createSignal({ cols: 80, rows: 24 });
  const [lastGrid, setLastGrid] = createSignal<GridSnapshot | null>(null);

  onMount(() => {
    if (!canvasRef || !containerRef) return;

    renderer = new GridRenderer(
      canvasRef,
      settings.font_family,
      settings.font_size,
    );

    // Initial resize
    handleResize();

    // Watch for container resize
    const observer = new ResizeObserver(() => handleResize());
    observer.observe(containerRef);

    // Listen for flush events directly on this pane's channel
    onPaneFlush(props.paneId, (event) => {
      const gridKeys = Object.keys(event.grids);

      // Push every flush's resolved hl table + defaults into the renderer
      // before rendering — defaults arrive before any grid_resize and
      // hl_attr_define payloads stream in on every flush.
      if (renderer) {
        renderer.setDefaults(event.default_fg, event.default_bg);
        renderer.clearHlAttrs();
        for (const [idStr, attr] of Object.entries(event.hl_attrs)) {
          renderer.setHlAttrFromResolved(Number(idStr), attr);
        }
      }

      // Find the main grid — try "1" first, then first available key
      const mainGrid = event.grids["1"] || event.grids[gridKeys[0]];
      if (mainGrid) {
        setLastGrid(mainGrid);
      }
    });

    onCleanup(() => observer.disconnect());
  });

  // Render whenever grid data changes (signal-based, not store-based)
  createEffect(() => {
    const grid = lastGrid();
    if (!grid || !renderer) return;
    renderer.render(grid);
  });

  function handleResize() {
    if (!renderer || !containerRef) return;

    const rect = containerRef.getBoundingClientRect();
    const { cols, rows } = renderer.resize(rect.width, rect.height);

    if (cols > 0 && rows > 0) {
      const prev = gridSize();
      if (cols !== prev.cols || rows !== prev.rows) {
        setGridSize({ cols, rows });
        nvimResize(props.paneId, cols, rows).catch(console.error);
      }
    }

    // Re-render current grid at new size
    const grid = lastGrid();
    if (grid) {
      renderer.render(grid);
    }
  }

  return (
    <div
      ref={containerRef}
      class="pane-view"
      classList={{ "pane-active": props.isActive }}
      onClick={props.onFocus}
      style={{
        width: "100%",
        height: "100%",
        overflow: "hidden",
        position: "relative",
        border: props.isActive
          ? "1px solid var(--ce-accent)"
          : "1px solid var(--ce-border)",
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
        }}
      />
    </div>
  );
};

export default PaneView;
