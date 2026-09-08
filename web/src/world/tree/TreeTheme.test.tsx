// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldThemeContext } from "../worldThemeContext";
import type { HerdrGraphProjection, WorldGraphNode } from "../graph/herdrGraphProjection";
import TreeTheme from "./TreeTheme";

const roots: Root[] = [];

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
});
afterEach(async () => {
  await act(async () => { for (const root of roots.splice(0)) root.unmount(); });
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Tree theme", () => {
  it("keeps selection side-effect-free and exposes guarded details and actions", async () => {
    const value = context();
    const { container, root } = await render(value);
    const agent = [...container.querySelectorAll<HTMLButtonElement>(".tree-semantic-select")]
      .find((button) => button.textContent?.includes("Codex"));
    expect(agent?.getAttribute("aria-label")).toContain("Agent, working");
    await act(async () => agent?.click());
    expect(value.onGraphSelect).toHaveBeenCalledWith("terminal", "host");
    expect(value.onGraphOpenTerminal).not.toHaveBeenCalled();

    value.selectedKey = "terminal";
    await act(async () => root.render(<TreeTheme context={value} />));
    expect(container.querySelector(".tree-ancestry")?.textContent).toBe("Forge → Platform → Codex");
    expect(container.querySelector(".tree-details")?.textContent).toContain("Reviewing Tree");
    const actions = [...container.querySelectorAll<HTMLButtonElement>(".tree-details-actions button")];
    expect(actions.map(({ textContent }) => textContent)).toEqual(["Open terminal", "Open in Spaces"]);
    await act(async () => actions[0]?.click());
    expect(value.onGraphOpenTerminal).toHaveBeenCalledWith(expect.objectContaining({ id: "agent" }));
  });

  it("retains ancestor context in search and independently collapses host and space", async () => {
    const value = context();
    const { container } = await render(value);
    const disclosures = [...container.querySelectorAll<HTMLButtonElement>(".tree-disclosure")];
    await act(async () => disclosures[1]?.click());
    expect(disclosures[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".tree-semantic-select")).toHaveLength(2);

    const input = container.querySelector<HTMLInputElement>("input[type='search']");
    await act(async () => setInput(input, "Reviewing Tree"));
    expect(container.querySelector(".tree-semantic")?.textContent).toContain("Forge");
    expect(container.querySelector(".tree-semantic")?.textContent).toContain("Platform");
    expect(container.querySelector(".tree-semantic")?.textContent).toContain("Codex");
    await act(async () => setInput(input, "missing"));
    expect(container.querySelector(".tree-results")?.textContent).toBe("No Tree matches");
  });

  it("does not expose actions for stale entities", async () => {
    const value = context();
    for (const node of value.graphProjection.nodes) {
      node.actionable = false; node.stale = true; node.connectionState = "offline"; node.disconnected = true;
    }
    value.selectedKey = "terminal";
    const { container } = await render(value);
    expect(container.querySelector(".tree-details-actions")).toBeNull();
    expect(container.querySelector(".tree-action-unavailable")?.textContent).toContain("unavailable");
    expect(container.querySelectorAll(".tree-actions button")).toHaveLength(0);
  });
});

async function render(value: WorldThemeContext) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<TreeTheme context={value} />));
  return { container, root };
}

function setInput(input: HTMLInputElement | null, value: string) {
  if (!input) return;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function context(): WorldThemeContext {
  return {
    projection: {} as WorldThemeContext["projection"], graphProjection: projection(), selectedKey: null,
    onSelect: vi.fn(), onGraphSelect: vi.fn(), onGraphOpenTerminal: vi.fn(), onGraphOpenInSpaces: vi.fn(),
    onBackToSidebar: vi.fn(), onToggleSidebar: vi.fn(), onOpenInSpaces: vi.fn(),
    roomAlignment: "left", longRoomTitleMode: "expand", canCreateSeat: vi.fn(() => false),
    onNewSeat: vi.fn(), canCreateRoom: vi.fn(() => false), onCreateRoom: vi.fn(),
    canRenameRoom: vi.fn(() => false), onRenameRoom: vi.fn(), canCloseRoom: vi.fn(() => false),
    onCloseRoom: vi.fn(), compact: false, handoffStatus: null, completionSeenKeys: new Set(),
    observability: {} as WorldThemeContext["observability"], conversationBubbles: [],
    onCloseConversation: vi.fn(), onFocusConversation: vi.fn(), agentActivityTransitions: new Map(),
  };
}

function projection(): HerdrGraphProjection {
  const host = node({ id: "host", kind: "host", parentId: null, selectionKey: "host", label: "Forge", actionable: false });
  const space = node({ id: "space", kind: "space", parentId: "host", selectionKey: "space", label: "Platform" });
  const agent = node({ id: "agent", kind: "agent", parentId: "space", selectionKey: "terminal", label: "Codex",
    taskSummary: "Reviewing Tree", stateLabel: "Implementing", paneId: "pane", agentKind: "codex" });
  const graphSpace = { node: space, children: [agent], observedChildCount: 1, omittedChildCount: 0 };
  return {
    version: 1, nodes: [host, space, agent], edges: [
      { sourceId: "host", targetId: "space", kind: "contains" },
      { sourceId: "space", targetId: "agent", kind: "contains" },
    ], hosts: [{ node: host, spaces: [graphSpace], observedSpaceCount: 1, omittedSpaceCount: 0 }],
    spaces: [graphSpace], omittedHostCount: 0, omittedSpaceCount: 0,
    coverage: { configuredHosts: 1, observedHosts: 1, presentedHosts: 1, omittedHosts: 0,
      observedSpaces: 1, presentedSpaces: 1, observedAgents: 1, presentedAgents: 1,
      omittedAgents: 0, omittedAgentsInPresentedSpaces: 0, omittedAgentsInOmittedSpaces: 0,
      observedTerminals: 1, presentedTerminals: 1, omittedTerminals: 0, observedShells: 0,
      presentedShells: 0, status: { idle: 0, working: 1, blocked: 0, done: 0, unknown: 0 } },
    presentationBounds: { hosts: 128, spaces: 128, childrenPerSpace: 16 },
  };
}

function node(overrides: Partial<WorldGraphNode> & Pick<WorldGraphNode, "id" | "kind" | "parentId" | "selectionKey">): WorldGraphNode {
  return { hostKey: "host", hostLabel: "Forge", label: overrides.id, status: "working", focused: false,
    stale: false, disconnected: false, connectionState: "compatible", actionable: true,
    omittedChildCount: 0, searchText: [overrides.label, overrides.taskSummary, overrides.stateLabel, "Forge Platform"]
      .filter(Boolean).join(" ").toLocaleLowerCase(), handoff: null, paneId: null,
    observedGeneration: "generation", agentKind: null, ...overrides };
}
