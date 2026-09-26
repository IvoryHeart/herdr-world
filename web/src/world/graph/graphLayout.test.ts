import { describe, expect, test } from "bun:test";
import {
  arrangeGraphLayout,
  graphBounds,
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

  test("arranges stacked and pinned visible nodes without changing links", () => {
    const graph = projection();
    for (let index = 0; index < 12; index += 1) {
      const id = `leaf-${index}`;
      graph.nodes.push(node(id, index % 2 ? "terminal" : "agent", "space"));
      graph.edges.push({ sourceId: "space", targetId: id, kind: "contains" });
    }
    const state = reconcileGraphLayout(null, graph, new Set()).state;
    const edges = [...state.edges];
    for (const value of state.nodes.values()) {
      value.x = 0;
      value.y = 0;
      value.pinned = true;
    }

    arrangeGraphLayout(state);

    expect(state.edges).toEqual(edges);
    expect([...state.nodes.values()].every((value) => value.pinned)).toBe(true);
    const nodes = [...state.nodes.values()];
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        const a = nodes[left]!;
        const b = nodes[right]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          a.kind === "host" || b.kind === "host" ? 100 : 88,
        );
      }
    }
  });

  test("wraps nine host groups within a normal Fit viewport", () => {
    const graph = projection();
    graph.nodes = [];
    graph.edges = [];
    for (let hostIndex = 0; hostIndex < 9; hostIndex += 1) {
      const hostId = `host-${hostIndex}`;
      const spaceId = `space-${hostIndex}`;
      graph.nodes.push(node(hostId, "host", null));
      graph.nodes.push(node(spaceId, "space", hostId));
      graph.edges.push({
        sourceId: hostId,
        targetId: spaceId,
        kind: "contains",
      });
      for (let leafIndex = 0; leafIndex < 4; leafIndex += 1) {
        const leafId = `leaf-${hostIndex}-${leafIndex}`;
        graph.nodes.push(node(leafId, "agent", spaceId));
        graph.edges.push({
          sourceId: spaceId,
          targetId: leafId,
          kind: "contains",
        });
      }
    }
    const state = reconcileGraphLayout(null, graph, new Set()).state;

    arrangeGraphLayout(state);

    const bounds = graphBounds(state.nodes.values());
    expect(bounds.maxX - bounds.minX).toBeLessThanOrEqual((1280 - 96) / 0.25);
    expect(bounds.maxY - bounds.minY).toBeLessThanOrEqual((900 - 96) / 0.25);
    expect(
      new Set([...state.nodes.values()].map(({ x, y }) => `${x},${y}`)).size,
    ).toBe(54);
    expect(state.edges).toHaveLength(45);
  });

  test("keeps arranged positions through remount and a new agent", () => {
    const graph = projection();
    const arranged = reconcileGraphLayout(null, graph, new Set()).state;
    arrangeGraphLayout(arranged);
    const positions = savedGraphPositions(arranged);
    const remounted = reconcileGraphLayout(
      null,
      graph,
      new Set(),
      positions,
    ).state;
    for (let index = 0; index < 80; index += 1) {
      stepGraphLayout(remounted, 1);
    }
    for (const [id, position] of Object.entries(positions)) {
      expect(remounted.nodes.get(id)).toMatchObject(position);
    }

    const grown = projection();
    grown.nodes.push(node("new-agent", "agent", "space"));
    grown.edges.push({
      sourceId: "space",
      targetId: "new-agent",
      kind: "contains",
    });
    const updated = reconcileGraphLayout(remounted, grown, new Set()).state;
    for (let index = 0; index < 80; index += 1) {
      stepGraphLayout(updated, 1);
    }
    for (const [id, position] of Object.entries(positions)) {
      expect(updated.nodes.get(id)).toMatchObject(position);
    }
    expect(updated.nodes.get("new-agent")).toBeDefined();
    expect(updated.edges).toHaveLength(graph.edges.length + 1);
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
