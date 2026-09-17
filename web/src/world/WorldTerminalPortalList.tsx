import type { ITheme } from "@xterm/xterm";
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
  uiScale,
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
  uiScale: number;
  mobileShortcuts: MobileTerminalShortcutRows;
  mobileSideShortcuts: MobileTerminalSideShortcuts;
  onOpenWorkspaceFile(request: TerminalWorkspaceFileRequest): void;
}) {
  return presentations.flatMap((presentation) => {
    const { portal } = presentation;
    if (
      presentation.connectionId !== activeConnectionId ||
      presentation.runtimeGeneration !== runtimeGeneration ||
      !portal
    ) {
      return [];
    }
    const pane = panes.find(
      (candidate) =>
        candidate.pane_id === presentation.paneId &&
        candidate.terminal_id === presentation.terminalId,
    );
    return pane
      ? [
          createPortal(
            <TerminalView
              key={terminalMountKey(
                {
                  connectionId: activeConnectionId,
                  generation: connectionGeneration,
                },
                pane.pane_id,
                pane.terminal_id,
              )}
              paneId={pane.pane_id}
              terminalTheme={terminalTheme}
              uiScale={uiScale}
              mobileShortcuts={mobileShortcuts}
              mobileSideShortcuts={mobileSideShortcuts}
              onOpenWorkspaceFile={onOpenWorkspaceFile}
            />,
            portal,
            pane.terminal_id,
          ),
        ]
      : [];
  });
}
