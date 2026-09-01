import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

import { AGENT_ICON_GLYPHS } from "../../AgentIcon";
import type { AgentIconKind } from "../../AgentIcon";
import {
  graphBounds,
  reconcileGraphLayout,
  savedGraphPositions,
  stepGraphLayout,
} from "./graphLayout";
import type { GraphLayoutNode, GraphLayoutState } from "./graphLayout";
import type { HerdrGraphProjection } from "./herdrGraphProjection";
import type {
  GraphCamera,
  GraphCameraMode,
  GraphViewPrefs,
  SavedGraphPosition,
} from "./graphViewPrefs";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.25;
const MIN_CONVERSATION_CONNECTOR_DISTANCE = 32;

type GraphRendererDiagnostics = {
  mounts: number;
  destroys: number;
  activeRenderers: number;
  activeAnimationFrames: number;
  activeObservers: number;
  activeConversationObservers: number;
  activeListeners: number;
  canvases: number;
  frames: number;
  resizeObservations: number;
  resizeFrames: number;
  ready: boolean;
  paused: boolean;
  nodes: number;
  links: number;
  conversationLinks: number;
};

declare global {
  interface Window {
    __HERDR_GRAPH_RENDERER__?: GraphRendererDiagnostics;
  }
}

export type GraphCanvasHandle = {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
};

export type GraphConversationTarget = {
  id: string;
  selectionKey: string;
  rect: { left: number; top: number; right: number; bottom: number };
};

type GraphCanvasProps = {
  projection: HerdrGraphProjection;
  collapsedIds: ReadonlySet<string>;
  selectedKey: string | null;
  matchedIds: ReadonlySet<string> | null;
  conversationTargets: readonly GraphConversationTarget[];
  initialPrefs: GraphViewPrefs;
  fitOnMount?: boolean;
  onSelect: (selectionKey: string, hostKey: string) => void;
  onActivate: (node: import("./herdrGraphProjection").WorldGraphNode) => void;
  onToggleCollapse: (spaceId: string) => void;
  onViewChange: (
    camera: GraphCamera,
    positions: Record<string, SavedGraphPosition>,
    cameraMode: GraphCameraMode,
  ) => void;
};

export const GraphCanvas = forwardRef<GraphCanvasHandle, GraphCanvasProps>(function GraphCanvas(
  {
    projection,
    collapsedIds,
    selectedKey,
    matchedIds,
    conversationTargets,
    initialPrefs,
    fitOnMount = false,
    onSelect,
    onActivate,
    onToggleCollapse,
    onViewChange,
  },
  ref,
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connectorRef = useRef<SVGSVGElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    const connectors = connectorRef.current;
    if (!host || !canvas || !connectors) return;
    const renderer = new GraphRenderer(canvas, connectors, host, initialPrefs, fitOnMount);
    rendererRef.current = renderer;
    return () => {
      renderer.dispose();
      rendererRef.current = null;
    };
  }, [fitOnMount, initialPrefs]);

  useEffect(() => {
    rendererRef.current?.setCallbacks(onSelect, onActivate, onToggleCollapse, onViewChange);
  }, [onActivate, onSelect, onToggleCollapse, onViewChange]);

  useEffect(() => {
    rendererRef.current?.update(projection, collapsedIds, selectedKey, matchedIds);
  }, [collapsedIds, matchedIds, projection, selectedKey]);

  useEffect(() => {
    rendererRef.current?.setConversationTargets(conversationTargets);
  }, [conversationTargets]);

  useImperativeHandle(ref, () => ({
    fit: () => rendererRef.current?.fit(),
    zoomIn: () => rendererRef.current?.zoomIn(),
    zoomOut: () => rendererRef.current?.zoomOut(),
  }), []);

  return (
    <div ref={hostRef} className="graph-canvas-host">
      <canvas
        ref={canvasRef}
        data-graph-canvas="true"
        aria-hidden="true"
      />
      <svg
        ref={connectorRef}
        className="graph-conversation-connectors"
        data-graph-conversation-connectors="true"
        aria-hidden="true"
      />
    </div>
  );
});

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
  readonly #apply: (value: T) => void;

  constructor(apply: (value: T) => void) {
    this.#apply = apply;
  }

  push(value: T) {
    this.#latest = value;
    if (this.#frame !== null) return;
    this.#frame = window.requestAnimationFrame(() => {
      this.#frame = null;
      const latest = this.#latest;
      this.#latest = null;
      if (latest !== null) this.#apply(latest);
    });
  }

  cancel() {
    if (this.#frame !== null) window.cancelAnimationFrame(this.#frame);
    this.#frame = null;
    this.#latest = null;
  }
}

class GraphRenderer {
  readonly #canvas: HTMLCanvasElement;
  readonly #connectors: SVGSVGElement;
  readonly #context: CanvasRenderingContext2D | null;
  readonly #diagnostics: GraphRendererDiagnostics;
  readonly #resizeValues: LatestFrameValue<{ width: number; height: number }>;
  readonly #resizeObserver: ResizeObserver | null;
  #layout: GraphLayoutState | null = null;
  #savedPositions: Record<string, SavedGraphPosition>;
  #projectionNodeIds: ReadonlySet<string> = new Set();
  #collapsedIds: ReadonlySet<string> = new Set();
  #selectedKey: string | null = null;
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
  #onSelect: (selectionKey: string, hostKey: string) => void = () => {};
  #onActivate: (node: import("./herdrGraphProjection").WorldGraphNode) => void = () => {};
  #conversationTargets: readonly GraphConversationTarget[] = [];
  #conversationParentNodeIds = new Map<string, string>();
  #connectorPaths = new Map<string, { path: SVGPathElement; dot: SVGCircleElement }>();
  #revealedConversationTargetIds = new Set<string>();
  #onToggleCollapse: (spaceId: string) => void = () => {};
  #onViewChange: (
    camera: GraphCamera,
    positions: Record<string, SavedGraphPosition>,
    cameraMode: GraphCameraMode,
  ) => void = () => {};

  constructor(
    canvas: HTMLCanvasElement,
    connectors: SVGSVGElement,
    host: HTMLElement,
    prefs: GraphViewPrefs,
    fitOnMount: boolean,
  ) {
    this.#canvas = canvas;
    this.#connectors = connectors;
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
    this.#resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver((entries) => {
          const entry = entries.at(-1);
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
    onSelect: (selectionKey: string, hostKey: string) => void,
    onActivate: (node: import("./herdrGraphProjection").WorldGraphNode) => void,
    onToggleCollapse: (spaceId: string) => void,
    onViewChange: (
      camera: GraphCamera,
      positions: Record<string, SavedGraphPosition>,
      cameraMode: GraphCameraMode,
    ) => void,
  ) {
    this.#onSelect = onSelect;
    this.#onActivate = onActivate;
    this.#onToggleCollapse = onToggleCollapse;
    this.#onViewChange = onViewChange;
  }

  setConversationTargets(targets: readonly GraphConversationTarget[]) {
    this.#conversationTargets = targets;
    const targetIds = new Set(targets.map(({ id }) => id));
    for (const [id, elements] of this.#connectorPaths) {
      if (targetIds.has(id)) continue;
      elements.path.remove();
      elements.dot.remove();
      this.#connectorPaths.delete(id);
      this.#revealedConversationTargetIds.delete(id);
    }
    for (const target of targets) {
      if (this.#connectorPaths.has(target.id)) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      path.dataset.windowId = target.id;
      dot.dataset.windowId = target.id;
      dot.setAttribute("r", "4");
      this.#connectors.append(path, dot);
      this.#connectorPaths.set(target.id, { path, dot });
    }
    this.#revealPendingConversationTargets();
    this.#diagnostics.conversationLinks = targets.length;
    this.#requestFrame();
  }

  update(
    projection: HerdrGraphProjection,
    collapsedIds: ReadonlySet<string>,
    selectedKey: string | null,
    matchedIds: ReadonlySet<string> | null,
  ) {
    this.#projectionNodeIds = new Set(projection.nodes.map(({ id }) => id));
    this.#conversationParentNodeIds = new Map(projection.nodes.flatMap((node) =>
      node.kind === "terminal" && node.parentId
        ? [[node.selectionKey, node.parentId] as const]
        : []
    ));
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
    this.#selectedKey = selectedKey;
    this.#matchedIds = matchedIds;
    this.#diagnostics.nodes = this.#layout.nodes.size;
    this.#diagnostics.links = this.#layout.edges.length;
    if (reconciled.topologyChanged) this.#alpha = 1;
    this.#revealPendingConversationTargets();
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
      Math.min((this.#width - 96) / graphWidth, (this.#height - 96) / graphHeight),
      MIN_ZOOM,
      2,
    );
    this.#camera = {
      x: -(bounds.minX + bounds.maxX) / 2 * zoom,
      y: -(bounds.minY + bounds.maxY) / 2 * zoom,
      zoom,
    };
    this.#emitViewChange();
    this.#revealedConversationTargetIds.clear();
    this.#revealPendingConversationTargets();
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
    this.#canvas.removeEventListener("pointerdown", this.#onPointerDown);
    this.#canvas.removeEventListener("pointermove", this.#onPointerMove);
    this.#canvas.removeEventListener("pointerup", this.#onPointerUp);
    this.#canvas.removeEventListener("pointercancel", this.#onPointerCancel);
    this.#canvas.removeEventListener("wheel", this.#onWheel);
    this.#canvas.removeEventListener("dblclick", this.#onDoubleClick);
    document.removeEventListener("visibilitychange", this.#onVisibilityChange);
    this.#pointer = null;
    this.#layout?.nodes.clear();
    this.#layout = null;
    this.#canvas.width = 0;
    this.#canvas.height = 0;
    this.#diagnostics.destroys += 1;
    this.#diagnostics.activeRenderers -= 1;
    this.#diagnostics.canvases -= 1;
    this.#diagnostics.activeListeners -= 7;
    if (this.#resizeObserver) this.#diagnostics.activeObservers -= 1;
    this.#diagnostics.ready = this.#diagnostics.activeRenderers > 0;
    this.#diagnostics.paused = this.#diagnostics.activeRenderers > 0 && this.#hidden;
    this.#diagnostics.nodes = 0;
    this.#diagnostics.links = 0;
    this.#diagnostics.conversationLinks = 0;
    for (const elements of this.#connectorPaths.values()) {
      elements.path.remove();
      elements.dot.remove();
    }
    this.#connectorPaths.clear();
    this.#revealedConversationTargetIds.clear();
  }

  #resize(width: number, height: number) {
    const nextWidth = Math.max(1, Math.round(width));
    const nextHeight = Math.max(1, Math.round(height));
    if (nextWidth === this.#width && nextHeight === this.#height) return;
    this.#width = nextWidth;
    this.#height = nextHeight;
    const density = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    this.#canvas.width = Math.round(nextWidth * density);
    this.#canvas.height = Math.round(nextHeight * density);
    this.#canvas.style.width = `${nextWidth}px`;
    this.#canvas.style.height = `${nextHeight}px`;
    this.#connectors.setAttribute("viewBox", `0 0 ${nextWidth} ${nextHeight}`);
    this.#connectors.setAttribute("width", String(nextWidth));
    this.#connectors.setAttribute("height", String(nextHeight));
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
      if (this.#fitWhenSettled && this.#layout && this.#layout.nodes.size > 0) {
        this.fit();
      }
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
    context.fillStyle = "#080812";
    context.fillRect(0, 0, this.#width, this.#height);
    drawGrid(context, this.#width, this.#height, this.#camera);
    context.save();
    context.translate(this.#width / 2 + this.#camera.x, this.#height / 2 + this.#camera.y);
    context.scale(this.#camera.zoom, this.#camera.zoom);
    for (const edge of layout.edges) {
      const source = layout.nodes.get(edge.sourceId);
      const target = layout.nodes.get(edge.targetId);
      if (!source || !target) continue;
      context.beginPath();
      context.moveTo(source.x, source.y);
      context.lineTo(target.x, target.y);
      context.strokeStyle = "rgba(137, 180, 250, 0.34)";
      context.lineWidth = 1.5 / this.#camera.zoom;
      context.stroke();
    }
    const nodes = [...layout.nodes.values()].sort((left, right) =>
      Number(left.kind === "space") - Number(right.kind === "space"),
    );
    for (const node of nodes) this.#drawNode(context, node);
    context.restore();
    this.#drawConversationConnectors(layout);
  }

  #drawNode(context: CanvasRenderingContext2D, node: GraphLayoutNode) {
    const source = node.source;
    const radius = source.kind === "space" ? 47 : 22;
    const matched = !this.#matchedIds || this.#matchedIds.has(source.id);
    context.save();
    context.globalAlpha = matched ? 1 : 0.2;
    context.translate(node.x, node.y);
    context.beginPath();
    context.arc(0, 0, radius, 0, Math.PI * 2);
    context.fillStyle = source.kind === "space" ? "#181825" : statusFill(source.status);
    context.fill();
    context.setLineDash(source.stale ? [5, 4] : []);
    context.lineWidth = source.selectionKey === this.#selectedKey ? 4 : source.focused ? 3 : 1.5;
    context.strokeStyle = source.selectionKey === this.#selectedKey
      ? "#f9e2af"
      : source.focused
        ? "#89b4fa"
        : statusStroke(source.status);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = "#f5e0dc";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = source.kind === "space" ? "600 11px sans-serif" : "700 12px sans-serif";
    if (source.kind === "terminal") {
      drawTerminalGlyph(context, source);
      context.font = "600 9px sans-serif";
      context.fillStyle = "#cdd6f4";
      context.fillText(shortCanvasLabel(context, source.label, 70), 0, radius + 14);
    } else {
      context.fillText(shortCanvasLabel(context, source.label, 76), 0, -5);
      context.font = "500 8px sans-serif";
      context.fillStyle = "#a6adc8";
      context.fillText(shortCanvasLabel(context, source.hostLabel, 72), 0, 11);
      if (source.omittedChildCount > 0) {
        context.fillStyle = "#f9e2af";
        context.fillText(`+${source.omittedChildCount} terminals`, 0, 25);
      }
      context.beginPath();
      context.arc(36, -36, 11, 0, Math.PI * 2);
      context.fillStyle = "#313244";
      context.fill();
      context.strokeStyle = "#89b4fa";
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = "#cdd6f4";
      context.font = "700 14px sans-serif";
      context.fillText(this.#collapsedIds.has(source.id) ? "+" : "−", 36, -36);
    }
    if (source.stale) {
      context.fillStyle = "#f38ba8";
      context.font = "700 10px sans-serif";
      context.fillText(
        source.disconnected ? "OFFLINE" : source.connectionState.toLocaleUpperCase(),
        0,
        -radius - 10,
      );
    }
    context.restore();
  }

  #point(event: { clientX: number; clientY: number }) {
    const rect = this.#canvas.getBoundingClientRect();
    return {
      clientX: event.clientX - rect.left,
      clientY: event.clientY - rect.top,
      worldX: (event.clientX - rect.left - this.#width / 2 - this.#camera.x) / this.#camera.zoom,
      worldY: (event.clientY - rect.top - this.#height / 2 - this.#camera.y) / this.#camera.zoom,
    };
  }

  #hitNode(worldX: number, worldY: number) {
    if (!this.#layout) return null;
    const nodes = [...this.#layout.nodes.values()].reverse();
    for (const node of nodes) {
      if (
        node.kind === "space" &&
        Math.hypot(worldX - (node.x + 36), worldY - (node.y - 36)) <= 14
      ) {
        return node;
      }
      const radius = node.kind === "space" ? 50 : 25;
      if (Math.hypot(worldX - node.x, worldY - node.y) <= radius) return node;
    }
    return null;
  }

  #onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const point = this.#point(event);
    const node = this.#hitNode(point.worldX, point.worldY);
    const collapse = Boolean(
      node?.kind === "space" &&
      Math.hypot(point.worldX - (node.x + 36), point.worldY - (node.y - 36)) <= 14,
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
    this.#canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  #onPointerMove = (event: PointerEvent) => {
    const pointer = this.#pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    const dx = event.clientX - pointer.lastX;
    const dy = event.clientY - pointer.lastY;
    pointer.lastX = event.clientX;
    pointer.lastY = event.clientY;
    pointer.moved ||= Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY) > 4;
    if (!pointer.moved || pointer.mode === "collapse") return;
    if (pointer.mode === "pan") {
      this.#camera = { ...this.#camera, x: this.#camera.x + dx, y: this.#camera.y + dy };
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
    this.#requestFrame();
  };

  #onPointerUp = (event: PointerEvent) => {
    const pointer = this.#pointer;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    this.#pointer = null;
    this.#canvas.releasePointerCapture?.(event.pointerId);
    if (!pointer.moved && pointer.nodeId && this.#layout) {
      const node = this.#layout.nodes.get(pointer.nodeId);
      if (pointer.mode === "collapse" && node?.kind === "space") {
        this.#onToggleCollapse(node.id);
      } else if (node) {
        this.#onSelect(node.source.selectionKey, node.source.hostKey);
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
    const rect = this.#canvas.getBoundingClientRect();
    const pointX = event.clientX - rect.left - this.#width / 2;
    const pointY = event.clientY - rect.top - this.#height / 2;
    this.#zoomAt(
      this.#camera.zoom * Math.exp(-event.deltaY * 0.0015),
      pointX,
      pointY,
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
    this.#requestFrame();
  }

  #onDoubleClick = (event: MouseEvent) => {
    const point = this.#point(event);
    const node = this.#hitNode(point.worldX, point.worldY);
    if (node?.source.kind !== "terminal" || !node.source.actionable) return;
    event.preventDefault();
    this.#onActivate(node.source);
  };

  #drawConversationConnectors(layout: GraphLayoutState) {
    const nodesBySelectionKey = new Map(
      [...layout.nodes.values()].map((node) => [node.source.selectionKey, node]),
    );
    for (const target of this.#conversationTargets) {
      const elements = this.#connectorPaths.get(target.id);
      let node = nodesBySelectionKey.get(target.selectionKey);
      let anchorKind = "terminal";
      if (!node) {
        const parentId = this.#conversationParentNodeIds.get(target.selectionKey);
        node = parentId ? layout.nodes.get(parentId) : undefined;
        anchorKind = "collapsed-parent";
      }
      if (!elements || !node) {
        elements?.path.setAttribute("visibility", "hidden");
        elements?.dot.setAttribute("visibility", "hidden");
        if (elements) {
          delete elements.path.dataset.anchorKind;
          delete elements.dot.dataset.anchorKind;
        }
        continue;
      }
      elements.path.dataset.anchorKind = anchorKind;
      elements.dot.dataset.anchorKind = anchorKind;
      const nodeX = this.#width / 2 + this.#camera.x + node.x * this.#camera.zoom;
      const nodeY = this.#height / 2 + this.#camera.y + node.y * this.#camera.zoom;
      const edges = [
        { x: target.rect.left, y: clamp(nodeY, target.rect.top + 18, target.rect.bottom - 18) },
        { x: target.rect.right, y: clamp(nodeY, target.rect.top + 18, target.rect.bottom - 18) },
        { x: clamp(nodeX, target.rect.left + 18, target.rect.right - 18), y: target.rect.top },
        { x: clamp(nodeX, target.rect.left + 18, target.rect.right - 18), y: target.rect.bottom },
      ];
      const bubble = edges.reduce((nearest, candidate) =>
        Math.hypot(candidate.x - nodeX, candidate.y - nodeY) <
        Math.hypot(nearest.x - nodeX, nearest.y - nodeY)
          ? candidate
          : nearest,
      );
      const deltaX = bubble.x - nodeX;
      const deltaY = bubble.y - nodeY;
      elements.path.setAttribute(
        "d",
        `M ${nodeX} ${nodeY} C ${nodeX + deltaX * 0.42} ${nodeY + deltaY * 0.12}, ${bubble.x - deltaX * 0.12} ${bubble.y - deltaY * 0.42}, ${bubble.x} ${bubble.y}`,
      );
      elements.path.removeAttribute("visibility");
      elements.dot.setAttribute("cx", String(nodeX));
      elements.dot.setAttribute("cy", String(nodeY));
      elements.dot.removeAttribute("visibility");
    }
  }

  #revealPendingConversationTargets() {
    for (const target of this.#conversationTargets) {
      if (this.#revealedConversationTargetIds.has(target.id)) continue;
      if (this.#revealConversationTarget(target)) {
        this.#revealedConversationTargetIds.add(target.id);
      }
    }
  }

  #revealConversationTarget(target: GraphConversationTarget) {
    const layout = this.#layout;
    if (!layout) return false;
    const nodesBySelectionKey = new Map(
      [...layout.nodes.values()].map((node) => [node.source.selectionKey, node]),
    );
    const parentId = this.#conversationParentNodeIds.get(target.selectionKey);
    const node = nodesBySelectionKey.get(target.selectionKey) ??
      (parentId ? layout.nodes.get(parentId) : undefined);
    if (!node) return false;
    const nudge = graphConversationCameraNudge({
      x: this.#width / 2 + this.#camera.x + node.x * this.#camera.zoom,
      y: this.#height / 2 + this.#camera.y + node.y * this.#camera.zoom,
    }, target.rect);
    if (nudge.x !== 0 || nudge.y !== 0) {
      this.#camera = {
        ...this.#camera,
        x: this.#camera.x + nudge.x,
        y: this.#camera.y + nudge.y,
      };
    }
    return true;
  }

  #onVisibilityChange = () => {
    this.#hidden = document.visibilityState === "hidden";
    this.#diagnostics.paused = this.#hidden;
    if (this.#hidden) {
      this.#cancelFrame();
    } else {
      this.#requestFrame();
    }
  };

  #emitViewChange() {
    if (!this.#layout) return;
    this.#savedPositions = retainedGraphPositions(
      this.#savedPositions,
      this.#layout,
      this.#projectionNodeIds,
    );
    this.#onViewChange({ ...this.#camera }, this.#savedPositions, this.#cameraMode);
  }
}

export function graphConversationCameraNudge(
  point: { x: number; y: number },
  overlay: GraphConversationTarget["rect"],
) {
  const outsideX = Math.max(overlay.left - point.x, 0, point.x - overlay.right);
  const outsideY = Math.max(overlay.top - point.y, 0, point.y - overlay.bottom);
  if (Math.hypot(outsideX, outsideY) >= MIN_CONVERSATION_CONNECTOR_DISTANCE) {
    return { x: 0, y: 0 };
  }
  return [
    { x: overlay.left - MIN_CONVERSATION_CONNECTOR_DISTANCE - point.x, y: 0 },
    { x: overlay.right + MIN_CONVERSATION_CONNECTOR_DISTANCE - point.x, y: 0 },
    { x: 0, y: overlay.top - MIN_CONVERSATION_CONNECTOR_DISTANCE - point.y },
    { x: 0, y: overlay.bottom + MIN_CONVERSATION_CONNECTOR_DISTANCE - point.y },
  ].reduce((nearest, candidate) =>
    Math.hypot(candidate.x, candidate.y) < Math.hypot(nearest.x, nearest.y)
      ? candidate
      : nearest
  );
}

function graphRendererDiagnostics() {
  if (!window.__HERDR_GRAPH_RENDERER__) {
    window.__HERDR_GRAPH_RENDERER__ = {
      mounts: 0,
      destroys: 0,
      activeRenderers: 0,
      activeAnimationFrames: 0,
      activeObservers: 0,
      activeConversationObservers: 0,
      activeListeners: 0,
      canvases: 0,
      frames: 0,
      resizeObservations: 0,
      resizeFrames: 0,
      ready: false,
      paused: false,
      nodes: 0,
      links: 0,
      conversationLinks: 0,
    };
  }
  return window.__HERDR_GRAPH_RENDERER__;
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera: GraphCamera,
) {
  const spacing = 48 * camera.zoom;
  if (spacing < 12) return;
  const offsetX = ((width / 2 + camera.x) % spacing + spacing) % spacing;
  const offsetY = ((height / 2 + camera.y) % spacing + spacing) % spacing;
  context.beginPath();
  for (let x = offsetX; x < width; x += spacing) {
    context.moveTo(x, 0);
    context.lineTo(x, height);
  }
  for (let y = offsetY; y < height; y += spacing) {
    context.moveTo(0, y);
    context.lineTo(width, y);
  }
  context.strokeStyle = "rgba(88, 91, 112, 0.16)";
  context.lineWidth = 1;
  context.stroke();
}

function statusFill(status: string) {
  return status === "working" ? "#24433d"
    : status === "blocked" ? "#4a2838"
      : status === "done" ? "#243c45"
        : status === "idle" ? "#373347"
          : "#28283a";
}

function statusStroke(status: string) {
  return status === "working" ? "#a6e3a1"
    : status === "blocked" ? "#f38ba8"
      : status === "done" ? "#89dceb"
        : status === "idle" ? "#cba6f7"
          : "#7f849c";
}

export type GraphTerminalGlyphKind = AgentIconKind | "generic-agent" | "terminal";

export function graphTerminalGlyphKind(
  node: Pick<import("./herdrGraphProjection").WorldGraphNode, "agentKind" | "agentRunning">,
): GraphTerminalGlyphKind {
  return node.agentKind ?? (node.agentRunning ? "generic-agent" : "terminal");
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

const OUTLINE_GLYPHS = {
  "generic-agent": "M12 8V4H8 M6 8h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2 M2 14h2 M20 14h2 M15 13v2 M9 13v2",
  terminal: "m7 11 2-2-2-2 M11 13h4 M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2",
} as const;

const canvasPathCache = new Map<string, Path2D>();

function drawTerminalGlyph(
  context: CanvasRenderingContext2D,
  node: import("./herdrGraphProjection").WorldGraphNode,
) {
  const kind = graphTerminalGlyphKind(node);
  context.save();
  context.translate(0, -2);
  if (kind === "generic-agent" || kind === "terminal") {
    const scale = 0.76;
    context.scale(scale, scale);
    context.translate(-12, -12);
    context.strokeStyle = "#f5e0dc";
    context.lineWidth = 2;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.stroke(canvasPath(OUTLINE_GLYPHS[kind]));
  } else {
    const glyph = AGENT_ICON_GLYPHS[kind];
    const [minX, minY, width, height] = glyph.viewBox.split(" ").map(Number);
    const scale = Math.min(18 / width, 18 / height);
    context.scale(scale, scale);
    context.translate(-(minX + width / 2), -(minY + height / 2));
    context.fillStyle = kind === "claude" ? "#d97757" : "#f5e0dc";
    const inheritedAlpha = context.globalAlpha;
    for (const path of glyph.paths) {
      context.globalAlpha = inheritedAlpha * (path.opacity ?? 1);
      context.fill(canvasPath(path.d), path.fillRule ?? "nonzero");
    }
  }
  context.restore();

  context.beginPath();
  context.arc(15, -15, 6.5, 0, Math.PI * 2);
  context.fillStyle = "#080812";
  context.fill();
  context.lineWidth = 1.25;
  context.strokeStyle = statusStroke(node.status);
  context.stroke();
  context.fillStyle = "#f5e0dc";
  context.font = "700 7px sans-serif";
  context.fillText(statusSymbol(node.status), 15, -14.5);
}

function canvasPath(data: string) {
  const existing = canvasPathCache.get(data);
  if (existing) return existing;
  const path = new Path2D(data);
  canvasPathCache.set(data, path);
  return path;
}

function statusSymbol(status: string) {
  return status === "working" ? "▶"
    : status === "blocked" ? "!"
      : status === "done" ? "✓"
        : status === "idle" ? "○"
          : "?";
}

function shortCanvasLabel(context: CanvasRenderingContext2D, label: string, maxWidth: number) {
  if (context.measureText(label).width <= maxWidth) return label;
  const points = [...label];
  while (points.length > 1 && context.measureText(`${points.join("")}…`).width > maxWidth) {
    points.pop();
  }
  return `${points.join("")}…`;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
