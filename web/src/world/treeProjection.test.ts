import { describe, expect, test } from "bun:test";
import { projectWorldTree } from "./treeProjection";
import type {
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
  WorldObservedCoverage,
  WorldSpaceObject,
} from "./worldObject";

describe("World Tree projection", () => {
  test("bounds dense unequal branches and reports exact omissions", () => {
    const crowded = space("local", 0, 19);
    crowded.children[18] = leaf("local", 0, 18, {
      focused: true,
      kind: "terminal",
      status: "idle",
    });
    crowded.children[17] = leaf("local", 0, 17, {
      kind: "terminal",
      status: "blocked",
    });
    const projection = projectWorldTree(
      world([
        host("local", [crowded]),
        host("remote", [space("remote", 0, 2)]),
      ]),
    );

    expect(projection.hosts).toHaveLength(2);
    expect(projection.hosts[0]?.spaces[0]?.children).toHaveLength(16);
    expect(
      projection.hosts[0]?.spaces[0]?.children.map(({ id }) => id),
    ).toEqual(expect.arrayContaining(["leaf:local:0:17", "leaf:local:0:18"]));
    expect(projection.hosts[0]?.spaces[0]?.omittedChildCount).toBe(3);
    expect(projection.coverage).toEqual({
      observedLeaves: 21,
      presentedLeaves: 18,
      omittedLeaves: 3,
    });
  });

  test("reports exact leaf omissions when the aggregate record set is bounded", () => {
    const bounded = space("local", 0, 16);
    bounded.coverage.leaves = 4_097;
    bounded.coverage.agents = 4_097;
    bounded.coverage.status.idle = 4_097;

    const projection = projectWorldTree(world([host("local", [bounded])]));

    expect(projection.hosts[0]?.spaces[0]).toMatchObject({
      observedChildCount: 4_097,
      omittedChildCount: 4_081,
    });
    expect(projection.coverage).toEqual({
      observedLeaves: 4_097,
      presentedLeaves: 16,
      omittedLeaves: 4_081,
    });
  });

  test("bounds hosts and global spaces while preserving relevant entities", () => {
    const hosts = Array.from({ length: 129 }, (_, index) =>
      host(`remote-${index}`, [space(`remote-${index}`, 0, 1)]),
    );
    hosts[128] = {
      ...hosts[128]!,
      selectedHost: true,
      hostState: "active",
      actionable: true,
    };
    const hostProjection = projectWorldTree(world(hosts));

    expect(hostProjection.hosts).toHaveLength(128);
    expect(hostProjection.omittedHostCount).toBe(1);
    expect(hostProjection.omittedSpaceCount).toBe(1);
    expect(hostProjection.coverage.omittedLeaves).toBe(1);
    expect(hostProjection.hosts.map(({ source }) => source.id)).toContain(
      "host:remote-128",
    );

    const spaces = Array.from({ length: 129 }, (_, index) =>
      space("local", index, 1),
    );
    spaces[128] = {
      ...spaces[128]!,
      workspace: { focused: true } as WorldSpaceObject["workspace"],
    };
    const spaceProjection = projectWorldTree(world([host("local", spaces)]));

    expect(spaceProjection.hosts[0]?.spaces).toHaveLength(128);
    expect(spaceProjection.omittedSpaceCount).toBe(1);
    expect(
      spaceProjection.hosts[0]?.spaces.map(({ source }) => source.id),
    ).toContain("space:local:128");
    expect(spaceProjection.hosts[0]?.omittedSpaceCount).toBe(1);
  });

  test("prioritizes the selected host, space, and leaf before every bound", () => {
    const hosts = Array.from({ length: 129 }, (_, index) =>
      host(`remote-${index}`, [space(`remote-${index}`, 0, 1)]),
    );
    hosts[128] = host("remote-128", [space("remote-128", 0, 19)]);
    const selected = hosts[128]!.spaces[0]!.children[18]!;

    const projection = projectWorldTree(world(hosts), selected.id);
    const selectedHost = projection.hosts.find(
      ({ source }) => source.id === hosts[128]!.id,
    );
    const selectedSpace = selectedHost?.spaces.find(
      ({ source }) => source.id === hosts[128]!.spaces[0]!.id,
    );

    expect(selectedHost).toBeDefined();
    expect(selectedSpace).toBeDefined();
    expect(selectedSpace?.children.map(({ id }) => id)).toContain(selected.id);
  });
});

function world(hosts: WorldHostObject[]): WorldObject {
  const spaces = hosts.flatMap(({ spaces }) => spaces);
  const leaves = spaces.flatMap(({ children }) => children);
  const nodes = hosts.flatMap((item) => [
    item,
    ...item.spaces.flatMap((child) => [child, ...child.children]),
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

function host(connectionId: string, spaces: WorldSpaceObject[]) {
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
  } satisfies WorldHostObject;
}

function space(connectionId: string, index: number, leafCount: number) {
  const children = Array.from({ length: leafCount }, (_, child) =>
    leaf(connectionId, index, child),
  );
  return {
    ...base(connectionId),
    id: `space:${connectionId}:${index}`,
    nativeId: `space-${index}`,
    kind: "space",
    parentId: `host:${connectionId}`,
    label: `Space ${index}`,
    workspace: { focused: false } as WorldSpaceObject["workspace"],
    tabs: [],
    children,
    coverage: coverageForLeaves(children),
  } satisfies WorldSpaceObject;
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

function leaf(
  connectionId: string,
  parent: number,
  index: number,
  patch: Partial<WorldLeafObject> = {},
) {
  return {
    ...base(connectionId),
    id: `leaf:${connectionId}:${parent}:${index}`,
    nativeId: `leaf-${index}`,
    kind: "agent",
    parentId: `space:${connectionId}:${parent}`,
    label: `Agent ${index}`,
    pane: {} as WorldLeafObject["pane"],
    workspaceId: `space-${parent}`,
    tabId: "tab",
    terminalId: `terminal-${index}`,
    status: "idle",
    focused: false,
    stateLabels: {},
    spaceLabel: `Space ${parent}`,
    ...patch,
  } satisfies WorldLeafObject;
}

function base(connectionId: string) {
  const active = connectionId === "local";
  return {
    connectionId,
    generation: 1,
    hostLabel: connectionId,
    hostState: active ? "active" : "ready-inactive",
    selectedHost: active,
    stale: false,
    actionable: active,
    capabilities: {
      activateHost: !active,
      openTerminal: active,
      openSpaces: active,
      files: active,
      changes: active,
      agentHistory: active,
      roomMutation: false,
      launcher: false,
    },
  } as const;
}
