import { useState } from "react";
import { store } from "../store";
import WorldTerminalPortalList from "../world/WorldTerminalPortalList";
import { WindowFrame } from "../world/windows/WindowFrame";
import type { Pane } from "../types";
import "../world/world-stage.css";
import "../world/world-inspector.css";
import "../world/windows/WorldLayout.css";

/** Exercise the real managed frame and persistent portal, not just TerminalView. */
export function TerminalLinkInspector({
  surface,
  pane,
  fontScale,
}: {
  surface: "town" | "board";
  pane: Pane;
  fontScale: number;
}) {
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  const [raises, setRaises] = useState(0);
  const geometry = {
    left: 0,
    top: 0,
    width: innerWidth - 70,
    height: innerHeight - 90,
  };
  return (
    <>
      <WindowFrame
        id="links-inspector"
        label={`${surface} terminal Inspector`}
        geometry={geometry}
        stage={{ width: innerWidth, height: innerHeight }}
        workArea={geometry}
        active
        compact={navigator.maxTouchPoints > 0}
        zIndex={30}
        className={`world-floating-terminal ${surface === "town" ? "is-town-skin theme-scope-dark" : ""}`}
        onRaise={() => setRaises((value) => value + 1)}
        onTerminalActivate={(paneId) => {
          if (paneId) store.selectPane(paneId);
        }}
        onPlace={() => {}}
        onSnap={() => {}}
        onMaximize={() => {}}
        onPortalChange={setPortal}
      >
        <div className="world-window-header" data-window-drag-handle>
          {surface} Inspector · raised {raises}
        </div>
      </WindowFrame>
      <WorldTerminalPortalList
        presentations={[
          {
            nodeId: "example-node",
            connectionId: "links-test",
            runtimeGeneration: 1,
            workspaceId: pane.workspace_id,
            tabId: pane.tab_id,
            paneId: pane.pane_id,
            terminalId: pane.terminal_id!,
            label: "Example pane",
            hostLabel: "Example host",
            spaceLabel: "Example workspace",
            portal,
            endpointReadiness: true,
          },
        ]}
        panes={[pane]}
        activeConnectionId="links-test"
        connectionGeneration={1}
        runtimeGeneration={1}
        terminalTheme={{ background: "#171922", foreground: "#dddddd" }}
        terminalFontScale={fontScale}
        mobileShortcuts={[[], []]}
        mobileSideShortcuts={[]}
      />
    </>
  );
}
