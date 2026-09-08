import { describe, expect, it } from "vitest";

import type { HerdrGraphProjection, WorldGraphNode } from "./herdrGraphProjection";
import { reconcileGraphLayout, stepGraphLayout } from "./graphLayout";

describe("Graph layout reconciliation", () => {
  it("reuses node objects and settled geometry for status-only revisions", () => {
    const first = reconcileGraphLayout(null, projection("working"), new Set());
    const agent = first.state.nodes.get("agent");
    if (!agent) throw new Error("agent missing");
    agent.x = 321;
    agent.y = -45;
    agent.pinned = true;

    const changed = reconcileGraphLayout(first.state, projection("blocked"), new Set());
    expect(changed.topologyChanged).toBe(false);
    expect(changed.state.nodes.get("agent")).toBe(agent);
    expect(changed.state.nodes.get("agent")).toMatchObject({
      x: 321,
      y: -45,
      pinned: true,
      source: { status: "blocked" },
    });
  });

  it("does not treat status-priority reordering as a topology change", () => {
    const firstProjection = projection("idle", true);
    const first = reconcileGraphLayout(null, firstProjection, new Set());
    const reordered = {
      ...firstProjection,
      nodes: [
        firstProjection.nodes[0]!,
        firstProjection.nodes[1]!,
        firstProjection.nodes[3]!,
        firstProjection.nodes[2]!,
      ],
      edges: [firstProjection.edges[0]!, firstProjection.edges[2]!, firstProjection.edges[1]!],
    };

    const changed = reconcileGraphLayout(first.state, reordered, new Set());

    expect(changed.topologyChanged).toBe(false);
    expect(changed.state.nodes.get("agent")).toBe(first.state.nodes.get("agent"));
    expect(changed.state.nodes.get("agent-2")).toBe(first.state.nodes.get("agent-2"));
  });

  it("adds and removes only affected topology and honors collapse", () => {
    const first = reconcileGraphLayout(null, projection("working"), new Set());
    const space = first.state.nodes.get("space");
    const withSecond = reconcileGraphLayout(first.state, projection("working", true), new Set());
    expect(withSecond.topologyChanged).toBe(true);
    expect(withSecond.state.nodes.get("space")).toBe(space);
    expect(withSecond.state.nodes.has("agent-2")).toBe(true);

    const collapsed = reconcileGraphLayout(withSecond.state, projection("working", true), new Set(["space"]));
    expect(collapsed.topologyChanged).toBe(true);
    expect([...collapsed.state.nodes.keys()]).toEqual(["host", "space"]);
    expect(collapsed.state.edges).toHaveLength(1);

    const collapsedHost = reconcileGraphLayout(
      withSecond.state,
      projection("working", true),
      new Set(["host"]),
    );
    expect([...collapsedHost.state.nodes.keys()]).toEqual(["host"]);
    expect(collapsedHost.state.edges).toHaveLength(0);
  });

  it("repels movable hosts away from pinned hosts without moving the pin", () => {
    const pinnedSource = node({ id: "pinned", kind: "host", parentId: null, selectionKey: "pinned" });
    const movableSource = node({ id: "movable", kind: "host", parentId: null, selectionKey: "movable" });
    const pinned = {
      id: "pinned",
      source: pinnedSource,
      kind: "host" as const,
      parentId: null,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      pinned: true,
    };
    const movable = {
      id: "movable",
      source: movableSource,
      kind: "host" as const,
      parentId: null,
      x: 40,
      y: 0,
      vx: 0,
      vy: 0,
      pinned: false,
    };

    stepGraphLayout({
      nodes: new Map([[pinned.id, pinned], [movable.id, movable]]),
      edges: [],
      topologyKey: "two-spaces",
    }, 1);

    expect(pinned).toMatchObject({ x: 0, y: 0, vx: 0, vy: 0 });
    expect(movable.x).toBeGreaterThan(40);
  });
});

function projection(status: WorldGraphNode["status"], includeSecond = false): HerdrGraphProjection {
  const host = node({ id: "host", kind: "host", parentId: null, selectionKey: "host" });
  const space = node({ id: "space", kind: "space", parentId: "host", selectionKey: "space" });
  const agent = node({ id: "agent", kind: "agent", parentId: "space", selectionKey: "terminal", status });
  const children = includeSecond
    ? [agent, node({ id: "agent-2", kind: "agent", parentId: "space", selectionKey: "terminal-2" })]
    : [agent];
  return {
    version: 1,
    nodes: [host, space, ...children],
    edges: [
      { sourceId: "host", targetId: "space", kind: "contains" },
      ...children.map(({ id }) => ({ sourceId: "space", targetId: id, kind: "contains" as const })),
    ],
    hosts: [{
      node: host,
      spaces: [{ node: space, children, observedChildCount: children.length, omittedChildCount: 0 }],
      observedSpaceCount: 1,
      omittedSpaceCount: 0,
    }],
    spaces: [{ node: space, children, observedChildCount: children.length, omittedChildCount: 0 }],
    omittedHostCount: 0,
    omittedSpaceCount: 0,
    coverage: {
      configuredHosts: 1,
      observedHosts: 1,
      presentedHosts: 1,
      omittedHosts: 0,
      observedSpaces: 1,
      presentedSpaces: 1,
      observedAgents: children.length,
      presentedAgents: children.length,
      omittedAgents: 0,
      omittedAgentsInPresentedSpaces: 0,
      omittedAgentsInOmittedSpaces: 0,
      observedTerminals: children.length,
      presentedTerminals: children.length,
      omittedTerminals: 0,
      observedShells: 0,
      presentedShells: 0,
      status: { idle: 0, working: 1, blocked: 0, done: 0, unknown: 0 },
    },
    presentationBounds: { hosts: 128, spaces: 128, childrenPerSpace: 16 },
  };
}

function node(overrides: Partial<WorldGraphNode> & Pick<WorldGraphNode, "id" | "kind" | "parentId" | "selectionKey">): WorldGraphNode {
  return {
    hostKey: "host",
    hostLabel: "Host",
    label: overrides.id,
    status: "unknown",
    focused: false,
    stale: false,
    disconnected: false,
    connectionState: "compatible",
    actionable: false,
    omittedChildCount: 0,
    searchText: overrides.id,
    handoff: null,
    ...overrides,
    paneId: overrides.paneId ?? (
      overrides.kind === "terminal" || overrides.kind === "agent" ? overrides.id : null
    ),
    observedGeneration: overrides.observedGeneration ?? "generation",
    agentKind: overrides.agentKind ?? null,
  };
}
