import { notificationSender } from "../../../shared/notificationSender";
import type { TaskEvent } from "../notifications/task-events";
import type { CoreMirrorTerminal } from "./mirror";
import type { CoreAlert } from "./shared-state";
import { coreTopology } from "./topology";

/**
 * The task events World pushes for core alerts: the same shape the Herdr
 * (TUI) status tracker sends, named from World's own rows (room and tab
 * labels, the harness). Core agents carry no verified session yet, so a
 * push opens World rather than a specific window.
 */
export function coreTaskEvents(
  alerts: readonly CoreAlert[],
  terminals: readonly CoreMirrorTerminal[],
  coreName: string,
): TaskEvent[] {
  const rows = coreTopology(terminals, coreName);
  const panes = new Map(rows.panes.map((pane) => [pane.pane_id, pane]));
  const label = (
    rowsOf: readonly Record<string, unknown>[],
    key: string,
    id: unknown,
  ) => {
    const row = rowsOf.find((candidate) => candidate[key] === id);
    return typeof row?.label === "string" ? row.label : undefined;
  };
  const events: TaskEvent[] = [];
  for (const alert of alerts) {
    const pane = panes.get(alert.address);
    if (!pane?.agent || typeof pane.agent !== "string") continue;
    events.push({
      kind: alert.kind,
      workspaceId: pane.workspace_id,
      paneId: alert.address,
      tabId: pane.tab_id,
      workspaceLabel: label(rows.workspaces, "workspace_id", pane.workspace_id),
      tabLabel: label(rows.tabs, "tab_id", pane.tab_id),
      agent: pane.agent,
      sender: notificationSender(pane.agent),
    });
  }
  return events;
}
