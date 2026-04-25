import { Component, Show } from "solid-js";
import { useActivePane } from "../../stores/nvim";

/** Breadcrumb navigation — basic version showing buffer title */
const Breadcrumbs: Component = () => {
  const activePane = useActivePane();

  return (
    <div
      style={{
        height: "24px",
        "min-height": "24px",
        display: "flex",
        "align-items": "center",
        padding: "0 12px",
        background: "var(--ce-bg)",
        "border-bottom": "1px solid var(--ce-border)",
        "font-size": "12px",
        opacity: 0.7,
      }}
    >
      <Show when={activePane()?.title} fallback="[No Name]">
        {(title) => <span>{title()}</span>}
      </Show>
    </div>
  );
};

export default Breadcrumbs;
