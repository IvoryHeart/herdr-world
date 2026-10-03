import { describe, expect, test } from "bun:test";
import { connectedTreeMatches } from "./ConnectedTreeView";
import { projectWorldTree } from "./treeProjection";
import type { WorldObject } from "./worldObject";

describe("connected Tree search", () => {
  test("finds an observed leaf omitted by rendering and reveals its qualified ancestry on selection", () => {
    const world = fixtureWorld();
    const source = world.leaves[0]!;
    const children = Array.from({ length: 20 }, (_, index) => ({
      ...source,
      id: `observed-${index}`,
      label: index === 19 ? "Needle beyond renderer" : `Ordinary ${index}`,
      taskSummary: undefined,
      focused: false,
    }));
    world.spaces[0]!.children = children;
    world.spaces[0]!.coverage = {
      ...world.spaces[0]!.coverage,
      leaves: 20,
      agents: 20,
      shells: 0,
    };
    world.hosts[0]!.coverage = world.spaces[0]!.coverage;
    world.coverage = world.spaces[0]!.coverage;
    world.leaves = children;
    world.nodes = [...world.hosts, ...world.spaces, ...children];
    world.nodeById = new Map(world.nodes.map((node) => [node.id, node]));
    const projection = projectWorldTree(world);
    expect(
      projection.hosts[0]!.spaces[0]!.children.some(
        ({ id }) => id === "observed-19",
      ),
    ).toBe(false);
    expect(connectedTreeMatches(projection, "needle beyond renderer")).toEqual(
      new Set(["host-a", "space-a", "observed-19"]),
    );
    expect(
      projectWorldTree(world, "observed-19").hosts[0]!.spaces[0]!.children.map(
        ({ id }) => id,
      ),
    ).toContain("observed-19");
  });
  test("keeps complete ancestor context for a matching task without mutating disclosure", () => {
    const matches = connectedTreeMatches(
      projectWorldTree(fixtureWorld()),
      "release checks",
    );
    expect(matches).toEqual(new Set(["host-a", "space-a", "agent-a"]));
  });

  test("includes a complete branch when its host or space matches", () => {
    expect(
      connectedTreeMatches(projectWorldTree(fixtureWorld()), "forge"),
    ).toEqual(new Set(["host-a", "space-a", "agent-a", "terminal-a"]));
    expect(
      connectedTreeMatches(projectWorldTree(fixtureWorld()), "platform"),
    ).toEqual(new Set(["host-a", "space-a", "agent-a", "terminal-a"]));
  });

  test("uses ordinary disclosure when search is clear", () => {
    expect(
      connectedTreeMatches(projectWorldTree(fixtureWorld()), "  "),
    ).toBeNull();
  });
});

function fixtureWorld() {
  const base = {
    nativeId: "native",
    connectionId: "host-a",
    generation: 7,
    hostLabel: "Forge",
    hostState: "active",
    selectedHost: true,
    stale: false,
    actionable: true,
    capabilities: {},
  };
  const agent = {
    ...base,
    id: "agent-a",
    kind: "agent",
    parentId: "space-a",
    label: "Codex",
    status: "working",
    focused: true,
    modelLabel: "GPT",
    taskSummary: "Running release checks",
    stateLabels: {},
  };
  const terminal = {
    ...agent,
    id: "terminal-a",
    kind: "terminal",
    label: "Shell",
    taskSummary: undefined,
  };
  const space = {
    ...base,
    id: "space-a",
    kind: "space",
    parentId: "host-a",
    label: "Platform",
    workspace: { focused: true },
    children: [agent, terminal],
    coverage: {
      spaces: 1,
      tabs: 0,
      leaves: 2,
      agents: 1,
      shells: 1,
      status: { working: 1, idle: 0, blocked: 0, done: 0, unknown: 0 },
    },
  };
  const host = {
    ...base,
    id: "host-a",
    kind: "host",
    parentId: null,
    label: "Forge",
    spaces: [space],
    coverage: space.coverage,
  };
  const nodes = [host, space, agent, terminal];
  return {
    version: 1,
    hosts: [host],
    spaces: [space],
    leaves: [agent, terminal],
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    coverage: space.coverage,
  } as unknown as WorldObject;
}
