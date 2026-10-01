import type { ConnectionClient } from "../api";
import type { TerminalWorkspaceFileRequest } from "../components/TerminalView";
import type { Pane } from "../types";
import {
  worldInspectorWindowId,
  type WorldInspectorConversation,
} from "./worldTerminalPresentation";

export const INSPECTOR_TERMINAL_FILE_EVENT =
  "herdr-world:inspector-terminal-file";

export type InspectorTerminalFileRequest = TerminalWorkspaceFileRequest & {
  windowId: string;
  runtimeGeneration: number;
};

export function inspectorTerminalFileAdmitted(
  request: InspectorTerminalFileRequest,
  conversation: WorldInspectorConversation,
  client: ConnectionClient,
  panes: readonly Pane[],
) {
  return (
    client.isCurrent() &&
    request.windowId === worldInspectorWindowId(conversation) &&
    request.connectionId === client.connectionId &&
    request.connectionId === conversation.connectionId &&
    request.connectionGeneration === client.generation &&
    request.runtimeGeneration === client.serverRuntimeGeneration &&
    request.runtimeGeneration === conversation.runtimeGeneration &&
    request.workspaceId === conversation.workspaceId &&
    panes.some(
      (pane) =>
        pane.pane_id === request.paneId &&
        pane.workspace_id === conversation.workspaceId &&
        pane.tab_id === conversation.tabId,
    )
  );
}

/** Never take the first textarea of a split tab: it may belong to a sibling. */
export function inspectorPaneInput(target: Element | null, paneId: string) {
  return (
    [
      ...(target?.querySelectorAll<HTMLElement>(
        ".pane-layout-cell, .pane-layout-single",
      ) ?? []),
    ]
      .find((element) => element.dataset.paneId === paneId)
      ?.querySelector<HTMLElement>(".xterm-helper-textarea") ?? null
  );
}
