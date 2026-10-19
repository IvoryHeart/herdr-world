import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";
import { yieldWorldTask } from "../worldObject";

/**
 * Board's projection of World's bounded topology: hosts as zones, workspaces as
 * cards, tabs as cards around their workspace, each tab holding its panes.
 * Keys are qualified by connection, so two hosts never share a key. Pure: the
 * same World object always yields the same board.
 */

export type BoardHost = {
  key: string;
  /** World's ID for the host, shared with the other views' anchors. */
  id: string;
  connectionId: string;
  /** The runtime generation the topology was read from. */
  generation: number;
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
  /**
   * One square per pane for the overview: agents first, most urgent first,
   * then shells, which are drawn hollow.
   */
  squares: BoardSquare[];
  /** Agent pane statuses, most urgent first. */
  statuses: WorldAgentStatus[];
  space: WorldSpaceObject;
};

export type BoardSquare = { status: WorldAgentStatus; isAgent: boolean };

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
  /** The tab's most urgent agent status; idle when it has no agent. */
  status: WorldAgentStatus;
  /** Every pane is a plain terminal: drawn as a small terminal, no pulse. */
  shellOnly: boolean;
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

/**
 * A tab's card key. Current Herdr IDs never collide (`w1` and `w1:t1`), so a
 * tab keeps the plain key and saved arrangements stay valid; older Herdr can
 * give a tab the same ID as its workspace, and then the tab's key is
 * qualified so the two cards stay distinct.
 */
export const boardTabKey = (
  connectionId: string,
  tabId: string,
  workspaceIds: ReadonlySet<string>,
) =>
  workspaceIds.has(tabId)
    ? boardKey(connectionId, `tab:${tabId}`)
    : boardKey(connectionId, tabId);

const hostKeyOf = (host: WorldHostObject) => host.connectionId;

type HostProjection = {
  host: BoardHost;
  workspaces: BoardWorkspace[];
  tabs: BoardTab[];
};

/**
 * Each host's projection, kept with the host object: a filtered World reuses
 * its hosts, and a large World is projected ahead of time, a few hosts per
 * task, so Board never spends one long task projecting it.
 */
const projected = new WeakMap<WorldHostObject, HostProjection>();

function projectHost(host: WorldHostObject): HostProjection {
  const cached = projected.get(host);
  if (cached) return cached;
  const workspaces: BoardWorkspace[] = [];
  const tabs: BoardTab[] = [];
  {
    const hostKey = hostKeyOf(host);
    const boardHost: BoardHost = {
      key: hostKey,
      id: host.id,
      connectionId: host.connectionId,
      generation: host.generation,
      label: host.label,
      stale: host.stale,
      workspaceKeys: [],
    };
    const workspaceIds = new Set(host.spaces.map((space) => space.nativeId));
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
        squares: squares.sort((a, b) =>
          a.isAgent !== b.isAgent
            ? a.isAgent
              ? -1
              : 1
            : boardStatusOrder(a.status, b.status),
        ),
        space,
      });
    }
    const result = { host: boardHost, workspaces, tabs };
    projected.set(host, result);
    return result;
  }
}

/** Project a World's hosts ahead of time, yielding between slices of work. */
export async function prepareWorldBoard(
  world: WorldObject,
  isCurrent: () => boolean = () => true,
  yieldTask: () => Promise<void> = yieldWorldTask,
): Promise<void> {
  let sliceStart = performance.now();
  for (const host of world.hosts) {
    if (!isCurrent()) return;
    projectHost(host);
    if (performance.now() - sliceStart > BOARD_PREPARATION_SLICE_MS) {
      await yieldTask();
      sliceStart = performance.now();
    }
  }
}
const BOARD_PREPARATION_SLICE_MS = 6;

export function projectBoard(world: WorldObject): BoardModel {
  const hosts: BoardHost[] = [];
  const workspaces: BoardWorkspace[] = [];
  const tabs: BoardTab[] = [];
  for (const worldHost of world.hosts) {
    const piece = projectHost(worldHost);
    hosts.push(piece.host);
    workspaces.push(...piece.workspaces);
    tabs.push(...piece.tabs);
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
