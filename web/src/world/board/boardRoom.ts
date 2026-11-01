import {
  boardKey,
  boardTabKey,
  boardStatusOrder,
  mostUrgentStatus,
  type BoardPane,
  type BoardSquare,
  type BoardTab,
  type BoardWorkspace,
} from "./boardModel";
import type { WorldAgentStatus, WorldSpaceObject } from "../worldObject";
import { DEVTOOLS } from "../devtools/flag";
import { countWorldWork } from "../devtools/renderer";
const rooms = new WeakMap<
  WorldSpaceObject,
  { key: string; workspace: BoardWorkspace; tabs: BoardTab[] }
>();
export function projectBoardRoom(
  space: WorldSpaceObject,
  hostKey: string,
  workspaceIds: ReadonlySet<string>,
) {
  const key = JSON.stringify(
    [
      ...new Set([
        ...space.tabs.map((tab) => tab.tab_id),
        ...space.children.map((leaf) => leaf.tabId),
      ]),
    ].map((tab) => [tab, workspaceIds.has(tab)]),
  );
  const prior = rooms.get(space);
  if (prior?.key === key) return prior;
  if (DEVTOOLS) countWorldWork("board.room-project");
  const workspaceKey = boardKey(space.connectionId, space.nativeId);
  const tabs: BoardTab[] = [];
  // Tabs in Herdr's native order; a tab with no admitted pane is still a
  // card, so every admitted tab stays reachable.
  const panesByTab = new Map<string, BoardPane[]>();
  for (const leaf of space.children) {
    const list = panesByTab.get(leaf.tabId) ?? [];
    list.push({
      key: boardKey(leaf.connectionId, leaf.nativeId),
      status: leaf.stale ? "unknown" : leaf.status,
      isAgent: leaf.kind === "agent",
      leaf,
    });
    panesByTab.set(leaf.tabId, list);
  }
  const tabKeys: string[] = [];
  const statuses: WorldAgentStatus[] = [];
  const squares: BoardSquare[] = [];
  const tabById = new Map(space.tabs.map((tab) => [tab.tab_id, tab]));
  const order = [...tabById.keys()];
  for (const tabId of panesByTab.keys())
    if (!tabById.has(tabId)) order.push(tabId);
  for (const tabId of order) {
    const tab = tabById.get(tabId);
    const panes = panesByTab.get(tabId) ?? [];
    const key = boardTabKey(space.connectionId, tabId, workspaceIds);
    tabKeys.push(key);
    // Shells never colour a tab: their status says nothing about work.
    const paneStatuses = panes
      .filter((pane) => pane.isAgent)
      .map((pane) => pane.status);
    statuses.push(...paneStatuses);
    for (const pane of panes)
      squares.push({ status: pane.status, isAgent: pane.isAgent });
    tabs.push({
      key,
      workspaceKey,
      hostKey,
      nativeId: tabId,
      label: tab?.label || panes[0]?.leaf.tabLabel || tabId,
      status: mostUrgentStatus(paneStatuses),
      shellOnly: panes.length > 0 && panes.every((pane) => !pane.isAgent),
      stale: space.stale,
      actionable: space.actionable,
      panes,
    });
  }
  const workspace: BoardWorkspace = {
    key: workspaceKey,
    hostKey,
    connectionId: space.connectionId,
    generation: space.generation,
    nativeId: space.nativeId,
    label: space.label,
    stale: space.stale,
    actionable: space.actionable,
    tabKeys,
    statuses: statuses.sort(boardStatusOrder),
    squares: squares.sort((a, b) =>
      a.isAgent !== b.isAgent
        ? a.isAgent
          ? -1
          : 1
        : boardStatusOrder(a.status, b.status),
    ),
    space,
  };
  const result = { key, workspace, tabs };
  rooms.set(space, result);
  return result;
}
