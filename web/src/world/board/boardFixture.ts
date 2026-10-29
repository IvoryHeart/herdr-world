import type { Tab } from "../../types";
import type {
  WorldAgentStatus,
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldObservedCoverage,
  WorldSpaceObject,
} from "../worldObject";

/**
 * Synthetic World objects for Board tests, shaped like Herdr's own IDs
 * (`w1`, `w1:t1`, `w1:p1`). A pane spec is `[status, isAgent?]`.
 */
export type FixturePane = [WorldAgentStatus, boolean?];
export type FixtureTab = { label: string; panes: FixturePane[] };
export type FixtureSpace = { label: string; tabs: FixtureTab[] };

const emptyStatus = () => ({
  working: 0,
  idle: 0,
  blocked: 0,
  done: 0,
  unknown: 0,
});

function coverage(
  leaves: readonly WorldLeafObject[],
  tabs: number,
): WorldObservedCoverage {
  const status = emptyStatus();
  const agents = leaves.filter((leaf) => leaf.kind === "agent");
  for (const agent of agents) status[agent.status] += 1;
  return {
    spaces: 1,
    tabs,
    leaves: leaves.length,
    agents: agents.length,
    shells: leaves.length - agents.length,
    status,
  };
}

function base(connectionId: string, stale: boolean) {
  return {
    connectionId,
    generation: 1,
    hostLabel: connectionId,
    hostState: stale ? "offline-stale" : "active",
    selectedHost: true,
    stale,
    actionable: !stale,
    capabilities: {
      activateHost: false,
      openTerminal: !stale,
      openSpaces: !stale,
      files: !stale,
      changes: !stale,
      agentHistory: !stale,
      roomMutation: !stale,
      launcher: false,
    },
  } as const;
}

export function fixtureHost(
  connectionId: string,
  spaces: FixtureSpace[],
  options: { stale?: boolean } = {},
): WorldHostObject {
  const stale = options.stale ?? false;
  const builtSpaces = spaces.map((space, s) => {
    const wid = `w${s + 1}`;
    let paneIndex = 0;
    const tabs: Tab[] = [];
    const children: WorldLeafObject[] = [];
    space.tabs.forEach((tab, t) => {
      const tabId = `${wid}:t${t + 1}`;
      tabs.push({ tab_id: tabId, label: tab.label } as Tab);
      for (const [status, isAgent = true] of tab.panes) {
        paneIndex += 1;
        const paneId = `${wid}:p${paneIndex}`;
        children.push({
          ...base(connectionId, stale),
          id: `leaf:${connectionId}:${paneId}`,
          nativeId: paneId,
          kind: isAgent ? "agent" : "terminal",
          parentId: `space:${connectionId}:${wid}`,
          label: `${tab.label} ${paneIndex}`,
          pane: {
            pane_id: paneId,
            workspace_id: wid,
            tab_id: tabId,
            terminal_id: `term_${connectionId}_${paneId}`,
            agent: isAgent ? "codex" : "",
            agent_status: status,
          } as WorldLeafObject["pane"],
          workspaceId: wid,
          tabId,
          terminalId: `term_${connectionId}_${paneId}`,
          status,
          focused: false,
          stateLabels: {},
          spaceLabel: space.label,
          tabLabel: tab.label,
        });
      }
    });
    const built: WorldSpaceObject = {
      ...base(connectionId, stale),
      id: `space:${connectionId}:${wid}`,
      nativeId: wid,
      kind: "space",
      parentId: `host:${connectionId}`,
      label: space.label,
      workspace: {} as WorldSpaceObject["workspace"],
      tabs,
      children,
      coverage: coverage(children, tabs.length),
    };
    return built;
  });
  return {
    ...base(connectionId, stale),
    id: `host:${connectionId}`,
    nativeId: connectionId,
    kind: "host",
    parentId: null,
    label: connectionId,
    // A ready, current runtime unless the host is stale (relations read it).
    connection: {
      connectionId,
      state: stale ? "reconnecting" : "ready",
      generation: 1,
      snapshotGeneration: 1,
      stale,
      actionable: !stale,
      snapshot: {
        workspaces: builtSpaces.map((space) => space.workspace),
        tabs: builtSpaces.flatMap((space) => space.tabs),
        panes: builtSpaces.flatMap((space) =>
          space.children.map((leaf) => leaf.pane),
        ),
      },
    } as unknown as WorldHostObject["connection"],
    spaces: builtSpaces,
    coverage: coverage(
      builtSpaces.flatMap((space) => space.children),
      0,
    ),
  };
}

export function fixtureWorld(hosts: WorldHostObject[]): WorldObject {
  const spaces = hosts.flatMap((host) => host.spaces);
  const leaves = spaces.flatMap((space) => space.children);
  const nodes = hosts.flatMap((host) => [
    host,
    ...host.spaces.flatMap((space) => [space, ...space.children]),
  ]);
  return {
    version: 1,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage: coverage(leaves, 0),
  };
}
