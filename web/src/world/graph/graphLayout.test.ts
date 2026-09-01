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
      nodes: [firstProjection.nodes[0]!, firstProjection.nodes[2]!, firstProjection.nodes[1]!],
      edges: [firstProjection.edges[1]!, firstProjection.edges[0]!],
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
    expect([...collapsed.state.nodes.keys()]).toEqual(["space"]);
    expect(collapsed.state.edges).toHaveLength(0);
  });

  it("repels movable spaces away from pinned spaces without moving the pin", () => {
    const pinnedSource = node({ id: "pinned", kind: "space", parentId: null, selectionKey: "pinned" });
    const movableSource = node({ id: "movable", kind: "space", parentId: null, selectionKey: "movable" });
    const pinned = {
      id: "pinned",
      source: pinnedSource,
      kind: "space" as const,
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
      kind: "space" as const,
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
  const space = node({ id: "space", kind: "space", parentId: null, selectionKey: "space" });
  const agent = node({ id: "agent", kind: "terminal", parentId: "space", selectionKey: "terminal", status });
  const terminals = includeSecond
    ? [agent, node({ id: "agent-2", kind: "terminal", parentId: "space", selectionKey: "terminal-2" })]
    : [agent];
  return {
    version: 1,
    nodes: [space, ...terminals],
    edges: terminals.map(({ id }) => ({ sourceId: "space", targetId: id, kind: "contains" })),
    spaces: [{ node: space, terminals, observedTerminalCount: terminals.length, omittedTerminalCount: 0 }],
    omittedSpaceCount: 0,
    coverage: {
      observedSpaces: 1,
      presentedSpaces: 1,
      observedAgents: terminals.length,
      presentedAgents: terminals.length,
      omittedAgents: 0,
      omittedAgentsInPresentedSpaces: 0,
      omittedAgentsInOmittedSpaces: 0,
      observedTerminals: terminals.length,
      presentedTerminals: terminals.length,
      omittedTerminals: 0,
      observedShells: 0,
      presentedShells: 0,
      status: { idle: 0, working: 1, blocked: 0, done: 0, unknown: 0 },
    },
    presentationBounds: { spaces: 128, terminalsPerSpace: 16 },
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
    actionable: false,
    omittedChildCount: 0,
    searchText: overrides.id,
    handoff: null,
    ...overrides,
    paneId: overrides.paneId ?? (overrides.kind === "terminal" ? overrides.id : null),
    observedGeneration: overrides.observedGeneration ?? "generation",
    agentRunning: overrides.agentRunning ?? overrides.kind === "terminal",
    agentKind: overrides.agentKind ?? null,
  };
}
