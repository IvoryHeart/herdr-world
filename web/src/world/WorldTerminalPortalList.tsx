import type { ITheme } from "@xterm/xterm";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { TabTerminalPaneLayout } from "../TabTerminalPaneLayout";
import type {
  MobileTerminalShortcutRows,
  MobileTerminalSideShortcuts,
} from "../mobileTerminalShortcuts";
import type { Pane } from "../types";
import { useVisibleTabLayoutState } from "../visibleTabLayout";
import type { TerminalWorkspaceFileRequest } from "../components/TerminalView";
import type { WorldTerminalPresentation } from "./worldTerminalPresentation";
import { worldInspectorWindowId } from "./worldTerminalPresentation";
import {
  OperationalContext,
  connectionSnapshot,
  store,
  useStoreSelector,
} from "../store";
import {
  INSPECTOR_TERMINAL_FILE_EVENT,
  type InspectorTerminalFileRequest,
} from "./inspectorTerminalHandoff";

export default function WorldTerminalPortalList({
  presentations,
  terminalTheme,
  terminalFontFamily,
  terminalFontScale,
  mobileShortcuts,
  mobileSideShortcuts,
  spacesControls,
}: {
  presentations: readonly WorldTerminalPresentation[];
  panes: readonly Pane[];
  activeConnectionId: string | null;
  connectionGeneration: number;
  runtimeGeneration: number | null;
  terminalTheme: ITheme;
  terminalFontFamily?: string;
  terminalFontScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  spacesControls?: {
    composerOpen: boolean;
    onComposerOpenChange(open: boolean): void;
    agentHistoryOpen: boolean;
    onAgentHistoryOpenChange(open: boolean): void;
    onOpenWorkspaceFile(request: TerminalWorkspaceFileRequest): void;
  };
}) {
  const snapshot = useStoreSelector((state) => state);
  const [parking, setParking] = useState<HTMLDivElement | null>(null);
  return (
    <>
      <div
        ref={setParking}
        className="world-terminal-parking"
        aria-hidden="true"
      />
      {presentations.map((presentation) => {
        const owner = snapshot.connections.find(
          (connection) => connection.id === presentation.connectionId,
        );
        const session = connectionSnapshot(snapshot, presentation.connectionId);
        if (
          (!presentation.portal && !presentation.endpointReadiness) ||
          !presentation.tabId ||
          snapshot.status !== "connected" ||
          owner?.state !== "ready" ||
          presentation.runtimeGeneration !== owner.generation
        ) {
          return null;
        }
        const pane = session.panes.find(
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
            <OperationalContext.Provider
              value={{
                connectionId: presentation.connectionId,
                runtimeGeneration: presentation.runtimeGeneration,
              }}
            >
              <WorldInspectorTabTerminal
                presentation={presentation}
                panes={session.panes}
                connectionGeneration={presentation.runtimeGeneration}
                terminalTheme={terminalTheme}
                terminalFontFamily={terminalFontFamily}
                terminalFontScale={terminalFontScale}
                mobileShortcuts={mobileShortcuts}
                mobileSideShortcuts={mobileSideShortcuts}
                spacesControls={spacesControls}
              />
            </OperationalContext.Provider>
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
  terminalFontFamily,
  terminalFontScale,
  mobileShortcuts,
  mobileSideShortcuts,
  spacesControls,
}: {
  presentation: WorldTerminalPresentation & { tabId: string };
  panes: readonly Pane[];
  connectionGeneration: number;
  terminalTheme: ITheme;
  terminalFontFamily?: string;
  terminalFontScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  spacesControls?: Parameters<
    typeof WorldTerminalPortalList
  >[0]["spacesControls"];
}) {
  const { layout, error } = useVisibleTabLayoutState(
    presentation.workspaceId,
    presentation.tabId,
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [agentHistoryOpen, setAgentHistoryOpen] = useState(false);
  const spaces =
    presentation.presentationKind === "spaces" ? spacesControls : undefined;
  const tabPanes = panes.filter(
    (pane) =>
      pane.workspace_id === presentation.workspaceId &&
      pane.tab_id === presentation.tabId,
  );
  const retainedPaneIds = new Set(
    tabPanes
      .filter((pane) =>
        presentation.retainedPanes?.some(
          (retained) =>
            retained.paneId === pane.pane_id &&
            retained.terminalId === pane.terminal_id,
        ),
      )
      .map((pane) => pane.pane_id),
  );
  return (
    <TabTerminalPaneLayout
      layout={layout}
      unavailableMessage={error ?? undefined}
      panes={tabPanes}
      retainedPaneIds={retainedPaneIds}
      selectedPaneId={presentation.paneId}
      connectionId={presentation.connectionId}
      connectionGeneration={connectionGeneration}
      onFocusPane={presentation.onFocusPane}
      terminalTheme={terminalTheme}
      terminalFontFamily={terminalFontFamily}
      terminalFontScale={terminalFontScale}
      mobileShortcuts={mobileShortcuts}
      mobileSideShortcuts={mobileSideShortcuts}
      composerOpen={spaces?.composerOpen ?? composerOpen}
      onComposerOpenChange={spaces?.onComposerOpenChange ?? setComposerOpen}
      agentHistoryOpen={spaces?.agentHistoryOpen ?? agentHistoryOpen}
      onAgentHistoryOpenChange={
        spaces?.onAgentHistoryOpenChange ?? setAgentHistoryOpen
      }
      onOpenWorkspaceFile={(request) => {
        if (spaces) {
          spaces.onOpenWorkspaceFile(request);
          return;
        }
        const event = new CustomEvent<InspectorTerminalFileRequest>(
          INSPECTOR_TERMINAL_FILE_EVENT,
          {
            cancelable: true,
            detail: {
              ...request,
              windowId: worldInspectorWindowId(presentation),
              runtimeGeneration: presentation.runtimeGeneration,
            },
          },
        );
        window.dispatchEvent(event);
        if (!event.defaultPrevented)
          store.notify({
            kind: "error",
            message: "Cannot browse file",
            detail: "The originating Inspector or pane is no longer available.",
          });
      }}
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
