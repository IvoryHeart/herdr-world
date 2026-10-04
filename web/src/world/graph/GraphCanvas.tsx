import { graphPanStrips } from "./graphPanStrips";
import {
  registerWorldFrames,
  terminalInputIsQuiet,
  subscribeTerminalQuiet,
  type WorldFrames,
} from "../worldFrameScheduler";
import {
  worldRendererDebugEnabled,
  worldRendererCountersEnabled,
} from "../worldRendererDebug";
import { GraphSimulationRunner } from "./graphSimulationRunner";
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { OfficeCanvasAnchor } from "../PixelOfficeCanvas";
import {
  arrangeGraphLayout,
  graphBounds,
  graphNodeRadius,
  reconcileGraphLayout,
  savedGraphPositions,
} from "./graphLayout";
import type { GraphLayoutNode, GraphLayoutState } from "./graphLayout";
import type {
  GraphCamera,
  GraphCameraMode,
  GraphPreferences,
  SavedGraphPosition,
} from "./graphPreferences";
import type { WorldGraphNode, WorldGraphProjection } from "./graphProjection";
import { graphQuarterTurns, rotateGraphPoint } from "./graphRotation";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;

export function graphViewportBounds(
  width: number,
  height: number,
  camera: GraphCamera,
  center: { x: number; y: number },
  rotation: number,
) {
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) =>
    rotateGraphPoint(
      {
        x: (x! - width / 2 - camera.x) / camera.zoom,
        y: (y! - height / 2 - camera.y) / camera.zoom,
      },
      center,
      -rotation,
    ),
  );
  return {
    minX: Math.min(...corners.map((p) => p.x)),
    maxX: Math.max(...corners.map((p) => p.x)),
    minY: Math.min(...corners.map((p) => p.y)),
    maxY: Math.max(...corners.map((p) => p.y)),
  };
}

/** Conservative clipping retains crossing links and all node labels/badges. */
export function graphDrawingIntersects(
  bounds: ReturnType<typeof graphViewportBounds>,
  a: { x: number; y: number },
  b = a,
  padding = 100,
) {
  return (
    Math.max(a.x, b.x) + padding >= bounds.minX &&
    Math.min(a.x, b.x) - padding <= bounds.maxX &&
    Math.max(a.y, b.y) + padding >= bounds.minY &&
    Math.min(a.y, b.y) - padding <= bounds.maxY
  );
}

type GraphRendererDiagnostics = {
  physicsWorker: boolean;
  redraw?: () => void;
  mounts: number;
  destroys: number;
  activeRenderers: number;
  activeAnimationFrames: number;
  activeObservers: number;
  activeListeners: number;
  canvases: number;
  frames: number;
  resizeObservations: number;
  resizeFrames: number;
  ready: boolean;
  paused: boolean;
  nodes: number;
  links: number;
  publishedNodes: Record<
    string,
    { x: number; y: number; screenX: number; screenY: number; pinned: boolean }
  >;
};

declare global {
  interface Window {
    __HERDR_GRAPH_RENDERER__?: GraphRendererDiagnostics;
  }
}

export type GraphCanvasHandle = {
  arrange(): void;
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
  rotate(direction: -1 | 1): void;
};

type GraphCanvasProps = {
  projection: WorldGraphProjection;
  collapsedIds: ReadonlySet<string>;
  selectedId: string | null;
  matchedIds: ReadonlySet<string> | null;
  anchorNodeIds: readonly string[];
  initialPrefs: GraphPreferences;
  fitOnMount: boolean;
  onSelect(id: string): void;
  onActivate(node: WorldGraphNode): void;
  onToggleCollapse(id: string): void;
  onViewChange(
    camera: GraphCamera,
    positions: Record<string, SavedGraphPosition>,
    cameraMode: GraphCameraMode,
    rotation: number,
  ): void;
  onAnchorsChange(anchors: Record<string, OfficeCanvasAnchor> | null): void;
};

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(
  function GraphCanvas(
    {
      projection,
      collapsedIds,
      selectedId,
      matchedIds,
      anchorNodeIds,
      initialPrefs,
      fitOnMount,
      onSelect,
      onActivate,
      onToggleCollapse,
      onViewChange,
      onAnchorsChange,
    },
    ref,
  ) {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const rendererRef = useRef<GraphRenderer | null>(null);

    useLayoutEffect(() => {
      const host = hostRef.current;
      const canvas = canvasRef.current;
      if (!host || !canvas) return;
      const renderer = new GraphRenderer(
        canvas,
        host,
        initialPrefs,
        fitOnMount,
      );
      rendererRef.current = renderer;
      return () => {
        renderer.dispose();
        rendererRef.current = null;
      };
    }, [fitOnMount, initialPrefs]);

    useEffect(() => {
      rendererRef.current?.setCallbacks(
        onSelect,
        onActivate,
        onToggleCollapse,
        onViewChange,
      );
    }, [onActivate, onSelect, onToggleCollapse, onViewChange]);

    useEffect(() => {
      rendererRef.current?.update(
        projection,
        collapsedIds,
        selectedId,
        matchedIds,
      );
    }, [collapsedIds, matchedIds, projection, selectedId]);

    useEffect(() => {
      const renderer = rendererRef.current;
      renderer?.setAnchorRequests(anchorNodeIds, onAnchorsChange);
      return () => renderer?.setAnchorRequests([], null);
    }, [anchorNodeIds, onAnchorsChange]);

    useImperativeHandle(
      ref,
      () => ({
        arrange: () => rendererRef.current?.arrange(),
        fit: () => rendererRef.current?.fit(),
        zoomIn: () => rendererRef.current?.zoomIn(),
        zoomOut: () => rendererRef.current?.zoomOut(),
        rotate: (direction) => rendererRef.current?.rotate(direction),
      }),
      [],
    );

    return (
      <div ref={hostRef} className="world-graph-canvas-host">
        <canvas ref={canvasRef} data-graph-canvas="true" aria-hidden="true" />
      </div>
    );
  },
);

type PointerInteraction = {
  pointerId: number;
  mode: "pan" | "node" | "collapse";
  nodeId: string | null;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  moved: boolean;
};

export class LatestFrameValue<T> {
  #frame: number | null = null;
  #latest: T | null = null;

  constructor(readonly apply: (value: T) => void) {}

  push(value: T) {
    this.#latest = value;
    if (this.#frame !== null) return;
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = null;
      const latest = this.#latest;
      this.#latest = null;
      if (latest !== null) this.apply(latest);
    });
  }

  cancel() {
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#latest = null;
  }
}

class GraphRenderer {
  readonly #context: CanvasRenderingContext2D | null;
  readonly #diagnostics: GraphRendererDiagnostics;
  readonly #resizeValues: LatestFrameValue<{ width: number; height: number }>;
  readonly #resizeObserver: ResizeObserver | null;
  #layout: GraphLayoutState | null = null;
  #drawOrder: GraphLayoutNode[] = [];
  #savedPositions: Record<string, SavedGraphPosition>;
  #projectionNodeIds: ReadonlySet<string> = new Set();
  #nodeParentIds = new Map<string, string>();
  #collapsedIds: ReadonlySet<string> = new Set();
  #selectedId: string | null = null;
  #matchedIds: ReadonlySet<string> | null = null;
  #camera: GraphCamera;
  #cameraMode: GraphCameraMode;
  #rotation: number;
  #fitWhenSettled: boolean;
  #width = 1;
  #height = 1;
  #alpha = 0;
  readonly #frames: WorldFrames;
  readonly #simulation: GraphSimulationRunner;
  readonly #unsubscribeQuiet: () => void;
  readonly #debug = worldRendererDebugEnabled();
  #projection: WorldGraphProjection | null = null;
  #canvasRect: DOMRect | null = null;
  #background: HTMLCanvasElement | null = null;
  #backgroundKey = "";
  #settledFrame: HTMLCanvasElement | null = null;
  #settledView: {
    x: number;
    y: number;
    zoom: number;
    rotation: number;
    revision: number;
  } | null = null;
  #paintRevision = 0;
  #pointer: PointerInteraction | null = null;
  #disposed = false;
  #hidden = document.visibilityState === "hidden";
  #anchorNodeIds: readonly string[] = [];
  #anchorSignature = "";
  #onSelect: (id: string) => void = () => {};
  #onActivate: (node: WorldGraphNode) => void = () => {};
  #onToggleCollapse: (id: string) => void = () => {};
  #onViewChange: GraphCanvasProps["onViewChange"] = () => {};
  #onAnchorsChange: GraphCanvasProps["onAnchorsChange"] | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly host: HTMLElement,
    prefs: GraphPreferences,
    fitOnMount: boolean,
  ) {
    this.#context = canvas.getContext("2d");
    this.#camera = { ...prefs.camera };
    this.#cameraMode = prefs.cameraMode;
    this.#rotation = prefs.rotation;
    this.#fitWhenSettled = fitOnMount;
    this.#savedPositions = { ...prefs.positions };
    this.#diagnostics = graphRendererDiagnostics();
    this.#diagnostics.mounts += 1;
    this.#diagnostics.activeRenderers += 1;
    this.#diagnostics.canvases += 1;
    this.#diagnostics.ready = true;
    this.#diagnostics.paused = this.#hidden;
    this.#frames = registerWorldFrames(host, this.#tick, (paused) => {
      this.#diagnostics.paused = paused || this.#hidden;
      if (paused) this.#diagnostics.activeAnimationFrames = 0;
    });
    this.#simulation = new GraphSimulationRunner((alpha) => {
      if (this.#disposed) return;
      this.#alpha = alpha <= 0.015 ? 0 : alpha;
      this.#diagnostics.physicsWorker = this.#simulation.offThread;
      this.#settledView = null;
      this.#requestFrame(this.#frames.reducedMotion ? "state" : "motion");
    });
    this.#diagnostics.physicsWorker = this.#simulation.offThread;
    this.#unsubscribeQuiet = subscribeTerminalQuiet((quiet) => {
      if (quiet && this.#alpha > 0.015 && this.#frames.reducedMotion)
        this.#requestFrame();
    });
    if (this.#debug)
      this.#diagnostics.redraw = () => {
        this.#settledView = null;
        this.#requestFrame();
      };
    this.#resizeValues = new LatestFrameValue(({ width, height }) => {
      if (this.#disposed) return;
      this.#diagnostics.resizeFrames += 1;
      this.#resize(width, height);
    });
    this.#resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            const entry = entries[entries.length - 1];
            if (!entry) return;
            this.#diagnostics.resizeObservations += entries.length;
            this.#resizeValues.push({
              width: entry.contentRect.width,
              height: entry.contentRect.height,
            });
          });
    this.#resizeObserver?.observe(host);
    if (this.#resizeObserver) this.#diagnostics.activeObservers += 1;
    canvas.addEventListener("pointerdown", this.#onPointerDown);
    canvas.addEventListener("pointermove", this.#onPointerMove);
    canvas.addEventListener("pointerup", this.#onPointerUp);
    canvas.addEventListener("pointercancel", this.#onPointerCancel);
    canvas.addEventListener("wheel", this.#onWheel, { passive: false });
    canvas.addEventListener("dblclick", this.#onDoubleClick);
    document.addEventListener("visibilitychange", this.#onVisibilityChange);
    window.addEventListener("scroll", this.#invalidateRect, true);
    window.addEventListener("resize", this.#invalidateRect);
    this.#diagnostics.activeListeners += 9;
    const rect = host.getBoundingClientRect();
    this.#resize(Math.max(1, rect.width), Math.max(1, rect.height));
  }

  setCallbacks(
    onSelect: (id: string) => void,
    onActivate: (node: WorldGraphNode) => void,
    onToggleCollapse: (id: string) => void,
    onViewChange: GraphCanvasProps["onViewChange"],
  ) {
    this.#onSelect = onSelect;
    this.#onActivate = onActivate;
    this.#onToggleCollapse = onToggleCollapse;
    this.#onViewChange = onViewChange;
  }

  setAnchorRequests(
    ids: readonly string[],
    callback: GraphCanvasProps["onAnchorsChange"] | null,
  ) {
    this.#anchorNodeIds = ids;
    this.#onAnchorsChange = callback;
    this.#anchorSignature = "";
    if (!callback) return;
    this.#requestFrame();
  }

  update(
    projection: WorldGraphProjection,
    collapsedIds: ReadonlySet<string>,
    selectedId: string | null,
    matchedIds: ReadonlySet<string> | null,
  ) {
    this.#paintRevision++;
    const topologyInputsChanged =
      this.#projection !== projection || this.#collapsedIds !== collapsedIds;
    if (topologyInputsChanged) {
      this.#projectionNodeIds = new Set(projection.nodes.map(({ id }) => id));
      this.#nodeParentIds = new Map(
        projection.nodes.flatMap((node) =>
          node.parentId ? ([[node.id, node.parentId]] as const) : [],
        ),
      );
      this.#savedPositions = retainedGraphPositions(
        this.#savedPositions,
        null,
        this.#projectionNodeIds,
      );
      const reconciled = reconcileGraphLayout(
        this.#layout,
        projection,
        collapsedIds,
        this.#savedPositions,
      );
      this.#layout = reconciled.state;
      this.#drawOrder = [...this.#layout.nodes.values()].sort(
        (left, right) => nodeRank(left.kind) - nodeRank(right.kind),
      );
      this.#simulation.reset(this.#layout);
      if (reconciled.topologyChanged) this.#alpha = 1;
      this.#projection = projection;
    }
    this.#collapsedIds = collapsedIds;
    this.#selectedId = selectedId;
    this.#matchedIds = matchedIds;
    this.#diagnostics.nodes = this.#layout!.nodes.size;
    this.#diagnostics.links = this.#layout!.edges.length;
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  fit() {
    if (!this.#layout) return;
    this.#fitWhenSettled = false;
    this.#cameraMode = "fit";
    const bounds = this.#rotatedBounds();
    this.#camera = this.#centeredCamera(bounds, this.#fitZoom(bounds));
    this.#emitViewChange();
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  #fitZoom(bounds: ReturnType<typeof graphBounds>) {
    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    return clamp(
      Math.min(
        (this.#width - 96) / graphWidth,
        (this.#height - 96) / graphHeight,
      ),
      MIN_ZOOM,
      2,
    );
  }

  #centeredCamera(bounds: ReturnType<typeof graphBounds>, zoom: number) {
    return {
      x: (-(bounds.minX + bounds.maxX) / 2) * zoom,
      y: (-(bounds.minY + bounds.maxY) / 2) * zoom,
      zoom,
    };
  }

  arrange() {
    if (!this.#layout) return;
    this.#settledView = null;
    arrangeGraphLayout(this.#layout);
    this.#simulation.reset(this.#layout);
    const bounds = this.#rotatedBounds();
    this.#camera = this.#centeredCamera(
      bounds,
      Math.min(this.#camera.zoom, this.#fitZoom(bounds)),
    );
    this.#alpha = 0;
    this.#fitWhenSettled = false;
    this.#emitViewChange();
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  zoomIn() {
    this.#zoomAt(this.#camera.zoom * ZOOM_STEP, 0, 0);
  }

  zoomOut() {
    this.#zoomAt(this.#camera.zoom / ZOOM_STEP, 0, 0);
  }

  rotate(direction: -1 | 1) {
    if (!this.#layout) return;
    this.#rotation = graphQuarterTurns(this.#rotation, direction);
    const bounds = this.#rotatedBounds();
    this.#camera = this.#centeredCamera(
      bounds,
      Math.min(this.#camera.zoom, this.#fitZoom(bounds)),
    );
    this.#fitWhenSettled = false;
    this.#emitViewChange();
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  #graphCenter() {
    const bounds = graphBounds(this.#layout!.nodes.values());
    return {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
  }

  #rotatedBounds() {
    const bounds = graphBounds(this.#layout!.nodes.values());
    if (this.#rotation % 2 === 0) return bounds;
    const center = {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
    };
    const halfWidth = (bounds.maxY - bounds.minY) / 2;
    const halfHeight = (bounds.maxX - bounds.minX) / 2;
    return {
      minX: center.x - halfWidth,
      maxX: center.x + halfWidth,
      minY: center.y - halfHeight,
      maxY: center.y + halfHeight,
    };
  }

  #rotatedPoint(x: number, y: number, center: { x: number; y: number }) {
    return rotateGraphPoint({ x, y }, center, this.#rotation);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelFrame();
    this.#frames.dispose();
    this.#unsubscribeQuiet();
    this.#simulation.dispose();
    this.#resizeValues.cancel();
    this.#resizeObserver?.disconnect();
    this.canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.#onPointerCancel);
    this.canvas.removeEventListener("wheel", this.#onWheel);
    this.canvas.removeEventListener("dblclick", this.#onDoubleClick);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#pointer = null;
    this.#layout?.nodes.clear();
    this.#layout = null;
    if (this.#background) this.#background.width = this.#background.height = 0;
    if (this.#settledFrame)
      this.#settledFrame.width = this.#settledFrame.height = 0;
    this.#background = this.#settledFrame = null;
    this.#settledView = null;
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.#onAnchorsChange?.(null);
    this.#onAnchorsChange = null;
    this.#diagnostics.destroys += 1;
    this.#diagnostics.activeRenderers -= 1;
    this.#diagnostics.canvases -= 1;
    window.removeEventListener("scroll", this.#invalidateRect, true);
    window.removeEventListener("resize", this.#invalidateRect);
    this.#diagnostics.activeListeners -= 9;
    if (this.#resizeObserver) this.#diagnostics.activeObservers -= 1;
    this.#diagnostics.ready = this.#diagnostics.activeRenderers > 0;
    this.#diagnostics.paused = false;
    this.#diagnostics.nodes = 0;
    this.#diagnostics.links = 0;
    this.#diagnostics.publishedNodes = {};
    this.#diagnostics.redraw = undefined;
  }

  #resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.#width && nextHeight === this.#height) return;
    this.#canvasRect = null;
    this.#settledView = null;
    this.#width = nextWidth;
    this.#height = nextHeight;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(nextWidth * density);
    this.canvas.height = Math.round(nextHeight * density);
    this.canvas.style.width = `${nextWidth}px`;
    this.canvas.style.height = `${nextHeight}px`;
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  #requestFrame(kind: "state" | "motion" = "state") {
    if (this.#disposed || this.#hidden) return;
    this.#diagnostics.activeAnimationFrames =
      kind === "motion" && !this.#frames.motionAllowed ? 0 : 1;
    this.#frames.request(kind);
  }

  #cancelFrame() {
    this.#frames.cancel();
    this.#diagnostics.activeAnimationFrames = 0;
  }

  #tick = () => {
    this.#diagnostics.activeAnimationFrames = 0;
    if (this.#disposed || this.#hidden) return;
    if (this.#layout && this.#alpha > 0.015 && terminalInputIsQuiet()) {
      this.#diagnostics.activeAnimationFrames = 1;
      this.#simulation.step(this.#alpha, this.#frames.reducedMotion);
    } else if (this.#alpha <= 0.015) {
      this.#alpha = 0;
      if (this.#fitWhenSettled && this.#layout?.nodes.size) this.fit();
    }
    this.#draw();
    this.#diagnostics.frames += 1;
    // Keep a pending request while typing; the shared quiet signal resumes it.
    if (this.#alpha > 0.015 && !terminalInputIsQuiet())
      this.#requestFrame("motion");
  };

  #invalidateRect = () => {
    this.#canvasRect = null;
    this.#requestFrame();
  };

  #rect() {
    return (this.#canvasRect ??= this.canvas.getBoundingClientRect());
  }

  #draw() {
    const context = this.#context;
    const layout = this.#layout;
    if (!context || !layout) return;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    context.setTransform(density, 0, 0, density, 0, 0);
    const previous = this.#settledView;
    const dx = previous ? this.#camera.x - previous.x : 0;
    const dy = previous ? this.#camera.y - previous.y : 0;
    const strips =
      this.#alpha === 0 &&
      previous &&
      previous.revision === this.#paintRevision &&
      previous.zoom === this.#camera.zoom &&
      previous.rotation === this.#rotation
        ? graphPanStrips(this.#width, this.#height, dx, dy, density)
        : null;
    context.clearRect(0, 0, this.#width, this.#height);
    if (strips && this.#settledFrame)
      context.drawImage(
        this.#settledFrame,
        dx,
        dy,
        this.canvas.width / density,
        this.canvas.height / density,
      );
    context.save();
    if (strips) {
      context.beginPath();
      for (const strip of strips)
        context.rect(strip.x, strip.y, strip.width, strip.height);
      context.clip();
    }
    if (strips) {
      // The destination clip limits grid work to the newly exposed strips.
      // Rebuilding a full offscreen grid on each pan defeats strip reuse.
      context.fillStyle = "#0b0e13";
      context.fillRect(0, 0, this.#width, this.#height);
      drawGrid(context, this.#width, this.#height, this.#camera);
    } else {
      const { spacing, offsetX, offsetY } = graphGridPhase(
        this.#width,
        this.#height,
        this.#camera,
      );
      const backgroundKey = `${this.#width}:${this.#height}:${density}:${spacing}:${offsetX}:${offsetY}`;
      if (backgroundKey !== this.#backgroundKey) {
        this.#background ??= document.createElement("canvas");
        this.#background.width = this.canvas.width;
        this.#background.height = this.canvas.height;
        const background = this.#background.getContext("2d")!;
        background.setTransform(density, 0, 0, density, 0, 0);
        background.fillStyle = "#0b0e13";
        background.fillRect(0, 0, this.#width, this.#height);
        drawGrid(background, this.#width, this.#height, this.#camera);
        this.#backgroundKey = backgroundKey;
      }
      context.drawImage(
        this.#background!,
        0,
        0,
        this.canvas.width / density,
        this.canvas.height / density,
      );
    }
    context.save();
    context.translate(
      this.#width / 2 + this.#camera.x,
      this.#height / 2 + this.#camera.y,
    );
    context.scale(this.#camera.zoom, this.#camera.zoom);
    const center = this.#graphCenter();
    const viewports = (
      strips ?? [{ x: 0, y: 0, width: this.#width, height: this.#height }]
    ).map((rect) =>
      graphViewportBounds(
        rect.width,
        rect.height,
        {
          ...this.#camera,
          x: this.#camera.x + (this.#width - rect.width) / 2 - rect.x,
          y: this.#camera.y + (this.#height - rect.height) / 2 - rect.y,
        },
        center,
        this.#rotation,
      ),
    );
    context.translate(center.x, center.y);
    context.rotate((this.#rotation * Math.PI) / 2);
    context.translate(-center.x, -center.y);
    for (const edge of layout.edges) {
      const source = layout.nodes.get(edge.sourceId);
      const target = layout.nodes.get(edge.targetId);
      if (!source || !target) continue;
      if (
        !viewports.some((viewport) =>
          graphDrawingIntersects(
            viewport,
            source,
            target,
            2 / this.#camera.zoom,
          ),
        )
      )
        continue;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = "rgba(121, 166, 255, 0.38)";
      context.lineWidth = 1.5 / this.#camera.zoom;
      context.stroke();
    }
    for (const node of this.#drawOrder)
      if (
        viewports.some((viewport) =>
          graphDrawingIntersects(
            viewport,
            node,
            node,
            Math.max(100, 60 / this.#camera.zoom),
          ),
        )
      )
        this.#drawNode(context, node);
    context.restore();
    context.restore();
    if (this.#alpha === 0) {
      this.#settledFrame ??= document.createElement("canvas");
      this.#settledFrame.width = this.canvas.width;
      this.#settledFrame.height = this.canvas.height;
      this.#settledFrame.getContext("2d")!.drawImage(this.canvas, 0, 0);
      this.#settledView = {
        ...this.#camera,
        rotation: this.#rotation,
        revision: this.#paintRevision,
      };
    }
    this.#publishNodes(layout, center);
    this.#emitAnchors(layout, center);
  }

  #drawNode(context: CanvasRenderingContext2D, node: GraphLayoutNode) {
    const source = node.source;
    const radius = graphNodeRadius(source.kind);
    const matched = !this.#matchedIds || this.#matchedIds.has(source.id);
    context.save();
    context.globalAlpha = matched ? 1 : 0.18;
    context.translate(node.x, node.y);
    context.rotate((-this.#rotation * Math.PI) / 2);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle =
      source.kind === "host"
        ? "#172131"
        : source.kind === "space"
          ? "#182333"
          : statusFill(source.status);
    context.fill();
    context.setLineDash(source.stale ? [5, 4] : []);
    context.lineWidth =
      source.id === this.#selectedId ? 4 : source.focused ? 3 : 1.5;
    context.strokeStyle =
      source.id === this.#selectedId
        ? "#f2c879"
        : source.focused
          ? "#79a6ff"
          : statusStroke(source.status);
    context.stroke();
    context.setLineDash([]);
    // Identifying labels remain readable in Fit and the overview. Secondary
    // details can wait until the node is large enough to contain them.
    const detailed = this.#camera.zoom * 9 >= 6;
    const labelScale = Math.max(1, 1 / this.#camera.zoom);
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#e8edf4";
    if (source.kind === "agent" || source.kind === "terminal") {
      if (detailed) {
        context.font = "700 11px sans-serif";
        context.fillText(
          source.kind === "agent" ? statusSymbol(source.status) : ">_",
          0,
          0,
        );
      }
      context.font = `600 ${9 * labelScale}px sans-serif`;
      context.fillText(
        shortCanvasLabel(context, source.label, 76 * labelScale),
        0,
        radius + 14 * labelScale,
      );
    } else if (source.kind === "host" || source.kind === "space") {
      context.font =
        source.kind === "host"
          ? `700 ${13 * labelScale}px sans-serif`
          : `600 ${11 * labelScale}px sans-serif`;
      context.fillText(
        shortCanvasLabel(
          context,
          source.label,
          (source.kind === "host" ? 98 : 78) * labelScale,
        ),
        0,
        detailed ? -5 : 0,
      );
      if (detailed) {
        context.fillStyle = "#9da7b4";
        context.font = "500 8px sans-serif";
        context.fillText(
          shortCanvasLabel(
            context,
            source.kind === "host" ? hostStateLabel(source) : source.hostLabel,
            88,
          ),
          0,
          11,
        );
        if (source.omittedChildCount > 0) {
          context.fillStyle = "#f2c879";
          context.fillText(`+${source.omittedChildCount}`, 0, 25);
        }
      }
      const badge = collapseBadgeOffset(source.kind);
      context.beginPath();
      context.arc(badge, -badge, 11, 0, Math.PI * 2);
      context.fillStyle = "#263448";
      context.fill();
      context.strokeStyle = "#79a6ff";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "#e8edf4";
      context.font = "700 14px sans-serif";
      if (detailed)
        context.fillText(
          this.#collapsedIds.has(source.id) ? "+" : "−",
          badge,
          -badge,
        );
    }
    if (source.stale && detailed) {
      context.fillStyle = "#ef9b85";
      context.font = "700 9px sans-serif";
      context.fillText("STALE", 0, -radius - 10);
    }
    context.restore();
  }

  #point(event: { clientX: number; clientY: number }) {
    const rect = this.#rect();
    const scaleX = rect.width / this.#width;
    const scaleY = rect.height / this.#height;
    const rotated = {
      x:
        ((event.clientX - rect.left) / scaleX -
          this.#width / 2 -
          this.#camera.x) /
        this.#camera.zoom,
      y:
        ((event.clientY - rect.top) / scaleY -
          this.#height / 2 -
          this.#camera.y) /
        this.#camera.zoom,
    };
    const original = this.#layout
      ? rotateGraphPoint(rotated, this.#graphCenter(), -this.#rotation)
      : rotated;
    return { worldX: original.x, worldY: original.y };
  }

  #hitNode(worldX: number, worldY: number) {
    if (!this.#layout) return null;
    if (this.#rotation === 0)
      return hitGraphNode(this.#layout.nodes, worldX, worldY);
    const nodes = [...this.#layout.nodes.values()]
      .sort((left, right) => nodeRank(left.kind) - nodeRank(right.kind))
      .reverse();
    for (const node of nodes) {
      if (node.kind === "host" || node.kind === "space") {
        const offset = collapseBadgeOffset(node.kind);
        const badge = rotateGraphPoint(
          { x: offset, y: -offset },
          { x: 0, y: 0 },
          -this.#rotation,
        );
        if (
          Math.hypot(worldX - node.x - badge.x, worldY - node.y - badge.y) <= 14
        )
          return node;
      }
      if (
        Math.hypot(worldX - node.x, worldY - node.y) <=
        graphNodeRadius(node.kind) + 3
      )
        return node;
    }
    return null;
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = this.#point(event);
    const node = this.#hitNode(point.worldX, point.worldY);
    const collapse = Boolean(
      (node?.kind === "host" || node?.kind === "space") &&
        Math.hypot(
          point.worldX -
            (node.x +
              rotateGraphPoint(
                {
                  x: collapseBadgeOffset(node.kind),
                  y: -collapseBadgeOffset(node.kind),
                },
                { x: 0, y: 0 },
                -this.#rotation,
              ).x),
          point.worldY -
            (node.y +
              rotateGraphPoint(
                {
                  x: collapseBadgeOffset(node.kind),
                  y: -collapseBadgeOffset(node.kind),
                },
                { x: 0, y: 0 },
                -this.#rotation,
              ).y),
        ) <= 14,
    );
    this.#pointer = {
      pointerId: event.pointerId,
      mode: collapse ? "collapse" : node ? "node" : "pan",
      nodeId: node?.id ?? null,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    try {
      this.canvas.setPointerCapture?.(event.pointerId);
    } catch {
      // Synthetic and already-retired pointers cannot be captured.
    }
    event.preventDefault();
  };

  #onPointerMove = (event: PointerEvent) => {
    const pointer = this.#pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const rect = this.#rect();
    const dx = (event.clientX - pointer.lastX) / (rect.width / this.#width);
    const dy = (event.clientY - pointer.lastY) / (rect.height / this.#height);
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.moved ||=
      Math.hypot(
        event.clientX - pointer.startX,
        event.clientY - pointer.startY,
      ) > 4;
    if (!pointer.moved || pointer.mode === "collapse") return;
    if (pointer.mode === "pan") {
      this.#camera = {
        ...this.#camera,
        x: this.#camera.x + dx,
        y: this.#camera.y + dy,
      };
      this.#cameraMode = "manual";
      this.#fitWhenSettled = false;
    } else if (pointer.nodeId && this.#layout) {
      const node = this.#layout.nodes.get(pointer.nodeId);
      if (node) {
        const delta = rotateGraphPoint(
          { x: dx / this.#camera.zoom, y: dy / this.#camera.zoom },
          { x: 0, y: 0 },
          -this.#rotation,
        );
        this.#settledView = null;
        this.#simulation.pin(node.id, node.x + delta.x, node.y + delta.y);
        this.#alpha = Math.max(this.#alpha, 0.24);
      }
    }
    this.#anchorSignature = "";
    this.#emitViewChange();
    this.#requestFrame();
  };

  #onPointerUp = (event: PointerEvent) => {
    const pointer = this.#pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    this.#pointer = null;
    if (this.canvas.hasPointerCapture?.(event.pointerId)) {
      this.canvas.releasePointerCapture?.(event.pointerId);
    }
    if (!pointer.moved && pointer.nodeId && this.#layout) {
      const node = this.#layout.nodes.get(pointer.nodeId);
      if (
        pointer.mode === "collapse" &&
        (node?.kind === "host" || node?.kind === "space")
      ) {
        this.#onToggleCollapse(node.id);
      } else if (node) {
        this.#onSelect(node.id);
      }
    } else if (pointer.moved) {
      this.#emitViewChange();
    }
  };

  #onPointerCancel = (event: PointerEvent) => {
    if (this.#pointer?.pointerId !== event.pointerId) return;
    this.#pointer = null;
    this.#emitViewChange();
  };

  #onWheel = (event: WheelEvent) => {
    event.preventDefault();
    const rect = this.#rect();
    this.#zoomAt(
      this.#camera.zoom * Math.exp(-event.deltaY * 0.0015),
      (event.clientX - rect.left) / (rect.width / this.#width) -
        this.#width / 2,
      (event.clientY - rect.top) / (rect.height / this.#height) -
        this.#height / 2,
    );
  };

  #zoomAt(nextZoom: number, pointX: number, pointY: number) {
    const zoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    if (zoom === this.#camera.zoom) return;
    const beforeX = (pointX - this.#camera.x) / this.#camera.zoom;
    const beforeY = (pointY - this.#camera.y) / this.#camera.zoom;
    this.#camera = {
      x: pointX - beforeX * zoom,
      y: pointY - beforeY * zoom,
      zoom,
    };
    this.#cameraMode = "manual";
    this.#fitWhenSettled = false;
    this.#emitViewChange();
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  #onDoubleClick = (event: MouseEvent) => {
    const point = this.#point(event);
    const node = this.#hitNode(point.worldX, point.worldY);
    if (
      !node ||
      (node.source.kind !== "agent" && node.source.kind !== "terminal") ||
      !node.source.actionable
    ) {
      return;
    }
    event.preventDefault();
    this.#onActivate(node.source);
  };

  #publishNodes(layout: GraphLayoutState, center: { x: number; y: number }) {
    if (!this.#debug) return;
    const published: GraphRendererDiagnostics["publishedNodes"] = {};
    for (const node of layout.nodes.values()) {
      const rotated = this.#rotatedPoint(node.x, node.y, center);
      published[node.id] = {
        x: node.x,
        y: node.y,
        screenX:
          this.#width / 2 + this.#camera.x + rotated.x * this.#camera.zoom,
        screenY:
          this.#height / 2 + this.#camera.y + rotated.y * this.#camera.zoom,
        pinned: node.pinned,
      };
    }
    this.#diagnostics.publishedNodes = published;
  }

  #emitAnchors(layout: GraphLayoutState, center: { x: number; y: number }) {
    if (!this.#onAnchorsChange) return;
    const rect = this.#rect();
    const scaleX = rect.width / this.#width;
    const scaleY = rect.height / this.#height;
    const anchors: Record<string, OfficeCanvasAnchor> = {};
    for (const requestedId of this.#anchorNodeIds) {
      const node =
        layout.nodes.get(requestedId) ??
        this.#visibleAncestor(layout, requestedId);
      if (!node) continue;
      const rotated = this.#rotatedPoint(node.x, node.y, center);
      const rawX =
        rect.left +
        (this.#width / 2 + this.#camera.x + rotated.x * this.#camera.zoom) *
          scaleX;
      const rawY =
        rect.top +
        (this.#height / 2 + this.#camera.y + rotated.y * this.#camera.zoom) *
          scaleY;
      const visible =
        rawX >= rect.left &&
        rawX <= rect.right &&
        rawY >= rect.top &&
        rawY <= rect.bottom;
      anchors[requestedId] = {
        x: clamp(rawX, rect.left + 4, rect.right - 4),
        y: clamp(rawY, rect.top + 4, rect.bottom - 4),
        visible,
        edge: visible
          ? null
          : rawY < rect.top
            ? "top"
            : rawY > rect.bottom
              ? "bottom"
              : rawX < rect.left
                ? "left"
                : "right",
      };
    }
    const signature = JSON.stringify(anchors);
    if (signature === this.#anchorSignature) return;
    this.#anchorSignature = signature;
    this.#onAnchorsChange(anchors);
  }

  #visibleAncestor(layout: GraphLayoutState, nodeId: string) {
    let currentId: string | undefined = nodeId;
    while (currentId) {
      const node = layout.nodes.get(currentId);
      if (node) return node;
      currentId = this.#nodeParentIds.get(currentId);
    }
    return undefined;
  }

  #onVisibilityChange = () => {
    this.#hidden = document.visibilityState === "hidden";
    this.#diagnostics.paused = this.#hidden;
    if (this.#hidden) this.#cancelFrame();
    else this.#requestFrame();
  };

  #emitViewChange() {
    if (!this.#layout) return;
    this.#savedPositions = retainedGraphPositions(
      this.#savedPositions,
      this.#layout,
      this.#projectionNodeIds,
    );
    this.#onViewChange(
      { ...this.#camera },
      this.#savedPositions,
      this.#cameraMode,
      this.#rotation,
    );
  }
}

export function hitGraphNode(
  nodes: ReadonlyMap<string, GraphLayoutNode>,
  worldX: number,
  worldY: number,
) {
  const paintedTopFirst = [...nodes.values()]
    .sort((left, right) => nodeRank(left.kind) - nodeRank(right.kind))
    .reverse();
  for (const node of paintedTopFirst) {
    if (
      (node.kind === "host" || node.kind === "space") &&
      Math.hypot(
        worldX - (node.x + collapseBadgeOffset(node.kind)),
        worldY - (node.y - collapseBadgeOffset(node.kind)),
      ) <= 14
    ) {
      return node;
    }
    if (
      Math.hypot(worldX - node.x, worldY - node.y) <=
      graphNodeRadius(node.kind) + 3
    ) {
      return node;
    }
  }
  return null;
}

function graphRendererDiagnostics() {
  const enabled = worldRendererCountersEnabled();
  if (enabled && window.__HERDR_GRAPH_RENDERER__)
    return window.__HERDR_GRAPH_RENDERER__;
  const diagnostics: GraphRendererDiagnostics = {
    physicsWorker: false,
    mounts: 0,
    destroys: 0,
    activeRenderers: 0,
    activeAnimationFrames: 0,
    activeObservers: 0,
    activeListeners: 0,
    canvases: 0,
    frames: 0,
    resizeObservations: 0,
    resizeFrames: 0,
    ready: false,
    paused: false,
    nodes: 0,
    links: 0,
    publishedNodes: {},
  };
  if (enabled) window.__HERDR_GRAPH_RENDERER__ = diagnostics;
  return diagnostics;
}

export function retainedGraphPositions(
  retained: Readonly<Record<string, SavedGraphPosition>>,
  visibleLayout: GraphLayoutState | null,
  projectionNodeIds: ReadonlySet<string>,
) {
  const visible = savedGraphPositions(visibleLayout);
  const positions: Record<string, SavedGraphPosition> = {};
  for (const id of projectionNodeIds) {
    const position = visible[id] ?? retained[id];
    if (position) positions[id] = position;
  }
  return positions;
}

export function graphGridPhase(
  width: number,
  height: number,
  camera: GraphCamera,
) {
  const spacing = 48 * camera.zoom;
  const phase = (value: number) => {
    const offset = ((value % spacing) + spacing) % spacing;
    // Canonicalize arithmetic noise, including values just below a period.
    const rounded = Math.round(offset * 1e9) / 1e9;
    return Math.abs(rounded - spacing) < 1e-9 ? 0 : rounded;
  };
  return {
    spacing,
    offsetX: phase(width / 2 + camera.x),
    offsetY: phase(height / 2 + camera.y),
  };
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: GraphCamera,
) {
  const { spacing, offsetX, offsetY } = graphGridPhase(width, height, camera);
  if (spacing < 12) return;
  context.beginPath();
  for (let x = offsetX; x < width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = offsetY; y < height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.strokeStyle = "rgba(110, 120, 135, 0.12)";
  context.lineWidth = 1;
  context.stroke();
}

function nodeRank(kind: WorldGraphNode["kind"]) {
  return kind === "host" ? 0 : kind === "space" ? 1 : 2;
}

function collapseBadgeOffset(kind: WorldGraphNode["kind"]) {
  return kind === "host" ? 49 : 36;
}

function statusFill(status: string) {
  return status === "working"
    ? "#1f4638"
    : status === "blocked"
      ? "#4a2a31"
      : status === "done"
        ? "#203e48"
        : status === "idle"
          ? "#333344"
          : "#252b35";
}

function statusStroke(status: string) {
  return status === "working"
    ? "#58c88c"
    : status === "blocked"
      ? "#ef8f8f"
      : status === "done"
        ? "#72c8dd"
        : status === "idle"
          ? "#b59ad9"
          : "#7d8795";
}

function statusSymbol(status: string) {
  return status === "working"
    ? "▶"
    : status === "blocked"
      ? "!"
      : status === "done"
        ? "✓"
        : status === "idle"
          ? "○"
          : "?";
}

function hostStateLabel(node: WorldGraphNode) {
  const state = node.source.hostState;
  return state === "active"
    ? "Active"
    : state === "ready-inactive"
      ? "Ready · inactive"
      : state === "reconnecting"
        ? "Reconnecting"
        : "Offline · stale";
}

const measuredLabels = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, string>
>();

function shortCanvasLabel(
  context: CanvasRenderingContext2D,
  label: string,
  maxWidth: number,
) {
  let cached = measuredLabels.get(context);
  if (!cached) {
    cached = new Map();
    measuredLabels.set(context, cached);
  }
  const key = JSON.stringify([context.font, label, maxWidth]);
  const previous = cached.get(key);
  if (previous !== undefined) return previous;
  const remember = (value: string) => {
    if (cached.size >= 4096) cached.delete(cached.keys().next().value!);
    cached.set(key, value);
    return value;
  };
  if (context.measureText(label).width <= maxWidth) return remember(label);
  const points = [...label];
  while (
    points.length > 1 &&
    context.measureText(`${points.join("")}…`).width > maxWidth
  ) {
    points.pop();
  }
  return remember(`${points.join("")}…`);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
