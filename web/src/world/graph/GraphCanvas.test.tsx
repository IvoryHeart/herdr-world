// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  GraphCanvas,
  graphConversationCameraNudge,
  graphTerminalGlyphKind,
  LatestFrameValue,
} from "./GraphCanvas";
import type { HerdrGraphProjection, WorldGraphNode } from "./herdrGraphProjection";
import type { GraphCamera, SavedGraphPosition } from "./graphViewPrefs";

const roots: Root[] = [];
let resizeCallback: ResizeObserverCallback | null = null;
let nextFrameId = 1;
let frames = new Map<number, FrameRequestCallback>();

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true;
  delete window.__HERDR_GRAPH_RENDERER__;
  frames = new Map();
  nextFrameId = 1;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    frames.delete(id);
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 800,
    bottom: 600,
    left: 0,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) {
      resizeCallback = callback;
    }
    observe() {}
    disconnect() {}
  });
});

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
  resizeCallback = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Graph renderer ownership", () => {
  it("coalesces 300 raw resize values and applies only the latest", () => {
    const applied: number[] = [];
    const coalescer = new LatestFrameValue<number>((value) => applied.push(value));
    for (let index = 0; index < 300; index += 1) coalescer.push(index);
    expect(frames.size).toBe(1);
    flushOneFrame();
    expect(applied).toEqual([299]);
    coalescer.cancel();
  });

  it("returns observer, listener, frame, canvas, and retained topology ownership to baseline", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => root.render(
      <GraphCanvas
        projection={emptyProjection()}
        collapsedIds={new Set()}
        selectedKey={null}
        matchedIds={null}
        conversationTargets={[]}
        initialPrefs={{ camera: { x: 0, y: 0, zoom: 1 }, collapsedIds: [], positions: {} }}
        onSelect={() => {}}
        onActivate={() => {}}
        onToggleCollapse={() => {}}
        onViewChange={() => {}}
      />,
    ));
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      mounts: 1,
      destroys: 0,
      activeRenderers: 1,
      activeObservers: 1,
      activeListeners: 7,
      canvases: 1,
      ready: true,
    });
    flushAllFrames();

    for (let index = 0; index < 300; index += 1) {
      resizeCallback?.([
        { contentRect: { width: 500 + index, height: 300 + index } } as ResizeObserverEntry,
      ], {} as ResizeObserver);
    }
    expect(frames.size).toBe(1);
    flushOneFrame();
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      resizeObservations: 300,
      resizeFrames: 1,
    });

    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      mounts: 1,
      destroys: 1,
      activeRenderers: 0,
      activeAnimationFrames: 0,
      activeObservers: 0,
      activeConversationObservers: 0,
      activeListeners: 0,
      canvases: 0,
      ready: false,
      nodes: 0,
      links: 0,
    });
  });

  it("pauses while the page is hidden and resumes with only one frame owner", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    const { root } = await renderCanvas(emptyProjection());
    flushAllFrames();
    expect(frames.size).toBe(0);

    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      paused: true,
      activeAnimationFrames: 0,
    });

    visibility.mockReturnValue("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(frames.size).toBe(1);
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      paused: false,
      activeAnimationFrames: 1,
    });

    await act(async () => root.unmount());
    roots.splice(roots.indexOf(root), 1);
    expect(window.__HERDR_GRAPH_RENDERER__).toMatchObject({
      paused: false,
      activeAnimationFrames: 0,
    });
  });

  it("fits the first non-empty layout when no camera has been saved", async () => {
    const onViewChange = vi.fn();
    await renderCanvas(spaceProjection(), { onViewChange, fitOnMount: true });
    const [camera, positions] = onViewChange.mock.lastCall ?? [];
    expect(camera).toMatchObject({ x: -70, zoom: 2 });
    expect(Math.abs(camera?.y ?? Number.POSITIVE_INFINITY)).toBe(0);
    expect(positions).toMatchObject({
      space: { x: 0, y: 0, pinned: true },
      terminal: { x: 100, y: 0, pinned: true },
    });
  });

  it("nudges a newly connected node only enough to keep its connector visible", () => {
    const overlay = { left: 620, top: 348, right: 1428, bottom: 888 };
    expect(graphConversationCameraNudge({ x: 719, y: 339 }, overlay)).toEqual({
      x: 0,
      y: -23,
    });
    expect(graphConversationCameraNudge({ x: 719, y: 300 }, overlay)).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("keeps single click, collapse, and dragging inspection-only but activates terminals on double-click", async () => {
    const onSelect = vi.fn();
    const onActivate = vi.fn();
    const onToggleCollapse = vi.fn();
    const onViewChange = vi.fn();
    const { container } = await renderCanvas(spaceProjection(), {
      onSelect,
      onActivate,
      onToggleCollapse,
      onViewChange,
    });
    const canvas = container.querySelector("canvas");
    if (!canvas) throw new Error("Graph canvas missing");

    await pointer(canvas, "pointerdown", 400, 300);
    await pointer(canvas, "pointerup", 400, 300);
    expect(onSelect).toHaveBeenCalledWith("space-selection", "host");

    await pointer(canvas, "pointerdown", 436, 264);
    await pointer(canvas, "pointerup", 436, 264);
    expect(onToggleCollapse).toHaveBeenCalledWith("space");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();

    await pointer(canvas, "pointerdown", 400, 300);
    await pointer(canvas, "pointermove", 430, 300);
    await pointer(canvas, "pointerup", 430, 300);
    expect(onViewChange).toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledTimes(1);

    await act(async () => canvas.dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true,
      button: 0,
      clientX: 500,
      clientY: 300,
    })));
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({
      kind: "terminal",
      selectionKey: "terminal-selection",
    }));
  });

  it("uses each branded glyph and stable generic-agent and empty-shell fallbacks", () => {
    for (const agentKind of ["claude", "codex", "pi", "grok", "opencode"] as const) {
      expect(graphTerminalGlyphKind({ agentRunning: true, agentKind })).toBe(agentKind);
    }
    expect(graphTerminalGlyphKind({ agentRunning: true, agentKind: null })).toBe("generic-agent");
    expect(graphTerminalGlyphKind({ agentRunning: false, agentKind: null })).toBe("terminal");
  });

  it("preserves hidden terminal positions across collapse and prunes removed topology", async () => {
    const onSelect = vi.fn();
    const onViewChange = vi.fn<(
      camera: GraphCamera,
      positions: Record<string, SavedGraphPosition>,
    ) => void>();
    const projection = spaceProjection();
    const { canvas, rerender } = await renderCanvas(projection, { onSelect, onViewChange });

    await rerender(projection, new Set(["space"]));
    await wheel(canvas);
    expect(onViewChange.mock.lastCall?.[1]).toMatchObject({
      space: { x: 0, y: 0, pinned: true },
      terminal: { x: 100, y: 0, pinned: true },
    });

    await rerender(projection, new Set());
    await pointer(canvas, "pointerdown", 500, 300);
    await pointer(canvas, "pointerup", 500, 300);
    expect(onSelect).toHaveBeenLastCalledWith("terminal-selection", "host");

    const spaceOnly: HerdrGraphProjection = {
      ...projection,
      nodes: projection.nodes.filter(({ kind }) => kind === "space"),
      edges: [],
      spaces: projection.spaces.map((space) => ({
        ...space,
        terminals: [],
        observedTerminalCount: 0,
      })),
    };
    await rerender(spaceOnly, new Set());
    await wheel(canvas);
    expect(onViewChange.mock.lastCall?.[1]).toEqual({
      space: { x: 0, y: 0, pinned: true },
    });
  });
});

async function renderCanvas(
  projection: HerdrGraphProjection,
  callbacks: {
    onSelect?: (selectionKey: string, hostKey: string) => void;
    onActivate?: (node: WorldGraphNode) => void;
    onToggleCollapse?: (spaceId: string) => void;
    onViewChange?: (
      camera: GraphCamera,
      positions: Record<string, SavedGraphPosition>,
    ) => void;
    fitOnMount?: boolean;
  } = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const initialPrefs = {
    camera: { x: 0, y: 0, zoom: 1 },
    collapsedIds: [],
    positions: {
      space: { x: 0, y: 0, pinned: true },
      terminal: { x: 100, y: 0, pinned: true },
    },
  };
  const rerender = async (
    nextProjection: HerdrGraphProjection,
    collapsedIds: ReadonlySet<string>,
  ) => act(async () => root.render(
    <GraphCanvas
      projection={nextProjection}
      collapsedIds={collapsedIds}
      selectedKey={null}
      matchedIds={null}
      conversationTargets={[]}
      initialPrefs={initialPrefs}
      fitOnMount={callbacks.fitOnMount}
      onSelect={callbacks.onSelect ?? (() => {})}
      onActivate={callbacks.onActivate ?? (() => {})}
      onToggleCollapse={callbacks.onToggleCollapse ?? (() => {})}
      onViewChange={callbacks.onViewChange ?? (() => {})}
    />,
  ));
  await rerender(projection, new Set());
  const canvas = container.querySelector("canvas");
  if (!canvas) throw new Error("Graph canvas missing");
  return { canvas, container, rerender, root };
}

async function pointer(
  canvas: HTMLCanvasElement,
  type: "pointerdown" | "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
) {
  await act(async () => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
  })));
}

async function wheel(canvas: HTMLCanvasElement) {
  await act(async () => canvas.dispatchEvent(new WheelEvent("wheel", {
    bubbles: true,
    clientX: 400,
    clientY: 300,
    deltaY: 10,
  })));
}

function flushOneFrame() {
  const entry = frames.entries().next().value as [number, FrameRequestCallback] | undefined;
  if (!entry) return;
  frames.delete(entry[0]);
  entry[1](performance.now());
}

function flushAllFrames() {
  for (let index = 0; frames.size > 0 && index < 100; index += 1) flushOneFrame();
}

function emptyProjection(): HerdrGraphProjection {
  return {
    version: 1,
    nodes: [],
    edges: [],
    spaces: [],
    omittedSpaceCount: 0,
    coverage: {
      observedSpaces: 0,
      presentedSpaces: 0,
      observedAgents: 0,
      presentedAgents: 0,
      omittedAgents: 0,
      omittedAgentsInPresentedSpaces: 0,
      omittedAgentsInOmittedSpaces: 0,
      observedTerminals: 0,
      presentedTerminals: 0,
      omittedTerminals: 0,
      observedShells: 0,
      presentedShells: 0,
      status: { idle: 0, working: 0, blocked: 0, done: 0, unknown: 0 },
    },
    presentationBounds: { spaces: 128, terminalsPerSpace: 16 },
  };
}

function spaceProjection(): HerdrGraphProjection {
  const space: WorldGraphNode = {
    id: "space",
    kind: "space",
    parentId: null,
    hostKey: "host",
    hostLabel: "Host",
    label: "Space",
    status: "unknown",
    focused: false,
    stale: false,
    disconnected: false,
    connectionState: "compatible",
    actionable: true,
    selectionKey: "space-selection",
    omittedChildCount: 0,
    searchText: "space host",
    handoff: null,
    paneId: null,
    observedGeneration: "generation",
    agentRunning: false,
    agentKind: null,
  };
  const terminal: WorldGraphNode = {
    ...space,
    id: "terminal",
    kind: "terminal",
    parentId: space.id,
    label: "Codex",
    selectionKey: "terminal-selection",
    paneId: "pane",
    agentRunning: true,
    agentKind: "codex",
  };
  return {
    ...emptyProjection(),
    nodes: [space, terminal],
    edges: [{ sourceId: space.id, targetId: terminal.id, kind: "contains" }],
    spaces: [{ node: space, terminals: [terminal], observedTerminalCount: 1, omittedTerminalCount: 0 }],
    coverage: {
      ...emptyProjection().coverage,
      observedSpaces: 1,
      presentedSpaces: 1,
    },
  };
}
