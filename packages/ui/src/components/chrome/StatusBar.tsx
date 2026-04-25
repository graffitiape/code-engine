import { Component, Show } from "solid-js";
import { useActivePane } from "../../stores/nvim";

const StatusBar: Component = () => {
  const activePane = useActivePane();

  return (
    <div
      style={{
        height: "24px",
        "min-height": "24px",
        display: "flex",
        "align-items": "center",
        "padding": "0 12px",
        "background": "var(--ce-status-bg)",
        "border-top": "1px solid var(--ce-border)",
        "font-size": "12px",
        gap: "16px",
      }}
    >
      <Show when={activePane()}>
        {(pane) => (
          <>
            <span
              style={{
                "text-transform": "uppercase",
                "font-weight": "bold",
                color: pane().mode === "insert"
                  ? "var(--ce-git-add)"
                  : pane().mode === "visual"
                    ? "var(--ce-accent)"
                    : "var(--ce-fg)",
              }}
            >
              {pane().mode}
            </span>
            <Show when={pane().title}>
              <span style={{ color: "var(--ce-fg)", opacity: 0.7 }}>
                {pane().title}
              </span>
            </Show>
          </>
        )}
      </Show>
      <span style={{ "margin-left": "auto", opacity: 0.5 }}>
        CodeEngine v0.1.0
      </span>
    </div>
  );
};

export default StatusBar;
