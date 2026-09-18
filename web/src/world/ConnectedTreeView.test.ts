import { describe, expect, test } from "bun:test";
import { connectedTreeMatches } from "./ConnectedTreeView";
import { projectWorldTree } from "./treeProjection";
import type { WorldObject } from "./worldObject";

describe("connected Tree search", () => {
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
  };
  const host = {
    ...base,
    id: "host-a",
    kind: "host",
    parentId: null,
    label: "Forge",
    spaces: [space],
  };
  const nodes = [host, space, agent, terminal];
  return {
    version: 1,
    omittedHostCount: 0,
    hosts: [host],
    spaces: [space],
    leaves: [agent, terminal],
    nodes,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
  } as unknown as WorldObject;
}
