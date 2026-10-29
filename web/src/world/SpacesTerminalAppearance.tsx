import { shallowEqual, useStoreSelector } from "../store";
import type { Tab } from "../types";
import { TerminalAppearanceButton } from "./TerminalAppearanceButton";
import type { TerminalAppearanceEditorProps } from "./TerminalAppearanceEditor";

/** Keep both Spaces entry points bound to the pane selected in their native tab. */
export function SpacesTerminalAppearance({
  connectionId,
  generation,
  tab,
  color,
}: {
  connectionId: string;
  generation: number;
  tab: Tab;
  color: TerminalAppearanceEditorProps["color"];
}) {
  const state = useStoreSelector(
    (current) => ({
      connectionId: current.activeConnectionId,
      generation: current.serverRuntimeGeneration,
      status: current.status,
      ready: current.catalogueReady,
      selectedPaneId: current.selectedPaneId,
      panes: current.panes,
      workspaces: current.workspaces,
    }),
    shallowEqual,
  );
  const panes = state.panes.filter(
    (pane) =>
      pane.tab_id === tab.tab_id && pane.workspace_id === tab.workspace_id,
  );
  const pane =
    panes.find((entry) => entry.pane_id === state.selectedPaneId) ??
    panes.find((entry) => entry.focused) ??
    panes[0];
  if (
    !pane ||
    state.connectionId !== connectionId ||
    state.generation !== generation
  ) {
    return (
      <button
        type="button"
        className="mobile-appearance-button"
        aria-label="Terminal appearance unavailable"
        disabled
      >
        ◉
      </button>
    );
  }
  return (
    <TerminalAppearanceButton
      key={JSON.stringify([
        connectionId,
        generation,
        tab.tab_id,
        pane.pane_id,
        pane.terminal_id,
      ])}
      connectionId={connectionId}
      generation={generation}
      tabId={tab.tab_id}
      paneId={pane.pane_id}
      terminalId={pane.terminal_id}
      tabTerminals={panes.map((entry) => entry.terminal_id)}
      workspaceIds={state.workspaces.map((workspace) => workspace.workspace_id)}
      tabName={tab.label || `Tab ${tab.number}`}
      color={color}
      disabled={state.status !== "connected" || !state.ready}
    />
  );
}
