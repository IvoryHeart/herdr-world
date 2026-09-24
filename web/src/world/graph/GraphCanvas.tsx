import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { OfficeCanvasAnchor } from "../PixelOfficeCanvas";
import {
  graphBounds,
  graphNodeRadius,
  reconcileGraphLayout,
  savedGraphPositions,
  stepGraphLayout,
} from "./graphLayout";
import type { GraphLayoutNode, GraphLayoutState } from "./graphLayout";
import type {
  GraphCamera,
  GraphCameraMode,
  GraphPreferences,
  SavedGraphPosition,
} from "./graphPreferences";
import type { WorldGraphNode, WorldGraphProjection } from "./graphProjection";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;

type GraphRendererDiagnostics = {
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
  fit(): void;
  zoomIn(): void;
  zoomOut(): void;
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
        fit: () => rendererRef.current?.fit(),
        zoomIn: () => rendererRef.current?.zoomIn(),
        zoomOut: () => rendererRef.current?.zoomOut(),
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
  #savedPositions: Record<string, SavedGraphPosition>;
  #projectionNodeIds: ReadonlySet<string> = new Set();
  #nodeParentIds = new Map<string, string>();
  #collapsedIds: ReadonlySet<string> = new Set();
  #selectedId: string | null = null;
  #matchedIds: ReadonlySet<string> | null = null;
  #camera: GraphCamera;
  #cameraMode: GraphCameraMode;
  #fitWhenSettled: boolean;
  #width = 1;
  #height = 1;
  #alpha = 0;
  #frame: number | null = null;
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
    this.#fitWhenSettled = fitOnMount;
    this.#savedPositions = { ...prefs.positions };
    this.#diagnostics = graphRendererDiagnostics();
    this.#diagnostics.mounts += 1;
    this.#diagnostics.activeRenderers += 1;
    this.#diagnostics.canvases += 1;
    this.#diagnostics.ready = true;
    this.#diagnostics.paused = this.#hidden;
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
    this.#diagnostics.activeListeners += 7;
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
    this.#collapsedIds = collapsedIds;
    this.#selectedId = selectedId;
    this.#matchedIds = matchedIds;
    this.#diagnostics.nodes = this.#layout.nodes.size;
    this.#diagnostics.links = this.#layout.edges.length;
    if (reconciled.topologyChanged) this.#alpha = 1;
    this.#anchorSignature = "";
    this.#requestFrame();
  }

  fit() {
    if (!this.#layout) return;
    this.#fitWhenSettled = false;
    this.#cameraMode = "fit";
    const bounds = graphBounds(this.#layout.nodes.values());
    const graphWidth = Math.max(1, bounds.maxX - bounds.minX);
    const graphHeight = Math.max(1, bounds.maxY - bounds.minY);
    const zoom = clamp(
      Math.min(
        (this.#width - 96) / graphWidth,
        (this.#height - 96) / graphHeight,
      ),
      MIN_ZOOM,
      2,
    );
    this.#camera = {
      x: (-(bounds.minX + bounds.maxX) / 2) * zoom,
      y: (-(bounds.minY + bounds.maxY) / 2) * zoom,
      zoom,
    };
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

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#cancelFrame();
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
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.#onAnchorsChange?.(null);
    this.#onAnchorsChange = null;
    this.#diagnostics.destroys += 1;
    this.#diagnostics.activeRenderers -= 1;
    this.#diagnostics.canvases -= 1;
    this.#diagnostics.activeListeners -= 7;
    if (this.#resizeObserver) this.#diagnostics.activeObservers -= 1;
    this.#diagnostics.ready = this.#diagnostics.activeRenderers > 0;
    this.#diagnostics.paused = false;
    this.#diagnostics.nodes = 0;
    this.#diagnostics.links = 0;
    this.#diagnostics.publishedNodes = {};
  }

  #resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.#width && nextHeight === this.#height) return;
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

  #requestFrame() {
    if (this.#disposed || this.#hidden || this.#frame !== null) return;
    this.#frame = window.requestAnimationFrame(this.#tick);
    this.#diagnostics.activeAnimationFrames += 1;
  }

  #cancelFrame() {
    if (this.#frame === null) return;
    window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#diagnostics.activeAnimationFrames -= 1;
  }

  #tick = () => {
    this.#frame = null;
    this.#diagnostics.activeAnimationFrames -= 1;
    if (this.#disposed || this.#hidden) return;
    if (this.#layout && this.#alpha > 0.015) {
      const energy = stepGraphLayout(this.#layout, this.#alpha);
      this.#alpha *= energy < 0.08 ? 0.78 : 0.93;
    } else {
      this.#alpha = 0;
    }
    if (this.#alpha <= 0.015) {
      this.#alpha = 0;
      if (this.#fitWhenSettled && this.#layout?.nodes.size) this.fit();
    }
    this.#draw();
    this.#diagnostics.frames += 1;
    if (this.#alpha > 0.015) this.#requestFrame();
  };

  #draw() {
    const context = this.#context;
    const layout = this.#layout;
    if (!context || !layout) return;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    context.setTransform(density, 0, 0, density, 0, 0);
    context.clearRect(0, 0, this.#width, this.#height);
    context.fillStyle = "#0b0e13";
    context.fillRect(0, 0, this.#width, this.#height);
    drawGrid(context, this.#width, this.#height, this.#camera);
    context.save();
    context.translate(
      this.#width / 2 + this.#camera.x,
      this.#height / 2 + this.#camera.y,
    );
    context.scale(this.#camera.zoom, this.#camera.zoom);
    for (const edge of layout.edges) {
      const source = layout.nodes.get(edge.sourceId);
      const target = layout.nodes.get(edge.targetId);
      if (!source || !target) continue;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = "rgba(121, 166, 255, 0.38)";
      context.lineWidth = 1.5 / this.#camera.zoom;
      context.stroke();
    }
    const nodes = [...layout.nodes.values()].sort(
      (left, right) => nodeRank(left.kind) - nodeRank(right.kind),
    );
    for (const node of nodes) this.#drawNode(context, node);
    context.restore();
    this.#publishNodes(layout);
    this.#emitAnchors(layout);
  }

  #drawNode(context: CanvasRenderingContext2D, node: GraphLayoutNode) {
    const source = node.source;
    const radius = graphNodeRadius(source.kind);
    const matched = !this.#matchedIds || this.#matchedIds.has(source.id);
    context.save();
    context.globalAlpha = matched ? 1 : 0.18;
    context.translate(node.x, node.y);
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
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillStyle = "#e8edf4";
    if (source.kind === "agent" || source.kind === "terminal") {
      context.font = "700 11px sans-serif";
      context.fillText(
        source.kind === "agent" ? statusSymbol(source.status) : ">_",
        0,
        0,
      );
      context.font = "600 9px sans-serif";
      context.fillText(
        shortCanvasLabel(context, source.label, 76),
        0,
        radius + 14,
      );
    } else {
      context.font =
        source.kind === "host" ? "700 13px sans-serif" : "600 11px sans-serif";
      context.fillText(
        shortCanvasLabel(
          context,
          source.label,
          source.kind === "host" ? 98 : 78,
        ),
        0,
        -5,
      );
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
      context.fillText(
        this.#collapsedIds.has(source.id) ? "+" : "−",
        badge,
        -badge,
      );
    }
    if (source.stale) {
      context.fillStyle = "#ef9b85";
      context.font = "700 9px sans-serif";
      context.fillText("STALE", 0, -radius - 10);
    }
    context.restore();
  }

  #point(event: { clientX: number; clientY: number }) {
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.#width;
    const scaleY = rect.height / this.#height;
    return {
      worldX:
        ((event.clientX - rect.left) / scaleX -
          this.#width / 2 -
          this.#camera.x) /
        this.#camera.zoom,
      worldY:
        ((event.clientY - rect.top) / scaleY -
          this.#height / 2 -
          this.#camera.y) /
        this.#camera.zoom,
    };
  }

  #hitNode(worldX: number, worldY: number) {
    return this.#layout
      ? hitGraphNode(this.#layout.nodes, worldX, worldY)
      : null;
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = this.#point(event);
    const node = this.#hitNode(point.worldX, point.worldY);
    const collapse = Boolean(
      (node?.kind === "host" || node?.kind === "space") &&
        Math.hypot(
          point.worldX - (node.x + collapseBadgeOffset(node.kind)),
          point.worldY - (node.y - collapseBadgeOffset(node.kind)),
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
    const rect = this.canvas.getBoundingClientRect();
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
        node.x += dx / this.#camera.zoom;
        node.y += dy / this.#camera.zoom;
        node.pinned = true;
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
    const rect = this.canvas.getBoundingClientRect();
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

  #publishNodes(layout: GraphLayoutState) {
    const published: GraphRendererDiagnostics["publishedNodes"] = {};
    for (const node of layout.nodes.values()) {
      published[node.id] = {
        x: node.x,
        y: node.y,
        screenX: this.#width / 2 + this.#camera.x + node.x * this.#camera.zoom,
        screenY: this.#height / 2 + this.#camera.y + node.y * this.#camera.zoom,
        pinned: node.pinned,
      };
    }
    this.#diagnostics.publishedNodes = published;
  }

  #emitAnchors(layout: GraphLayoutState) {
    if (!this.#onAnchorsChange) return;
    const rect = this.canvas.getBoundingClientRect();
    const scaleX = rect.width / this.#width;
    const scaleY = rect.height / this.#height;
    const anchors: Record<string, OfficeCanvasAnchor> = {};
    for (const requestedId of this.#anchorNodeIds) {
      const node =
        layout.nodes.get(requestedId) ??
        this.#visibleAncestor(layout, requestedId);
      if (!node) continue;
      const rawX =
        rect.left +
        (this.#width / 2 + this.#camera.x + node.x * this.#camera.zoom) *
          scaleX;
      const rawY =
        rect.top +
        (this.#height / 2 + this.#camera.y + node.y * this.#camera.zoom) *
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
  if (!window.__HERDR_GRAPH_RENDERER__) {
    window.__HERDR_GRAPH_RENDERER__ = {
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
  }
  return window.__HERDR_GRAPH_RENDERER__;
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

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: GraphCamera,
) {
  const spacing = 48 * camera.zoom;
  if (spacing < 12) return;
  const offsetX = (((width / 2 + camera.x) % spacing) + spacing) % spacing;
  const offsetY = (((height / 2 + camera.y) % spacing) + spacing) % spacing;
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

function shortCanvasLabel(
  context: CanvasRenderingContext2D,
  label: string,
  maxWidth: number,
) {
  if (context.measureText(label).width <= maxWidth) return label;
  const points = [...label];
  while (
    points.length > 1 &&
    context.measureText(`${points.join("")}…`).width > maxWidth
  ) {
    points.pop();
  }
  return `${points.join("")}…`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
