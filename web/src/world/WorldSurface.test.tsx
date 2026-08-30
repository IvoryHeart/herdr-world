/**
 * @vitest-environment jsdom
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type { PublishedOfficeLayout } from "./officeLayout";
import WorldSurface from "./WorldSurface";
import type { WorldSurfaceContext } from "./WorldSurface";

const roots: Root[] = [];

vi.mock("./PixelOfficeCanvas", () => ({
  PixelOfficeCanvas: ({
    children,
    onLayoutChange,
    onCanvasRendered,
  }: {
    children?: ReactNode;
    onLayoutChange?: (layout: PublishedOfficeLayout | null) => void;
    onCanvasRendered?: (revision: number) => void;
  }) => (
    <div className="world-stage-scroll">
      <button type="button" data-testid="publish-revision-7" onClick={() => onLayoutChange?.(layout(7))} />
      <button type="button" data-testid="publish-revision-8" onClick={() => onLayoutChange?.(layout(8))} />
      <button type="button" data-testid="ack-revision-7" onClick={() => onCanvasRendered?.(7)} />
      <button type="button" data-testid="ack-revision-8" onClick={() => onCanvasRendered?.(8)} />
      {children}
    </div>
  ),
}));

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("ResizeObserver", class {
    observe() {}
    disconnect() {}
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) {
      root.unmount();
    }
  });
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("WorldSurface Agent Bar revision gating", () => {
  it("keeps the mounted overlay inert across a layout revision race", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);

    await act(async () => {
      root.render(<WorldSurface context={context()} />);
    });

    const agentBar = () => container.querySelector<HTMLElement>(".world-canvas-agent-bar");
    const agentButton = () => container.querySelector<HTMLButtonElement>(".world-agent-bar-item");
    expect(agentBar()?.getAttribute("aria-hidden")).toBe("true");
    expect(agentButton()?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='publish-revision-7']")?.click();
    });
    expect(agentBar()?.getAttribute("aria-hidden")).toBe("true");
    expect(agentButton()?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='ack-revision-7']")?.click();
    });
    expect(agentBar()?.getAttribute("aria-hidden")).toBe("false");
    expect(agentButton()?.disabled).toBe(false);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='publish-revision-8']")?.click();
      container.querySelector<HTMLButtonElement>("[data-testid='ack-revision-7']")?.click();
    });
    expect(agentBar()?.getAttribute("aria-hidden")).toBe("true");
    expect(agentButton()?.disabled).toBe(true);

    await act(async () => {
      container.querySelector<HTMLButtonElement>("[data-testid='ack-revision-8']")?.click();
    });
    expect(agentBar()?.getAttribute("aria-hidden")).toBe("false");
    expect(agentButton()?.disabled).toBe(false);
  });

  it("provides a compact semantic chooser that selects the exact agent", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    roots.push(root);
    const worldContext = context();
    const agent = {
      ...worldContext.projection.barAgents[0],
      hostKey: "host-a",
      roomKey: "room-a",
      deskKey: "desk-a",
      canOpenInSpaces: true,
    };
    worldContext.compact = true;
    worldContext.projection.roster = [{
      agent,
      roomKey: "room-a",
      roomLabel: "Platform",
      hostKey: "host-a",
      hostLabel: "Forge",
      roomPresented: true,
      deskPresented: true,
      destinationPresented: true,
    }];

    await act(async () => {
      root.render(<WorldSurface context={worldContext} />);
    });

    const chooser = container.querySelector<HTMLDetailsElement>(".world-compact-target-chooser");
    const target = container.querySelector<HTMLButtonElement>(
      ".world-compact-target-select[data-target-key='agent-a']",
    );
    expect(chooser).not.toBeNull();
    expect(target?.textContent).toContain("Agent A");
    expect(target?.textContent).toContain("Ready");

    await act(async () => target?.click());

    expect(worldContext.onSelect).toHaveBeenCalledWith("agent-a");
  });
});

function layout(revision: number) {
  return {
    layoutRevision: revision,
    agentBarRect: { x: 600, y: 4, width: 360, height: 206 },
    officeWidth: 1000,
    totalHeight: 600,
    roomStartY: 246,
    rooms: [],
    overflowMarker: undefined,
  } as unknown as PublishedOfficeLayout;
}

function context(): WorldSurfaceContext {
  const agent = {
    key: "agent-a",
    displayLabel: "Agent A",
    semanticStatus: "done",
    stateLabels: { done: "Done" },
    stale: false,
    characterIndex: 0,
    taskSummary: "Ready",
  };
  const projection = {
    version: 1,
    generatedAt: 1,
    hosts: [],
    rooms: [],
    receptions: [],
    barAgents: [agent],
    roomRoster: [],
    deskRoster: [],
    roster: [],
    unresolved: [],
    coverage: { omittedBarAgents: 0 },
    presentationBounds: {},
  } as unknown as HerdrOfficeProjection;
  return {
    projection,
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
    compact: false,
    onBackToSidebar: vi.fn(),
    onToggleSidebar: vi.fn(),
    onOpenInSpaces: vi.fn(),
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
