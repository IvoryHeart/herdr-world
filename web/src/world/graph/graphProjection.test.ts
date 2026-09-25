import { describe, expect, test } from "bun:test";
import { projectWorldGraph } from "./graphProjection";
import type {
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldObservedCoverage,
  WorldSpaceObject,
} from "../worldObject";

describe("World Graph projection", () => {
  test("keeps duplicate native identifiers distinct inside qualified host trees", () => {
    const world = fixtureWorld([
      fixtureHost("local", [fixtureSpace("local", 0, 2)]),
      fixtureHost("remote", [fixtureSpace("remote", 0, 2)]),
    ]);
    const graph = projectWorldGraph(world);

    expect(graph.nodes.map(({ id }) => id)).toEqual([
      "host:local",
      "space:local:0",
      "leaf:local:0:0",
      "leaf:local:0:1",
      "host:remote",
      "space:remote:0",
      "leaf:remote:0:0",
      "leaf:remote:0:1",
    ]);
    expect(graph.edges).toContainEqual({
      sourceId: "host:remote",
      targetId: "space:remote:0",
      kind: "contains",
    });
    expect(graph.edges).not.toContainEqual({
      sourceId: "host:local",
      targetId: "space:remote:0",
      kind: "contains",
    });
  });

  test("reports exact bounds and prioritizes focused, attention, and agent leaves", () => {
    const crowded = fixtureSpace("local", 0, 19);
    crowded.children[18] = fixtureLeaf("local", 0, 18, {
      focused: true,
      status: "idle",
      kind: "terminal",
    });
    crowded.children[17] = fixtureLeaf("local", 0, 17, {
      status: "blocked",
      kind: "terminal",
    });
    const graph = projectWorldGraph(
      fixtureWorld([fixtureHost("local", [crowded])]),
    );
    const children = graph.hosts[0]?.spaces[0]?.children ?? [];

    expect(children).toHaveLength(16);
    expect(children.map(({ id }) => id)).toContain("leaf:local:0:18");
    expect(children.map(({ id }) => id)).toContain("leaf:local:0:17");
    expect(graph.hosts[0]?.spaces[0]?.omittedChildCount).toBe(3);
    expect(graph.coverage).toMatchObject({
      observedTerminals: 19,
      presentedTerminals: 16,
      omittedTerminals: 3,
    });
  });

  test("reports exact leaf kinds when aggregate records are bounded", () => {
    const bounded = fixtureSpace("local", 0, 16);
    bounded.coverage.leaves = 4_097;
    bounded.coverage.agents = 2_049;
    bounded.coverage.shells = 2_048;
    bounded.coverage.status.working = 2_049;

    const graph = projectWorldGraph(
      fixtureWorld([fixtureHost("local", [bounded])]),
    );

    expect(graph.hosts[0]?.spaces[0]).toMatchObject({
      observedChildCount: 4_097,
      omittedChildCount: 4_081,
    });
    expect(graph.coverage).toMatchObject({
      observedAgents: 2_049,
      omittedAgents: 2_033,
      observedTerminals: 4_097,
      omittedTerminals: 4_081,
      observedShells: 2_048,
    });
  });

  test("reports watched overflow separately from ordinary omissions", () => {
    const crowded = fixtureSpace("local", 0, 19);
    crowded.children = crowded.children.map((leaf) => ({
      ...leaf,
      watched: true,
    }));
    const graph = projectWorldGraph(
      fixtureWorld([fixtureHost("local", [crowded])]),
    );
    expect(graph.hosts[0]?.spaces[0]).toMatchObject({
      omittedChildCount: 3,
      watchedOmittedChildCount: 3,
    });
    expect(graph.coverage.watchedOmittedLeaves).toBe(3);
  });

  test("bounds hosts and spaces globally and reports exact omissions", () => {
    const hostBound = projectWorldGraph(
      fixtureWorld(
        Array.from({ length: 129 }, (_, index) =>
          fixtureHost(`remote-${index}`, [
            fixtureSpace(`remote-${index}`, 0, 1),
          ]),
        ),
      ),
    );

    expect(hostBound.hosts).toHaveLength(128);
    expect(hostBound.omittedHostCount).toBe(1);
    expect(hostBound.omittedSpaceCount).toBe(1);
    expect(hostBound.coverage).toMatchObject({
      configuredHosts: 129,
      presentedHosts: 128,
      observedSpaces: 129,
      presentedSpaces: 128,
      omittedTerminals: 1,
    });

    const spaceBound = projectWorldGraph(
      fixtureWorld([
        fixtureHost(
          "local",
          Array.from({ length: 129 }, (_, index) =>
            fixtureSpace("local", index, 1),
          ),
        ),
      ]),
    );

    expect(spaceBound.hosts[0]?.spaces).toHaveLength(128);
    expect(spaceBound.hosts[0]?.omittedSpaceCount).toBe(1);
    expect(spaceBound.omittedSpaceCount).toBe(1);
    expect(spaceBound.coverage).toMatchObject({
      observedSpaces: 129,
      presentedSpaces: 128,
    });
  });

  test("prioritizes the selected host, space, and leaf before every bound", () => {
    const hosts = Array.from({ length: 129 }, (_, index) =>
      fixtureHost(`remote-${index}`, [fixtureSpace(`remote-${index}`, 0, 1)]),
    );
    hosts[128] = fixtureHost("remote-128", [fixtureSpace("remote-128", 0, 19)]);
    const selected = hosts[128]!.spaces[0]!.children[18]!;

    const projection = projectWorldGraph(fixtureWorld(hosts), selected.id);
    const selectedHost = projection.hosts.find(
      ({ node }) => node.id === hosts[128]!.id,
    );
    const selectedSpace = selectedHost?.spaces.find(
      ({ node }) => node.id === hosts[128]!.spaces[0]!.id,
    );

    expect(selectedHost).toBeDefined();
    expect(selectedSpace).toBeDefined();
    expect(selectedSpace?.children.map(({ id }) => id)).toContain(selected.id);
  });
});

function fixtureWorld(hosts: WorldHostObject[]): WorldObject {
  const spaces = hosts.flatMap(({ spaces }) => spaces);
  const leaves = spaces.flatMap(({ children }) => children);
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
    coverage: combineCoverage(hosts.map(({ coverage }) => coverage)),
  };
}

function fixtureHost(
  connectionId: string,
  spaces: WorldSpaceObject[],
): WorldHostObject {
  return {
    ...base(connectionId),
    id: `host:${connectionId}`,
    nativeId: connectionId,
    kind: "host",
    parentId: null,
    label: connectionId,
    connection: {} as WorldHostObject["connection"],
    spaces,
    coverage: combineCoverage(spaces.map(({ coverage }) => coverage)),
  };
}

function fixtureSpace(
  connectionId: string,
  index: number,
  leafCount: number,
): WorldSpaceObject {
  const id = `space:${connectionId}:${index}`;
  const children = Array.from({ length: leafCount }, (_, leaf) =>
    fixtureLeaf(connectionId, index, leaf),
  );
  return {
    ...base(connectionId),
    id,
    nativeId: "shared-space",
    kind: "space",
    parentId: `host:${connectionId}`,
    label: `Space ${index}`,
    workspace: {} as WorldSpaceObject["workspace"],
    tabs: [],
    children,
    coverage: coverageForLeaves(children),
  };
}

function coverageForLeaves(
  leaves: readonly WorldLeafObject[],
): WorldObservedCoverage {
  const status = { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 };
  const agents = leaves.filter(({ kind }) => kind === "agent");
  for (const agent of agents) status[agent.status] += 1;
  return {
    spaces: 1,
    tabs: 0,
    leaves: leaves.length,
    agents: agents.length,
    shells: leaves.length - agents.length,
    status,
  };
}

function combineCoverage(
  values: readonly WorldObservedCoverage[],
): WorldObservedCoverage {
  return values.reduce<WorldObservedCoverage>(
    (total, value) => ({
      spaces: total.spaces + value.spaces,
      tabs: total.tabs + value.tabs,
      leaves: total.leaves + value.leaves,
      agents: total.agents + value.agents,
      shells: total.shells + value.shells,
      status: {
        working: total.status.working + value.status.working,
        idle: total.status.idle + value.status.idle,
        blocked: total.status.blocked + value.status.blocked,
        done: total.status.done + value.status.done,
        unknown: total.status.unknown + value.status.unknown,
      },
    }),
    {
      spaces: 0,
      tabs: 0,
      leaves: 0,
      agents: 0,
      shells: 0,
      status: { working: 0, idle: 0, blocked: 0, done: 0, unknown: 0 },
    },
  );
}

function fixtureLeaf(
  connectionId: string,
  space: number,
  index: number,
  patch: Partial<WorldLeafObject> = {},
): WorldLeafObject {
  return {
    ...base(connectionId),
    id: `leaf:${connectionId}:${space}:${index}`,
    nativeId: "shared-pane",
    kind: "agent",
    parentId: `space:${connectionId}:${space}`,
    label: `Agent ${index}`,
    pane: {} as WorldLeafObject["pane"],
    workspaceId: "shared-space",
    tabId: "tab",
    terminalId: "shared-terminal",
    status: "idle",
    focused: false,
    stateLabels: {},
    spaceLabel: `Space ${space}`,
    ...patch,
  };
}

function base(connectionId: string) {
  return {
    connectionId,
    generation: 1,
    hostLabel: connectionId,
    hostState: connectionId === "local" ? "active" : "ready-inactive",
    selectedHost: connectionId === "local",
    stale: false,
    actionable: connectionId === "local",
    capabilities: {
      activateHost: false,
      openTerminal: connectionId === "local",
      openSpaces: connectionId === "local",
      files: connectionId === "local",
      changes: connectionId === "local",
      agentHistory: connectionId === "local",
      roomMutation: false,
      launcher: false,
    },
  } as const;
}
