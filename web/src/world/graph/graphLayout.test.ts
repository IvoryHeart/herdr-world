import { describe, expect, test } from "bun:test";
import {
  arrangeGraph,
  graphBounds,
  graphNodeRadius,
  reconcileGraphLayout,
  savedGraphPositions,
  stepGraphLayout,
} from "./graphLayout";
import type { WorldGraphNode, WorldGraphProjection } from "./graphProjection";

describe("Graph force layout", () => {
  test("seeds all three qualified tiers deterministically", () => {
    const first = reconcileGraphLayout(null, projection(), new Set()).state;
    const second = reconcileGraphLayout(null, projection(), new Set()).state;
    expect([...first.nodes].map(([id, { x, y }]) => [id, x, y])).toEqual(
      [...second.nodes].map(([id, { x, y }]) => [id, x, y]),
    );
    expect(first.nodes.size).toBe(4);
    expect(first.edges).toHaveLength(3);
    expect(graphBounds(first.nodes.values()).maxX).toBeGreaterThan(
      graphBounds(first.nodes.values()).minX,
    );
  });

  test("reuses settled nodes and pins across status-only refreshes", () => {
    const first = reconcileGraphLayout(null, projection(), new Set()).state;
    const leaf = first.nodes.get("leaf")!;
    leaf.x = 321;
    leaf.y = -87;
    leaf.pinned = true;
    const refreshed = projection();
    refreshed.nodes.find(({ id }) => id === "leaf")!.status = "done";
    const result = reconcileGraphLayout(first, refreshed, new Set());

    expect(result.topologyChanged).toBe(false);
    expect(result.state.nodes.get("leaf")).toBe(leaf);
    expect(result.state.nodes.get("leaf")).toMatchObject({
      x: 321,
      y: -87,
      pinned: true,
      source: { status: "done" },
    });
    expect(savedGraphPositions(result.state).leaf?.pinned).toBe(true);
  });

  test("hides complete descendant branches without dangling edges", () => {
    const hostCollapsed = reconcileGraphLayout(
      null,
      projection(),
      new Set(["host"]),
    ).state;
    expect([...hostCollapsed.nodes.keys()]).toEqual(["host"]);
    expect(hostCollapsed.edges).toEqual([]);

    const spaceCollapsed = reconcileGraphLayout(
      null,
      projection(),
      new Set(["space"]),
    ).state;
    expect([...spaceCollapsed.nodes.keys()]).toEqual(["host", "space"]);
    expect(spaceCollapsed.edges).toEqual([
      { sourceId: "host", targetId: "space", kind: "contains" },
    ]);
    expect(stepGraphLayout(spaceCollapsed, 1)).toBeGreaterThanOrEqual(0);
  });

  test("arrange unpins all nodes and separates overlapping positions", () => {
    const state = reconcileGraphLayout(null, projection(), new Set()).state;
    for (const n of state.nodes.values()) {
      n.x = 0;
      n.y = 0;
      n.pinned = true;
    }

    arrangeGraph(state);

    for (const n of state.nodes.values()) {
      expect(n.pinned).toBe(false);
      expect(n.vx).toBe(0);
      expect(n.vy).toBe(0);
    }

    const positions = [...state.nodes.values()].map(({ id, x, y }) => ({
      id,
      x,
      y,
    }));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        expect(dist).toBeGreaterThan(0);
      }
    }
  });

  test("arrange preserves parent-child proximity", () => {
    const state = reconcileGraphLayout(null, projection(), new Set()).state;
    arrangeGraph(state);

    const host = state.nodes.get("host")!;
    const space = state.nodes.get("space")!;
    const leaf = state.nodes.get("leaf")!;
    const hostRadius = graphNodeRadius("host");
    const spaceRadius = graphNodeRadius("space");

    expect(Math.hypot(space.x - host.x, space.y - host.y)).toBeLessThan(
      hostRadius + spaceRadius + 200,
    );
    expect(Math.hypot(leaf.x - space.x, leaf.y - space.y)).toBeLessThan(
      spaceRadius + graphNodeRadius("agent") + 150,
    );
  });
});

function projection(): WorldGraphProjection {
  const host = node("host", "host", null);
  const space = node("space", "space", "host");
  const leaf = node("leaf", "agent", "space");
  const shell = node("shell", "terminal", "space");
  return {
    version: 1,
    nodes: [host, space, leaf, shell],
    edges: [
      { sourceId: "host", targetId: "space", kind: "contains" },
      { sourceId: "space", targetId: "leaf", kind: "contains" },
      { sourceId: "space", targetId: "shell", kind: "contains" },
    ],
    hosts: [],
    spaces: [],
    omittedHostCount: 0,
    omittedSpaceCount: 0,
    coverage: {
      configuredHosts: 1,
      presentedHosts: 1,
      observedSpaces: 1,
      presentedSpaces: 1,
      observedAgents: 1,
      presentedAgents: 1,
      omittedAgents: 0,
      observedTerminals: 2,
      presentedTerminals: 2,
      omittedTerminals: 0,
      observedShells: 1,
      presentedShells: 1,
    },
    presentationBounds: { hosts: 128, spaces: 128, childrenPerSpace: 16 },
  };
}

function node(
  id: string,
  kind: WorldGraphNode["kind"],
  parentId: string | null,
): WorldGraphNode {
  return {
    id,
    kind,
    parentId,
    label: id,
    hostLabel: "host",
    status: "working",
    focused: false,
    stale: false,
    actionable: true,
    omittedChildCount: 0,
    searchText: id,
    source: {} as WorldGraphNode["source"],
  };
}
