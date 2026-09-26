import { describe, expect, test } from "bun:test";
import {
  arrangeGraph,
  graphBounds,
  graphNodeRadius,
  reconcileGraphLayout,
  savedGraphPositions,
  separateOverlaps,
  stepGraphLayout,
} from "./graphLayout";
import type { GraphLayoutState } from "./graphLayout";
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

  test("arrange unpins all nodes and separates by radii", () => {
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

    const all = [...state.nodes.values()];
    for (let i = 0; i < all.length; i++) {
      const a = all[i]!;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j]!;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const minSep = graphNodeRadius(a.kind) + graphNodeRadius(b.kind);
        expect(dist).toBeGreaterThanOrEqual(minSep);
      }
    }
  });

  test("arrange separates cross-tier overlaps after settling", () => {
    const state = reconcileGraphLayout(
      null,
      multiSpaceProjection(),
      new Set(),
    ).state;

    arrangeAndSettle(state);
    assertNoCircleOverlaps(state);
  });

  test("arrange keeps dense graph separated after settling", () => {
    const state = reconcileGraphLayout(
      null,
      denseProjection(8, 12),
      new Set(),
    ).state;

    arrangeAndSettle(state);
    assertNoCircleOverlaps(state);
  });

  test("arrange preserves parent-child proximity", () => {
    const state = reconcileGraphLayout(null, projection(), new Set()).state;
    arrangeGraph(state);

    const host = state.nodes.get("host")!;
    const space = state.nodes.get("space")!;
    const leaf = state.nodes.get("leaf")!;

    expect(Math.hypot(space.x - host.x, space.y - host.y)).toBeLessThan(
      graphNodeRadius("host") + graphNodeRadius("space") + 200,
    );
    expect(Math.hypot(leaf.x - space.x, leaf.y - space.y)).toBeLessThan(
      graphNodeRadius("space") + graphNodeRadius("agent") + 150,
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

function multiSpaceProjection(): WorldGraphProjection {
  const host = node("host", "host", null);
  const s1 = node("space1", "space", "host");
  const s2 = node("space2", "space", "host");
  const l1 = node("leaf1", "agent", "space1");
  const l2 = node("leaf2", "agent", "space2");
  return {
    version: 1,
    nodes: [host, s1, s2, l1, l2],
    edges: [
      { sourceId: "host", targetId: "space1", kind: "contains" },
      { sourceId: "host", targetId: "space2", kind: "contains" },
      { sourceId: "space1", targetId: "leaf1", kind: "contains" },
      { sourceId: "space2", targetId: "leaf2", kind: "contains" },
    ],
    hosts: [],
    spaces: [],
    omittedHostCount: 0,
    omittedSpaceCount: 0,
    coverage: {
      configuredHosts: 1,
      presentedHosts: 1,
      observedSpaces: 2,
      presentedSpaces: 2,
      observedAgents: 2,
      presentedAgents: 2,
      omittedAgents: 0,
      observedTerminals: 0,
      presentedTerminals: 0,
      omittedTerminals: 0,
      observedShells: 0,
      presentedShells: 0,
    },
    presentationBounds: { hosts: 128, spaces: 128, childrenPerSpace: 16 },
  };
}

function denseProjection(
  spaceCount: number,
  leavesPerSpace: number,
): WorldGraphProjection {
  const host = node("host", "host", null);
  const nodes: WorldGraphNode[] = [host];
  const edges: WorldGraphProjection["edges"] = [];
  for (let s = 0; s < spaceCount; s++) {
    const spaceId = `s${s}`;
    nodes.push(node(spaceId, "space", "host"));
    edges.push({ sourceId: "host", targetId: spaceId, kind: "contains" });
    for (let l = 0; l < leavesPerSpace; l++) {
      const leafId = `s${s}l${l}`;
      nodes.push(node(leafId, "agent", spaceId));
      edges.push({ sourceId: spaceId, targetId: leafId, kind: "contains" });
    }
  }
  return {
    version: 1,
    nodes,
    edges,
    hosts: [],
    spaces: [],
    omittedHostCount: 0,
    omittedSpaceCount: 0,
    coverage: {
      configuredHosts: 1,
      presentedHosts: 1,
      observedSpaces: spaceCount,
      presentedSpaces: spaceCount,
      observedAgents: spaceCount * leavesPerSpace,
      presentedAgents: spaceCount * leavesPerSpace,
      omittedAgents: 0,
      observedTerminals: 0,
      presentedTerminals: 0,
      omittedTerminals: 0,
      observedShells: 0,
      presentedShells: 0,
    },
    presentationBounds: { hosts: 128, spaces: 128, childrenPerSpace: 16 },
  };
}

function arrangeAndSettle(state: GraphLayoutState) {
  arrangeGraph(state);
  let alpha = 1;
  for (let i = 0; i < 300; i++) {
    const energy = stepGraphLayout(state, alpha);
    alpha *= energy < 0.08 ? 0.78 : 0.93;
    if (alpha <= 0.015) break;
  }
  separateOverlaps([...state.nodes.values()]);
}

function assertNoCircleOverlaps(state: GraphLayoutState) {
  const all = [...state.nodes.values()];
  const overlaps: string[] = [];
  for (let i = 0; i < all.length; i++) {
    const a = all[i]!;
    for (let j = i + 1; j < all.length; j++) {
      const b = all[j]!;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const minSep = graphNodeRadius(a.kind) + graphNodeRadius(b.kind);
      if (dist < minSep) {
        overlaps.push(`${a.id}/${b.id} dist=${dist.toFixed(1)} min=${minSep}`);
      }
    }
  }
  expect(overlaps).toEqual([]);
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
