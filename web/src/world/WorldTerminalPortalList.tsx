import type { ITheme } from "@xterm/xterm";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TabTerminalPaneLayout } from "../TabTerminalPaneLayout";
import type { TerminalWorkspaceFileRequest } from "../components/TerminalView";
import type {
  MobileTerminalShortcutRows,
  MobileTerminalSideShortcuts,
} from "../mobileTerminalShortcuts";
import type { Pane } from "../types";
import { useVisibleTabLayout } from "../visibleTabLayout";
import type { WorldTerminalPresentation } from "./worldTerminalPresentation";
import { worldInspectorWindowId } from "./worldTerminalPresentation";

export default function WorldTerminalPortalList({
  presentations,
  panes,
  activeConnectionId,
  connectionGeneration,
  runtimeGeneration,
  terminalTheme,
  terminalFontScale,
  mobileShortcuts,
  mobileSideShortcuts,
  onOpenWorkspaceFile,
}: {
  presentations: readonly WorldTerminalPresentation[];
  panes: readonly Pane[];
  activeConnectionId: string | null;
  connectionGeneration: number;
  runtimeGeneration: number | null;
  terminalTheme: ITheme;
  terminalFontScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  onOpenWorkspaceFile(request: TerminalWorkspaceFileRequest): void;
}) {
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div
        ref={setParking}
        className="world-terminal-parking"
        aria-hidden="true"
      />
      {presentations.map((presentation) => {
        if (
          !presentation.portal ||
          !presentation.tabId ||
          presentation.connectionId !== activeConnectionId ||
          presentation.runtimeGeneration !== runtimeGeneration
        ) {
          return null;
        }
        const pane = panes.find(
          (candidate) =>
            candidate.pane_id === presentation.paneId &&
            candidate.terminal_id === presentation.terminalId &&
            candidate.workspace_id === presentation.workspaceId &&
            candidate.tab_id === presentation.tabId,
        );
        return pane ? (
          <WorldTerminalPortalOwner
            key={worldInspectorWindowId(presentation)}
            portal={presentation.portal}
            parking={parking}
          >
            <WorldInspectorTabTerminal
              presentation={presentation}
              panes={panes}
              connectionGeneration={connectionGeneration}
              terminalTheme={terminalTheme}
              terminalFontScale={terminalFontScale}
              mobileShortcuts={mobileShortcuts}
              mobileSideShortcuts={mobileSideShortcuts}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />
          </WorldTerminalPortalOwner>
        ) : null;
      })}
    </>
  );
}

function WorldInspectorTabTerminal({
  presentation,
  panes,
  connectionGeneration,
  terminalTheme,
  terminalFontScale,
  mobileShortcuts,
  mobileSideShortcuts,
  onOpenWorkspaceFile,
}: {
  presentation: WorldTerminalPresentation & { tabId: string };
  panes: readonly Pane[];
  connectionGeneration: number;
  terminalTheme: ITheme;
  terminalFontScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  onOpenWorkspaceFile(request: TerminalWorkspaceFileRequest): void;
}) {
  const layout = useVisibleTabLayout(
    presentation.workspaceId,
    presentation.tabId,
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
  return (
    <TabTerminalPaneLayout
      layout={layout}
      panes={panes.filter(
        (pane) =>
          pane.workspace_id === presentation.workspaceId &&
          pane.tab_id === presentation.tabId,
      )}
      selectedPaneId={presentation.paneId}
      connectionId={presentation.connectionId}
      connectionGeneration={connectionGeneration}
      onFocusPane={presentation.onFocusPane}
      terminalTheme={terminalTheme}
      terminalFontScale={terminalFontScale}
      mobileShortcuts={mobileShortcuts}
      mobileSideShortcuts={mobileSideShortcuts}
      composerOpen={composerOpen}
      onComposerOpenChange={setComposerOpen}
      agentHistoryOpen={agentHistoryOpen}
      onAgentHistoryOpenChange={setAgentHistoryOpen}
      onOpenWorkspaceFile={onOpenWorkspaceFile}
    />
  );
}

function WorldTerminalPortalOwner({
  portal,
  parking,
  children,
}: {
  portal: Element | null;
  parking: Element | null;
  children: ReactNode;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  if (!mountRef.current) {
    mountRef.current = document.createElement("div");
    mountRef.current.className = "world-terminal-owner";
  }
  const mount = mountRef.current;

  useLayoutEffect(() => {
    const target = portal ?? parking;
    if (target && mount.parentElement !== target) target.appendChild(mount);
    return () => {
      if (parking && mount.parentElement !== parking)
        parking.appendChild(mount);
    };
  }, [mount, parking, portal]);

  useLayoutEffect(
    () => () => {
      mount.remove();
    },
    [mount],
  );

  return createPortal(children, mount);
}
