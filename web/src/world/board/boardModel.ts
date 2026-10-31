import { projectBoardRoom } from "./boardRoom";
import type { ConnectionLifecycleState } from "../../api";
import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldSpaceObject,
} from "../worldObject";
import { yieldWorldTask } from "../worldObject";
import { DEVTOOLS } from "../devtools/flag";
import { countWorldWork } from "../devtools/renderer";
import { cardKey, tabCardKey } from "../../../../shared/terminalColor";

/**
 * Board's projection of World's bounded topology: hosts as zones, workspaces as
 * cards, tabs as cards around their workspace, each tab holding its panes.
 * Keys are qualified by connection, so two hosts never share a key. Pure: the
 * same World object always yields the same board.
 */

export type BoardHost = {
  connectionState?: ConnectionLifecycleState;
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

/** Card keys are shared with terminal colours (shared/terminalColor.ts). */
export const boardKey = cardKey;
export const boardTabKey = tabCardKey;

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
  if (DEVTOOLS) countWorldWork("board.host-project");
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
      connectionState: host.connection.state,
      stale: host.stale || !host.actionable,
      workspaceKeys: [],
    };
    const workspaceIds = new Set(host.spaces.map((space) => space.nativeId));
    for (const space of host.spaces) {
      const workspaceKey = boardKey(space.connectionId, space.nativeId);
      boardHost.workspaceKeys.push(workspaceKey);
      const room = projectBoardRoom(space, hostKey, workspaceIds);
      workspaces.push(room.workspace);
      tabs.push(...room.tabs);
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
  // As Town's preparation does: one final yield before the World publishes.
  await yieldTask();
}
const BOARD_PREPARATION_SLICE_MS = 6;

export function projectBoard(world: WorldObject): BoardModel {
  if (DEVTOOLS) countWorldWork("board.project");
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
