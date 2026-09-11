import { describe, expect, it } from "vitest";
import type { BridgeRuntime } from "../bridge";
import type { Snapshot } from "../types";
import type { HerdrGraphProjection, WorldGraphNode } from "./graph/herdrGraphProjection";
import type { OfficeHandoffRequest } from "./herdrOfficeHandoff";
import { admitCurrentWorldSpace, admitCurrentWorldTerminal } from "./worldNodeAdmission";

describe("World Graph/Tree space admission", () => {
  it("rejects a rendered space after replacement or identity drift", () => {
    const rendered = spaceNode();
    expect(admitCurrentWorldSpace(rendered, projectionWith(rendered))).toEqual({
      node: rendered,
      handoff: rendered.handoff,
    });
    expect(admitCurrentWorldSpace(rendered, projectionWith({
      ...rendered,
      observedGeneration: "replacement-generation",
      handoff: spaceHandoff("replacement-generation"),
    }))).toBeNull();
    expect(admitCurrentWorldSpace(rendered, projectionWith({ ...rendered, hostKey: "collision" }))).toBeNull();
    expect(admitCurrentWorldSpace(rendered, projectionWith({ ...rendered, parentId: "replacement-host" }))).toBeNull();
    expect(admitCurrentWorldSpace(rendered, projectionWith({ ...rendered, actionable: false, handoff: null }))).toBeNull();
  });
});

describe("World Graph/Tree terminal admission", () => {
  it("admits only the exact current host, generation, identity, capability, and pane", () => {
    const rendered = node();
    const projection = { nodes: [rendered] } as HerdrGraphProjection;
    const runtime = runtimeFixture();
    const state = stateFixture();
    expect(admitCurrentWorldTerminal(rendered, projection, runtime, state)).toMatchObject({
      node: rendered, runtime, pane: { pane_id: "pane" },
    });

    expect(admitCurrentWorldTerminal(rendered, projection, { ...runtime, id: "other" }, state)).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, projection, { ...runtime, generationKey: "replaced" }, state)).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, projection, runtime, { ...state, connectionKey: "stale" })).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, projection, { ...runtime, canConnect: false }, state)).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, projection, {
      ...runtime, capabilities: { ...runtime.capabilities!, features: ["snapshot"] },
    }, state)).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, { nodes: [] } as unknown as HerdrGraphProjection, runtime, state)).toBeNull();
    expect(admitCurrentWorldTerminal({ ...rendered, selectionKey: "collision" }, projection, runtime, state)).toBeNull();
    expect(admitCurrentWorldTerminal(rendered, projection, runtime, {
      ...state, snapshot: { ...state.snapshot!, panes: [] },
    })).toBeNull();
  });
});

function node(): WorldGraphNode {
  return {
    id: "qualified-terminal", kind: "agent", parentId: "space", hostKey: "host",
    hostLabel: "Host", label: "Codex", status: "working", focused: true, stale: false,
    disconnected: false, connectionState: "compatible", actionable: true,
    selectionKey: "qualified-terminal", omittedChildCount: 0, searchText: "codex",
    handoff: null, paneId: "pane", observedGeneration: "generation", agentKind: "codex",
  };
}

function spaceNode(): WorldGraphNode {
  return {
    id: "qualified-space", kind: "space", parentId: "host-node", hostKey: "host",
    hostLabel: "Host", label: "Space", status: "working", focused: true, stale: false,
    disconnected: false, connectionState: "compatible", actionable: true,
    selectionKey: "qualified-space", omittedChildCount: 0, searchText: "space",
    handoff: spaceHandoff("generation"), paneId: null, observedGeneration: "generation", agentKind: null,
  };
}

function spaceHandoff(observedGeneration: string): OfficeHandoffRequest {
  return {
    kind: "room", key: "qualified-space", profileId: "host", observedGeneration,
    workspaceRef: { profileId: "host", kind: "workspace", nativeTargetId: "space" },
  };
}

function projectionWith(node: WorldGraphNode): HerdrGraphProjection {
  return { nodes: [node] } as HerdrGraphProjection;
}

function runtimeFixture(): BridgeRuntime {
  return {
    id: "host", generationKey: "generation", canConnect: true, capabilityState: "ready",
    capabilities: { features: ["snapshot", "terminal_attach"] },
  } as BridgeRuntime;
}

function stateFixture() {
  const snapshot = {
    workspaces: [], tabs: [], layouts: [], selected_pane_id: "pane",
    panes: [{ pane_id: "pane", terminal_id: "terminal", workspace_id: "space", tab_id: "tab",
      focused: true, agent_status: "working", revision: 1 }],
  } as Snapshot;
  return { connectionKey: "generation", snapshot, loadState: "ready" as const };
}
