import type { ITheme } from "@xterm/xterm";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { TerminalWorkspaceFileRequest } from "../components/TerminalView";
import { TerminalView } from "../components/TerminalView";
import type {
  MobileTerminalShortcutRows,
  MobileTerminalSideShortcuts,
} from "../mobileTerminalShortcuts";
import { terminalMountKey } from "../terminalConnection";
import type { Pane } from "../types";
import type { WorldTerminalPresentation } from "./worldTerminalPresentation";

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
          presentation.connectionId !== activeConnectionId ||
          presentation.runtimeGeneration !== runtimeGeneration
        ) {
          return null;
        }
        const pane = panes.find(
          (candidate) =>
            candidate.pane_id === presentation.paneId &&
            candidate.terminal_id === presentation.terminalId,
        );
        return pane ? (
          <WorldTerminalPortalOwner
            key={terminalMountKey(
              {
                connectionId: activeConnectionId,
                generation: connectionGeneration,
              },
              pane.pane_id,
              pane.terminal_id,
            )}
            portal={presentation.portal}
            parking={parking}
          >
            <TerminalView
              paneId={pane.pane_id}
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
