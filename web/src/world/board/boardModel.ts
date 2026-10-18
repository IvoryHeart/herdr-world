import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";

/**
 * Board's projection of World's bounded topology: hosts as zones, workspaces as
 * cards, tabs as cards around their workspace, each tab holding its panes.
 * Keys are qualified by connection, so two hosts never share a key. Pure: the
 * same World object always yields the same board.
 */

export type BoardHost = {
  key: string;
  connectionId: string;
  label: string;
  stale: boolean;
  workspaceKeys: string[];
};

export type BoardWorkspace = {
  key: string;
  hostKey: string;
  connectionId: string;
  generation: number;
  nativeId: string;
  label: string;
  stale: boolean;
  actionable: boolean;
  tabKeys: string[];
  /** Every pane's status, most urgent first, for the overview squares. */
  statuses: WorldAgentStatus[];
  space: WorldSpaceObject;
};

export type BoardPane = {
  key: string;
  status: WorldAgentStatus;
  isAgent: boolean;
  leaf: WorldLeafObject;
};

export type BoardTab = {
  key: string;
  workspaceKey: string;
  hostKey: string;
  nativeId: string;
  label: string;
  /** The tab's most urgent pane status. */
  status: WorldAgentStatus;
  stale: boolean;
  actionable: boolean;
  panes: BoardPane[];
};

export type BoardModel = {
  hosts: BoardHost[];
  workspaces: BoardWorkspace[];
  tabs: BoardTab[];
  hostByKey: ReadonlyMap<string, BoardHost>;
  workspaceByKey: ReadonlyMap<string, BoardWorkspace>;
  tabByKey: ReadonlyMap<string, BoardTab>;
};

/** Needs you first, then no signal, finished, working and idle. */
const URGENCY: Record<WorldAgentStatus, number> = {
  blocked: 0,
  unknown: 1,
  done: 2,
  working: 3,
  idle: 4,
};

export function boardStatusOrder(a: WorldAgentStatus, b: WorldAgentStatus) {
  return URGENCY[a] - URGENCY[b];
}

export function mostUrgentStatus(statuses: readonly WorldAgentStatus[]) {
  let best: WorldAgentStatus = "idle";
  for (const status of statuses)
    if (URGENCY[status] < URGENCY[best]) best = status;
  return best;
}

export const boardKey = (connectionId: string, nativeId: string) =>
  `${connectionId}:${nativeId}`;

const hostKeyOf = (host: WorldHostObject) => host.connectionId;

export function projectBoard(world: WorldObject): BoardModel {
  const hosts: BoardHost[] = [];
  const workspaces: BoardWorkspace[] = [];
  const tabs: BoardTab[] = [];
  for (const host of world.hosts) {
    const hostKey = hostKeyOf(host);
    const boardHost: BoardHost = {
      key: hostKey,
      connectionId: host.connectionId,
      label: host.label,
      stale: host.stale,
      workspaceKeys: [],
    };
    hosts.push(boardHost);
    for (const space of host.spaces) {
      const workspaceKey = boardKey(space.connectionId, space.nativeId);
      boardHost.workspaceKeys.push(workspaceKey);
      // Tabs in Herdr's native order; a tab with no admitted pane is still a
      // card, so every admitted tab stays reachable.
      const panesByTab = new Map<string, BoardPane[]>();
      for (const leaf of space.children) {
        const list = panesByTab.get(leaf.tabId) ?? [];
        list.push({
          key: boardKey(leaf.connectionId, leaf.nativeId),
          status: leaf.status,
          isAgent: leaf.kind === "agent",
          leaf,
        });
        panesByTab.set(leaf.tabId, list);
      }
      const tabKeys: string[] = [];
      const statuses: WorldAgentStatus[] = [];
      const order = space.tabs.map((tab) => tab.tab_id);
      for (const tabId of panesByTab.keys())
        if (!order.includes(tabId)) order.push(tabId);
      for (const tabId of order) {
        const tab = space.tabs.find((candidate) => candidate.tab_id === tabId);
        const panes = panesByTab.get(tabId) ?? [];
        const key = boardKey(space.connectionId, tabId);
        tabKeys.push(key);
        const paneStatuses = panes.map((pane) => pane.status);
        statuses.push(...paneStatuses);
        tabs.push({
          key,
          workspaceKey,
          hostKey,
          nativeId: tabId,
          label: tab?.label || panes[0]?.leaf.tabLabel || tabId,
          status: mostUrgentStatus(paneStatuses),
          stale: space.stale,
          actionable: space.actionable,
          panes,
        });
      }
      workspaces.push({
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
        space,
      });
    }
  }
  return {
    hosts,
    workspaces,
    tabs,
    hostByKey: new Map(hosts.map((host) => [host.key, host])),
    workspaceByKey: new Map(workspaces.map((space) => [space.key, space])),
    tabByKey: new Map(tabs.map((tab) => [tab.key, tab])),
  };
}
