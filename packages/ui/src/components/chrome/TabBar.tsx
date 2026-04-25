import { Component } from "solid-js";

/** Tmux-style tab bar — Phase 2 implementation */
const TabBar: Component = () => {
  return (
    <div
      style={{
        height: "32px",
        "min-height": "32px",
        display: "flex",
        "align-items": "center",
        "padding": "0 80px 0 12px", /* 80px left padding for macOS traffic lights */
        background: "var(--ce-tab-bg)",
        "border-bottom": "1px solid var(--ce-border)",
        "font-size": "13px",
        "-webkit-app-region": "drag",
      }}
    >
      <div
        style={{
          padding: "4px 12px",
          background: "var(--ce-tab-active)",
          "border-radius": "4px",
          "-webkit-app-region": "no-drag",
          cursor: "pointer",
        }}
      >
        editor
      </div>
    </div>
  );
};

export default TabBar;
