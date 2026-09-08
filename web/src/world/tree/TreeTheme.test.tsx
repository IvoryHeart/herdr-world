// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldThemeContext } from "../worldThemeContext";
import type { HerdrGraphProjection, WorldGraphNode } from "../graph/herdrGraphProjection";
import TreeTheme from "./TreeTheme";
import { boundTreeCamera, TREE_VIEW_PREFS_KEY } from "./treeViewPrefs";

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
    expect(agent?.getAttribute("aria-label")).toContain("Agent in Platform on host Forge (host), working");
    expect(agent?.getAttribute("aria-label")).toContain("Double-click to open terminal");
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
    expect(disclosures[1]?.disabled).toBe(true);
    expect(disclosures[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(disclosures[1]?.getAttribute("aria-label")).toContain("expanded for search");
    await act(async () => disclosures[1]?.click());
    await act(async () => setInput(input, ""));
    expect(disclosures[1]?.disabled).toBe(false);
    expect(disclosures[1]?.getAttribute("aria-expanded")).toBe("false");
    await act(async () => setInput(input, "missing"));
    expect(container.querySelector(".tree-results")?.textContent).toBe("No Tree matches");
  });

  it("uses one accessible entity surface with host-qualified ancestry", async () => {
    const value = context();
    value.graphProjection = duplicateProjection(value.graphProjection);
    const { container } = await render(value);
    expect(container.querySelector(".tree-map")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll(".tree-map button")).toHaveLength(0);
    const codexNames = [...container.querySelectorAll<HTMLButtonElement>(".tree-semantic-select")]
      .filter((button) => button.textContent?.includes("Codex"))
      .map((button) => button.getAttribute("aria-label"));
    expect(codexNames).toEqual([
      expect.stringContaining("Codex, Agent in Platform on host Forge (host)"),
      expect.stringContaining("Codex, Agent in Platform on host Forge (host-b)"),
    ]);
    expect(new Set(codexNames).size).toBe(2);
  });

  it("exercises Fit, zoom, wheel, and pointer handlers within camera bounds and persists them", async () => {
    const { container } = await render(context());
    const viewport = container.querySelector<HTMLDivElement>(".tree-viewport");
    const map = container.querySelector<HTMLDivElement>(".tree-map");
    setDimensions(viewport, { clientWidth: 600, clientHeight: 400 });
    setDimensions(map, { scrollWidth: 1_000, scrollHeight: 800 });
    if (viewport) viewport.setPointerCapture = vi.fn();

    const fit = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("Fit tree"));
    await act(async () => fit?.click());
    expect(map?.style.transform).toBe("translate(70px, 16px) scale(0.46)");

    const zoomIn = container.querySelector<HTMLButtonElement>("button[aria-label='Zoom in']");
    const zoomOut = container.querySelector<HTMLButtonElement>("button[aria-label='Zoom out']");
    await act(async () => zoomIn?.click());
    expect(map?.style.transform).not.toContain("scale(0.46)");
    await act(async () => zoomOut?.click());

    await act(async () => { for (let index = 0; index < 60; index += 1) zoomIn?.click(); });
    expect(map?.style.transform).toContain("scale(2.5)");
    await act(async () => { for (let index = 0; index < 100; index += 1) zoomOut?.click(); });
    expect(map?.style.transform).toContain("scale(0.4)");
    await act(async () => { for (let index = 0; index < 4; index += 1) zoomIn?.click(); });

    await act(async () => viewport?.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, deltaX: 80, deltaY: 90,
    })));
    expect(map?.style.transform).toContain("translate(");
    await act(async () => viewport?.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true, cancelable: true, ctrlKey: true, deltaY: -100,
    })));

    await act(async () => {
      viewport?.dispatchEvent(pointerEvent("pointerdown", 40, 30));
      viewport?.dispatchEvent(pointerEvent("pointermove", 10_000, -10_000));
      viewport?.dispatchEvent(pointerEvent("pointerup", 10_000, -10_000));
    });
    const transform = map?.style.transform ?? "";
    expect(transform).toMatch(/^translate\(16px, -[\d.]+px\) scale\([\d.]+\)$/);

    await new Promise((resolve) => window.setTimeout(resolve, 150));
    const saved = JSON.parse(window.localStorage.getItem(TREE_VIEW_PREFS_KEY) ?? "null");
    expect(saved.camera).toEqual(expect.objectContaining({ x: 16 }));
  });

  it("restores a persisted viewport camera", async () => {
    window.localStorage.setItem(TREE_VIEW_PREFS_KEY, JSON.stringify({
      camera: { x: 12, y: -8, zoom: 1.4 },
      collapsedIds: [],
    }));
    const { container } = await render(context());
    expect(container.querySelector<HTMLElement>(".tree-map")?.style.transform)
      .toBe("translate(12px, -8px) scale(1.4)");
  });

  it("reconciles an extreme persisted camera when compact layout becomes desktop", async () => {
    const geometry = {
      viewportWidth: 600,
      viewportHeight: 400,
      mapWidth: 1_000,
      mapHeight: 800,
    };
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tree-viewport") ? geometry.viewportWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tree-viewport") ? geometry.viewportHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tree-map") ? geometry.mapWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("tree-map") ? geometry.mapHeight : 0;
    });
    const persistedCamera = { x: 1_000_000, y: 1_000_000, zoom: 1 };
    window.localStorage.setItem(TREE_VIEW_PREFS_KEY, JSON.stringify({
      camera: persistedCamera,
      collapsedIds: [],
    }));
    const value = context();
    value.compact = true;
    const { container, root } = await render(value);
    expect(container.querySelector(".tree-viewport")).toBeNull();
    expect(container.querySelector(".tree-map")).toBeNull();

    value.compact = false;
    await act(async () => root.render(<TreeTheme context={value} />));

    const expected = boundTreeCamera(persistedCamera, geometry);
    expect(container.querySelector<HTMLElement>(".tree-map")?.style.transform)
      .toBe(`translate(${expected.x}px, ${expected.y}px) scale(${expected.zoom})`);
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
    const agent = [...container.querySelectorAll<HTMLButtonElement>(".tree-semantic-select")]
      .find((button) => button.textContent?.includes("Codex"));
    expect(agent?.getAttribute("aria-label")).not.toContain("Double-click to open terminal");
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

function setDimensions(element: Element | null, dimensions: Record<string, number>) {
  if (!element) return;
  for (const [name, value] of Object.entries(dimensions)) {
    Object.defineProperty(element, name, { configurable: true, value });
  }
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, { bubbles: true, clientX, clientY });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
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

function duplicateProjection(source: HerdrGraphProjection): HerdrGraphProjection {
  const duplicateNodes = source.nodes.map((item) => ({
    ...item,
    id: `${item.id}-b`,
    parentId: item.parentId ? `${item.parentId}-b` : null,
    selectionKey: `${item.selectionKey}-b`,
    hostKey: "host-b",
  }));
  const [host, space, agent] = duplicateNodes;
  if (!host || !space || !agent) return source;
  const duplicateSpace = { node: space, children: [agent], observedChildCount: 1, omittedChildCount: 0 };
  return {
    ...source,
    nodes: [...source.nodes, ...duplicateNodes],
    edges: [...source.edges,
      { sourceId: host.id, targetId: space.id, kind: "contains" as const },
      { sourceId: space.id, targetId: agent.id, kind: "contains" as const }],
    hosts: [...source.hosts, { node: host, spaces: [duplicateSpace], observedSpaceCount: 1, omittedSpaceCount: 0 }],
    spaces: [...source.spaces, duplicateSpace],
  };
}

function node(overrides: Partial<WorldGraphNode> & Pick<WorldGraphNode, "id" | "kind" | "parentId" | "selectionKey">): WorldGraphNode {
  return { hostKey: "host", hostLabel: "Forge", label: overrides.id, status: "working", focused: false,
    stale: false, disconnected: false, connectionState: "compatible", actionable: true,
    omittedChildCount: 0, searchText: [overrides.label, overrides.taskSummary, overrides.stateLabel, "Forge Platform"]
      .filter(Boolean).join(" ").toLocaleLowerCase(), handoff: null, paneId: null,
    observedGeneration: "generation", agentKind: null, ...overrides };
}
