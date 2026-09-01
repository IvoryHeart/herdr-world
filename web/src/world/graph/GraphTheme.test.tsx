// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WorldThemeContext } from "../worldThemeContext";
import type { HerdrGraphProjection, WorldGraphNode } from "./herdrGraphProjection";
import GraphTheme from "./GraphTheme";

vi.mock("./GraphCanvas", () => ({
  GraphCanvas: () => <div data-testid="graph-canvas" />,
}));

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Graph semantic interface", () => {
  it("keeps selection inspection-only and delegates only explicit Open in Spaces", async () => {
    const value = context();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<GraphTheme context={value} />));

    const agentSelect = [...container.querySelectorAll<HTMLButtonElement>(".graph-tree-agent")]
      .find((button) => button.textContent?.includes("Codex"));
    await act(async () => agentSelect?.click());
    expect(value.onGraphSelect).toHaveBeenCalledWith("terminal", "host");
    expect(value.onOpenInSpaces).not.toHaveBeenCalled();

    value.selectedKey = "terminal";
    await act(async () => root.render(<GraphTheme context={value} />));
    expect(container.querySelector(".graph-details")?.textContent).toContain("Reviewing Graph");
    await act(async () => container.querySelector<HTMLButtonElement>(".graph-details button")?.click());
    expect(value.onOpenInSpaces).toHaveBeenCalledTimes(1);
    expect(value.onOpenInSpaces).toHaveBeenCalledWith(expect.objectContaining({ kind: "agent" }));
  });

  it("searches bounded semantic fields and supports per-space collapse", async () => {
    const value = context();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(<GraphTheme context={value} />));
    expect(container.querySelector(".graph-tree-agent")).not.toBeNull();

    const collapse = container.querySelector<HTMLButtonElement>(".graph-collapse");
    await act(async () => collapse?.click());
    expect(collapse?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelector(".graph-tree-agent")).toBeNull();
    await act(async () => collapse?.click());

    const input = container.querySelector<HTMLInputElement>("input[type='search']");
    await act(async () => {
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
        setter?.call(input, "not-present");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    expect(container.querySelector(".graph-empty")?.textContent).toContain("No presented spaces");
  });
});

function context(): WorldThemeContext {
  const onGraphSelect = vi.fn();
  const onOpenInSpaces = vi.fn();
  return {
    graphProjection: projection(),
    projection: {
      version: 1,
      generatedAt: 0,
      hosts: [],
      rooms: [],
      receptions: [],
      barAgents: [],
      roomRoster: [],
      deskRoster: [],
      roster: [],
      unresolved: [],
      coverage: {},
      presentationBounds: {},
    } as unknown as WorldThemeContext["projection"],
    observability: {
      health: "unavailable",
      providerId: null,
      sourceCount: 0,
      configuredSourceCount: 0,
      failedSourceCount: 0,
      observedAt: 0,
      windowSeconds: null,
      models: [],
      totalCostUsd: null,
      totalUsage: 0,
    },
    selectedKey: null,
    completionSeenKeys: new Set(),
    onSelect: vi.fn(),
    onGraphSelect,
    compact: false,
    onBackToSidebar: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenInSpaces,
    handoffStatus: null,
    conversationBubbles: [],
    onCloseConversation: vi.fn(),
    onFocusConversation: vi.fn(),
    agentActivityTransitions: new Map(),
    roomAlignment: "left",
    longRoomTitleMode: "expand",
    canCreateSeat: () => false,
    onNewSeat: vi.fn(),
    canCreateRoom: () => false,
    onCreateRoom: vi.fn(),
    canRenameRoom: () => false,
    onRenameRoom: vi.fn(),
    canCloseRoom: () => false,
    onCloseRoom: vi.fn(),
  };
}

function projection(): HerdrGraphProjection {
  const space = node({
    id: "space",
    kind: "space",
    parentId: null,
    selectionKey: "space",
    label: "Platform",
    hostLabel: "Forge",
    omittedChildCount: 2,
    handoff: {
      kind: "room",
      key: "space",
      profileId: "host",
      observedGeneration: "generation",
      workspaceRef: { profileId: "host", kind: "workspace", nativeTargetId: "space" },
    },
  });
  const agent = node({
    id: "agent",
    kind: "agent",
    parentId: "space",
    selectionKey: "terminal",
    label: "Codex",
    status: "working",
    stateLabel: "Implementing",
    taskSummary: "Reviewing Graph",
    handoff: {
      kind: "agent",
      key: "terminal",
      profileId: "host",
      observedGeneration: "generation",
      terminalRef: { profileId: "host", kind: "terminal", nativeTargetId: "terminal" },
      currentPaneRef: { profileId: "host", kind: "pane", nativeTargetId: "pane" },
    },
  });
  return {
    version: 1,
    nodes: [space, agent],
    edges: [{ sourceId: "space", targetId: "agent", kind: "contains" }],
    spaces: [{ node: space, agents: [agent], observedAgentCount: 3, omittedAgentCount: 2 }],
    omittedSpaceCount: 1,
    coverage: {
      observedSpaces: 2,
      presentedSpaces: 1,
      observedAgents: 3,
      presentedAgents: 1,
      omittedAgents: 2,
      omittedAgentsInPresentedSpaces: 2,
      omittedAgentsInOmittedSpaces: 0,
      status: { idle: 0, working: 1, blocked: 0, done: 0, unknown: 2 },
    },
    presentationBounds: { spaces: 128, agentsPerSpace: 16 },
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
    actionable: true,
    omittedChildCount: 0,
    searchText: [overrides.label, overrides.taskSummary, overrides.stateLabel, "Forge"]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase(),
    handoff: null,
    ...overrides,
  };
}
