import { describe, expect, test } from "bun:test";
import { projectWorldGraph } from "./graphProjection";
import type {
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
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
    expect(hostBound.coverage).toMatchObject({
      configuredHosts: 129,
      presentedHosts: 128,
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
  };
}

function fixtureSpace(
  connectionId: string,
  index: number,
  leafCount: number,
): WorldSpaceObject {
  const id = `space:${connectionId}:${index}`;
  return {
    ...base(connectionId),
    id,
    nativeId: "shared-space",
    kind: "space",
    parentId: `host:${connectionId}`,
    label: `Space ${index}`,
    workspace: {} as WorldSpaceObject["workspace"],
    tabs: [],
    children: Array.from({ length: leafCount }, (_, leaf) =>
      fixtureLeaf(connectionId, index, leaf),
    ),
  };
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
