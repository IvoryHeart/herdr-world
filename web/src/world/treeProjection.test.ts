import { describe, expect, test } from "bun:test";
import { projectWorldTree } from "./treeProjection";
import type {
  WorldHostObject,
  WorldLeafObject,
  WorldObject,
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

    const upstreamBound = world(hosts.slice(0, 128));
    upstreamBound.omittedHostCount = 3;
    expect(projectWorldTree(upstreamBound).omittedHostCount).toBe(3);
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
    omittedHostCount: 0,
    hosts,
    spaces,
    leaves,
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
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
  } satisfies WorldHostObject;
}

function space(connectionId: string, index: number, leafCount: number) {
  return {
    ...base(connectionId),
    id: `space:${connectionId}:${index}`,
    nativeId: `space-${index}`,
    kind: "space",
    parentId: `host:${connectionId}`,
    label: `Space ${index}`,
    workspace: { focused: false } as WorldSpaceObject["workspace"],
    tabs: [],
    children: Array.from({ length: leafCount }, (_, child) =>
      leaf(connectionId, index, child),
    ),
  } satisfies WorldSpaceObject;
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
