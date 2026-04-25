import { Component } from "solid-js";
import PaneView from "./PaneView";

interface PaneContainerProps {
  paneId: string;
  activePaneId: string;
  onPaneFocus: (paneId: string) => void;
}

/**
 * Container for pane layout. Currently renders a single pane.
 * Will be extended in Phase 2 to support binary split tree layout.
 */
const PaneContainer: Component<PaneContainerProps> = (props) => {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        overflow: "hidden",
      }}
    >
      <PaneView
        paneId={props.paneId}
        isActive={props.paneId === props.activePaneId}
        onFocus={() => props.onPaneFocus(props.paneId)}
      />
    </div>
  );
};

export default PaneContainer;
