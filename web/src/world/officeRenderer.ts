/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */
// Pixi's CSP-safe polyfill replaces its generated Function paths with static synchronizers.
import "pixi.js/unsafe-eval";
import {
  Application,
  CanvasSource,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  UPDATE_PRIORITY,
} from "pixi.js";
import type {
  HerdrOfficeProjection,
  OfficeAgent,
  OfficeDesk,
  OfficeHost,
  OfficeReception,
  OfficeRoom,
} from "./herdrOfficeProjection";
import {
  agentBarSlot,
  deskAnchor,
  OFFICE_GEOMETRY,
  receptionAgentAnchor,
  receptionTableRect,
  standingAnchor,
} from "./officeGeometry";
import type {
  OfficeCeoBlockLayout,
  OfficeLayout,
  OfficeLongRoomTitleMode,
  OfficeReceptionRect,
  OfficeRoomAlignment,
  OfficeRoomRect,
} from "./officeGeometry";
import {
  OfficeLayoutPublisher,
  resolveOfficeGeometry,
} from "./officeLayout";
import type {
  OfficeGeometryRoomDescriptor,
  PublishedOfficeLayout,
} from "./officeLayout";
import {
  minimumRoomWidthForTitleBox,
  officeHeaderLabels,
} from "./officeLayout";
import { officeDebug } from "../officeDebug";
import { officeSceneSignature } from "./officeSceneSignature";
import {
  destroyOfficeSceneChildren,
  OFFICE_SCENE_DESTROY_OPTIONS,
} from "./officeRendererResources";
import type { OfficeObservability } from "./officeObservability";
import {
  formatOfficeCost,
  formatOfficeModelName,
  officeModelUsageTotal,
  formatOfficeUsage,
} from "./officeObservability";

const CHARACTER_URLS = Array.from(
  { length: 12 },
  (_, index) => `/world/characters/${index + 1}-D-1.png`,
);

const OFFICE_HEADING_TEXT_SIZE = 13;

const pointerSequences = new WeakMap<
  (key: string) => void,
  {
    key: string;
    at: number;
    x: number;
    y: number;
    activate?: (key: string) => void;
  }
>();
const canvasActivationCandidates = new WeakMap<
  (key: string) => void,
  {
    key: string;
    at: number;
    x: number;
    y: number;
    activate: (key: string) => void;
  }
>();
const THEMES = Object.freeze([
  { floorA: 0x0c1620, floorB: 0x0a121c, wall: 0x1e3050, accent: 0x4aa3d8 },
  { floorA: 0x120c20, floorB: 0x100a1e, wall: 0x34215a, accent: 0x9a6bd1 },
  { floorA: 0x18140c, floorB: 0x16120a, wall: 0x463522, accent: 0xd69540 },
  { floorA: 0x0c1a18, floorB: 0x0a1614, wall: 0x20503d, accent: 0x51b677 },
  { floorA: 0x1a0c10, floorB: 0x180a0e, wall: 0x51232b, accent: 0xd45d70 },
  { floorA: 0x18100c, floorB: 0x160e0a, wall: 0x482d22, accent: 0xcf7944 },
]);

const STATUS_CUES = Object.freeze({
  working: { label: "WORKING", color: 0x67d6c0 },
  idle: { label: "IDLE", color: 0x8d9aae },
  blocked: { label: "NEEDS INPUT", color: 0xec8799 },
  done: { label: "DONE", color: 0xf0c878 },
  unknown: { label: "UNKNOWN", color: 0xc29add },
});

const VIRTUAL_ROOM_ROW_OVERSCAN = 4;

type AnimatedItem =
  | { kind: "character"; node: Container; baseY: number; phase: number }
  | { kind: "monitor" | "status"; node: Container | Graphics; baseAlpha: number; phase: number };

export type OfficeRendererDiagnostics = {
  mounts: number;
  destroys: number;
  activeApplications: number;
  activeTickers: number;
  activeObservers: number;
  activeListeners: number;
  canvases: number;
  frames: number;
  sceneRenders: number;
  sceneSkips: number;
  ready: boolean;
  reducedMotion: boolean;
  lastError: string | null;
  animation: {
    characters: number;
    monitors: number;
    statuses: number;
  };
  layout: null | {
    officeWidth: number;
    totalHeight: number;
    rooms: number;
    characterHeight: number;
    ceoBandHeight: number;
    viewportHeight: number;
  };
  /** Browser-test and observability hook for the immutable layout consumed by both presenters. */
  publishedLayout: PublishedOfficeLayout | null;
  completionMarkers: number;
};

declare global {
  interface Window {
    __HERDR_WORLD_FORCE_RENDERER_FAILURE__?: boolean;
    __HERDR_WORLD_RENDERER__?: OfficeRendererDiagnostics;
  }
}

export type OfficeRendererController = {
  update: (
    projection: HerdrOfficeProjection,
    selectedKey: string | null,
    completionSeenKeys?: ReadonlySet<string>,
    observability?: OfficeObservability,
    roomAlignment?: OfficeRoomAlignment,
    longRoomTitleMode?: OfficeLongRoomTitleMode,
  ) => void;
  getAnchors: (
    selectedKey: string | null,
    conversationTargetKey: string | null,
  ) => OfficeRendererAnchors;
  destroy: () => void;
};

export type OfficeRendererAnchor = {
  x: number;
  y: number;
};

export type OfficeCanvasHover = {
  key: string;
  clientX: number;
  clientY: number;
};

export type OfficeRendererAnchors = {
  agent: OfficeRendererAnchor | null;
  workbench: OfficeRendererAnchor | null;
};

export async function createOfficeRenderer(
  element: HTMLElement,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  observability: OfficeObservability,
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  onActivateRoom: (key: string) => void,
  canCreateSeat: (roomKey: string) => boolean,
  onNewSeat: (roomKey: string) => void,
  onHover: (hover: OfficeCanvasHover | null) => void,
  onLayoutChange: (layout: PublishedOfficeLayout | null) => void,
  onCanvasRendered: (revision: number) => void,
  roomAlignment: OfficeRoomAlignment,
  longRoomTitleMode: OfficeLongRoomTitleMode,
): Promise<OfficeRendererController> {
  officeDebug("renderer:create-start", {
    rooms: projection.rooms.length,
    agents: projection.roster.length,
    desks: projection.deskRoster.length,
  });
  if (window.__HERDR_WORLD_FORCE_RENDERER_FAILURE__) {
    throw new Error("renderer unavailable");
  }
  const diagnostics = ensureDiagnostics();
  diagnostics.mounts += 1;
  diagnostics.activeApplications += 1;
  diagnostics.activeTickers += 1;
  diagnostics.ready = false;

  const app = new Application();
  let disposed = false;
  let currentProjection = projection;
  let currentSelectedKey = selectedKey;
  let currentCompletionSeenKeys = completionSeenKeys;
  let currentObservability = observability;
  let currentRoomAlignment = roomAlignment;
  let currentLongRoomTitleMode = longRoomTitleMode;
  const layoutPublisher = new OfficeLayoutPublisher();
  let currentLayout: PublishedOfficeLayout | null = null;
  let lastWidth = 0;
  let resizeTimer: number | null = null;
  let lastRendererSize = { width: 0, height: 0 };
  let lastSceneSignature: string | null = null;
  let tick = 0;
  let pendingRenderRevision = 0;
  let currentFontReady = officeFontReady();
  const animated: AnimatedItem[] = [];
  const scrollElement = element.closest<HTMLElement>(".world-stage-scroll");
  const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionPreference.matches;

  try {
    await app.init({
      width: OFFICE_GEOMETRY.minOfficeWidth,
      height: 640,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      roundPixels: true,
      preference: "webgl",
    });
  } catch (error) {
    diagnostics.activeApplications = Math.max(0, diagnostics.activeApplications - 1);
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    throw error;
  }
  if (disposed) {
    app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
    throw new Error("renderer disposed");
  }
  officeDebug("renderer:pixi-ready");
  const canvas = app.canvas;
  element.replaceChildren(canvas);
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-office-canvas", "true");
  canvas.style.imageRendering = "auto";
  diagnostics.canvases = document.querySelectorAll("canvas[data-office-canvas='true']").length;
  diagnostics.lastError = null;

  const textures = await Promise.all(
    CHARACTER_URLS.map((url) => loadTexture(url).catch(() => Texture.EMPTY)),
  );
  officeDebug("renderer:textures-ready", {
    textures: textures.filter((texture) => texture !== Texture.EMPTY).length,
  });
  if (disposed) {
    app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
    destroyTextures(textures);
    diagnostics.destroys += 1;
    diagnostics.activeApplications = Math.max(0, diagnostics.activeApplications - 1);
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    throw new Error("renderer disposed");
  }

  const select = (key: string) => {
    if (!disposed) {
      onSelect(key);
    }
  };
  const activateAgent = (key: string) => {
    if (!disposed) {
      onActivateAgent(key);
    }
  };
  const activateRoom = (key: string) => {
    if (!disposed) {
      onActivateRoom(key);
    }
  };
  const hover = (event: PointerEvent) => {
    let target: Container | null = app.renderer.events.rootBoundary.hitTest(
      event.offsetX,
      event.offsetY,
    );
    while (target && !target.label) {
      target = target.parent;
    }
    if (!target?.label) {
      onHover(null);
      return;
    }
    onHover({
      key: target.label,
      clientX: event.clientX,
      clientY: event.clientY,
    });
  };
  const leave = () => onHover(null);
  app.canvas.addEventListener("pointermove", hover);
  app.canvas.addEventListener("pointerleave", leave);
  const onCanvasDoubleClick = (event: MouseEvent) => {
    const prior = canvasActivationCandidates.get(select);
    if (!prior) {
      return;
    }
    const closeToFirstClick = Math.hypot(
      event.offsetX - prior.x,
      event.offsetY - prior.y,
    ) <= 12;
    const current = window.performance.now() - prior.at <= 1_000;
    pointerSequences.delete(select);
    canvasActivationCandidates.delete(select);
    if (closeToFirstClick && current) {
      prior.activate(prior.key);
    }
  };
  app.canvas.addEventListener("dblclick", onCanvasDoubleClick);
  diagnostics.activeListeners += 3;

  const renderScene = (layout: OfficeLayout) => {
    if (disposed) {
      return;
    }
    const scrollTop = scrollElement?.scrollTop ?? 0;
    const viewportHeight = Math.min(
      layout.totalHeight,
      Math.max(1, scrollElement?.clientHeight ?? layout.totalHeight),
    );
    const largestRoomHeight = Math.max(
      OFFICE_GEOMETRY.minRoomHeight,
      ...layout.rooms.map(({ height }) => height),
    );
    const overscan =
      (largestRoomHeight + Math.max(OFFICE_GEOMETRY.roomGap, OFFICE_GEOMETRY.roomRowGap)) *
      VIRTUAL_ROOM_ROW_OVERSCAN;
    const visibleRooms = layout.rooms.filter(
      (room) => room.y + room.height >= scrollTop - overscan
        && room.y <= scrollTop + viewportHeight + overscan,
    );
    const sceneSignature = officeSceneSignature({
      layout,
      projection: currentProjection,
      selectedKey: currentSelectedKey,
      completionSeenKeys: currentCompletionSeenKeys,
      observability: currentObservability,
      visibleRoomIndices: visibleRooms.map(({ index }) => index),
    });
    if (sceneSignature === lastSceneSignature) {
      diagnostics.sceneSkips += 1;
      return;
    }
    lastSceneSignature = sceneSignature;
    diagnostics.sceneRenders += 1;
    animated.splice(0);
    destroyOfficeSceneChildren(app.stage);
    drawBackground(app.stage, layout);
    drawCeoReception(
      app.stage,
      layout,
      currentProjection,
      currentObservability,
      currentSelectedKey,
      textures,
      animated,
      select,
      activateAgent,
    );
    drawHallways(app.stage, layout);
    visibleRooms.forEach((rect) => {
      const room = currentProjection.rooms[rect.index];
      if (room) {
        drawRoom(
          app.stage,
          room,
          rect,
          currentProjection,
          currentSelectedKey,
          currentCompletionSeenKeys,
          textures,
          animated,
          select,
          activateAgent,
          activateRoom,
          canCreateSeat,
          onNewSeat,
        );
      }
    });
    // Room floors/borders must not cover the road bands between rows and
    // columns. The road pass uses the resolved outer rectangles, so it is
    // safe to paint after rooms without entering their mathematical bounds.
    drawRoomRoads(app.stage, layout);
    if (!diagnostics.ready) {
      officeDebug("renderer:scene-ready", {
        rooms: layout.rooms.length,
        officeWidth: layout.officeWidth,
      });
    }
    diagnostics.ready = true;
    diagnostics.reducedMotion = reducedMotion;
    diagnostics.animation = {
      characters: animated.filter(({ kind }) => kind === "character").length,
      monitors: animated.filter(({ kind }) => kind === "monitor").length,
      statuses: animated.filter(({ kind }) => kind === "status").length,
    };
    diagnostics.completionMarkers = currentProjection.rooms.reduce(
      (count, room) => count + room.desks.reduce((deskCount, desk) =>
        deskCount + desk.completionAgentKeys.filter(
          (key) => !currentCompletionSeenKeys.has(key),
        ).length,
      0),
      0,
    );
  };

  const syncScrollPosition = () => {
    app.stage.position.y = -(scrollElement?.scrollTop ?? 0);
    if (currentLayout) {
      renderScene(currentLayout);
    }
  };
  if (scrollElement) {
    scrollElement.addEventListener("scroll", syncScrollPosition, { passive: true });
    diagnostics.activeListeners += 1;
  }

  const acknowledgeAfterRenderedFrame = (revision: number) => {
    pendingRenderRevision = revision;
    app.ticker.addOnce(() => {
      if (disposed || pendingRenderRevision !== revision || currentLayout?.layoutRevision !== revision) {
        return;
      }
      if (layoutPublisher.ackCanvasRendered(revision)) {
        onCanvasRendered(revision);
      }
    }, undefined, UPDATE_PRIORITY.UTILITY);
  };

  const build = (requestedWidth = element.clientWidth) => {
    if (disposed) {
      return;
    }
    const viewportWidth = scrollElement?.clientWidth ?? element.clientWidth;
    const width = Math.floor(viewportWidth || requestedWidth || 0);
    const roomDescriptors: OfficeGeometryRoomDescriptor[] = currentProjection.rooms.map((room) => {
      const host = currentProjection.hosts.find(({ key }) => key === room.hostKey);
      const roomTitle = room.accessibleLabel ?? room.displayLabel;
      const hostTitle = host?.accessibleLabel ?? host?.displayLabel ?? "host";
      const measuredHeader = measureOfficeRoomHeader(
        roomTitle,
        hostTitle,
        currentLongRoomTitleMode,
      );
      return {
        id: room.key,
        role: "work",
        region: "work",
        title: roomTitle,
        hostTitle,
        visualTitle: measuredHeader.workspace,
        visualHostTitle: measuredHeader.host,
        headerMinTitleBoxWidth: measuredHeader.titleBoxWidth,
        headerMinWidth: measuredHeader.roomWidth,
        deskCount: room.desks.length + (
          canCreateSeat(room.key) && room.desks.length < OFFICE_GEOMETRY.desksPerRoom ? 1 : 0
        ),
        standingCount: room.roomAgents.filter(({ placement }) => placement === "standing").length,
        actions: {
          rename: true,
          close: true,
          createSeat: canCreateSeat(room.key),
        },
      };
    });
    const geometry = resolveOfficeGeometry({
      availableViewportWidth: width,
      availableViewportHeight: scrollElement?.clientHeight ?? 0,
      titleMode: currentLongRoomTitleMode,
      roomAlignment: currentRoomAlignment,
      ceoReceptionCount: currentProjection.receptions.length,
      fontKey: "Inter, ui-sans-serif, system-ui, sans-serif",
      fontReady: currentFontReady,
      rooms: roomDescriptors,
    });
    const layout = layoutPublisher.publish(
      { canonicalDigest: geometry.inputDigest },
      geometry,
    );
    const viewportHeight = Math.min(
      layout.totalHeight,
      Math.max(1, scrollElement?.clientHeight ?? layout.totalHeight),
    );
    currentLayout = layout;
    diagnostics.publishedLayout = layout;
    onLayoutChange(layout);
    lastWidth = layout.officeWidth;
    if (
      lastRendererSize.width !== layout.officeWidth ||
      lastRendererSize.height !== viewportHeight
    ) {
      app.renderer.resize(layout.officeWidth, viewportHeight);
      lastRendererSize = { width: layout.officeWidth, height: viewportHeight };
    }
    element.style.width = `${layout.officeWidth}px`;
    element.style.height = `${layout.totalHeight}px`;
    app.stage.position.y = -(scrollElement?.scrollTop ?? 0);
    renderScene(layout);
    acknowledgeAfterRenderedFrame(layout.layoutRevision);
    diagnostics.layout = {
      officeWidth: layout.officeWidth,
      totalHeight: layout.totalHeight,
      rooms: layout.rooms.length,
      characterHeight: OFFICE_GEOMETRY.characterHeight,
      ceoBandHeight: layout.ceoBandHeight,
      viewportHeight,
    };
  };

  const ticker = () => {
    diagnostics.frames += 1;
    tick += 1;
    if (reducedMotion) {
      return;
    }
    for (const item of animated) {
      const wave = Math.sin(tick * 0.075 + item.phase);
      if (item.kind === "character") {
        item.node.y = item.baseY + wave * 2;
      } else if (item.kind === "monitor") {
        item.node.alpha = item.baseAlpha + (wave + 1) * 0.15;
      } else {
        item.node.alpha = 0.82 + (wave + 1) * 0.09;
      }
    }
  };
  app.ticker.add(ticker);

  const fontSet = document.fonts;
  const refreshFontMetrics = () => {
    if (disposed) {
      return;
    }
    const ready = officeFontReady();
    currentFontReady = ready;
    lastSceneSignature = null;
    build(lastWidth || element.clientWidth);
  };
  fontSet?.addEventListener("loadingdone", refreshFontMetrics);
  if (fontSet) {
    void fontSet.ready.then(refreshFontMetrics);
    diagnostics.activeListeners += 1;
  }

  const onMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    diagnostics.reducedMotion = reducedMotion;
    if (reducedMotion) {
      for (const item of animated) {
        if (item.kind === "character") {
          item.node.y = item.baseY;
        } else {
          item.node.alpha = item.baseAlpha;
        }
      }
    }
  };
  motionPreference.addEventListener("change", onMotionChange);
  diagnostics.activeListeners += 1;

  const observer = new ResizeObserver((entries) => {
    const nextWidth = Math.max(
      OFFICE_GEOMETRY.minOfficeWidth,
      Math.floor(entries[0]?.contentRect.width || 0),
    );
    if (Math.abs(nextWidth - lastWidth) <= 10) {
      return;
    }
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      build(nextWidth);
    }, 80);
  });
  observer.observe(scrollElement ?? element);
  diagnostics.activeObservers += 1;
  try {
    build();
  } catch (error) {
    observer.disconnect();
    motionPreference.removeEventListener("change", onMotionChange);
    fontSet?.removeEventListener("loadingdone", refreshFontMetrics);
    scrollElement?.removeEventListener("scroll", syncScrollPosition);
    app.canvas.removeEventListener("pointermove", hover);
    app.canvas.removeEventListener("pointerleave", leave);
    app.canvas.removeEventListener("dblclick", onCanvasDoubleClick);
    pointerSequences.delete(select);
    canvasActivationCandidates.delete(select);
    app.ticker.remove(ticker);
    app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
    destroyTextures(textures);
    diagnostics.activeApplications = Math.max(0, diagnostics.activeApplications - 1);
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    diagnostics.activeObservers = Math.max(0, diagnostics.activeObservers - 1);
    diagnostics.activeListeners = Math.max(
      0,
      diagnostics.activeListeners - (scrollElement ? 6 : 5),
    );
    throw error;
  }

  return {
    update(
      nextProjection,
      nextSelectedKey,
      nextCompletionSeenKeys = currentCompletionSeenKeys,
      nextObservability = currentObservability,
      nextRoomAlignment = currentRoomAlignment,
      nextLongRoomTitleMode = currentLongRoomTitleMode,
    ) {
      if (
        nextRoomAlignment !== currentRoomAlignment ||
        nextLongRoomTitleMode !== currentLongRoomTitleMode
      ) {
        currentRoomAlignment = nextRoomAlignment;
        currentLongRoomTitleMode = nextLongRoomTitleMode;
        lastSceneSignature = null;
      }
      currentProjection = nextProjection;
      currentSelectedKey = nextSelectedKey;
      currentCompletionSeenKeys = nextCompletionSeenKeys;
      currentObservability = nextObservability;
      build(lastWidth || element.clientWidth);
    },
    getAnchors(selectedKey, conversationTargetKey) {
      return currentLayout
        ? resolveOfficeAnchors(
            currentProjection,
            currentLayout,
            selectedKey,
            conversationTargetKey,
          )
        : { agent: null, workbench: null };
    },
    destroy() {
      if (disposed) {
        return;
      }
      disposed = true;
      const ownsCanvas = element.contains(canvas);
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      observer.disconnect();
      motionPreference.removeEventListener("change", onMotionChange);
      fontSet?.removeEventListener("loadingdone", refreshFontMetrics);
      scrollElement?.removeEventListener("scroll", syncScrollPosition);
      app.canvas.removeEventListener("pointermove", hover);
      app.canvas.removeEventListener("pointerleave", leave);
      app.canvas.removeEventListener("dblclick", onCanvasDoubleClick);
      pointerSequences.delete(select);
      canvasActivationCandidates.delete(select);
      app.ticker.remove(ticker);
      app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
      destroyTextures(textures);
      if (ownsCanvas) {
        element.replaceChildren();
      }
      element.style.removeProperty("width");
      element.style.removeProperty("height");
      diagnostics.destroys += 1;
      diagnostics.activeApplications = Math.max(0, diagnostics.activeApplications - 1);
      diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
      diagnostics.activeObservers = Math.max(0, diagnostics.activeObservers - 1);
      diagnostics.activeListeners = Math.max(
        0,
        diagnostics.activeListeners - (scrollElement ? 6 : 5),
      );
      diagnostics.canvases = document.querySelectorAll("canvas[data-office-canvas='true']").length;
      diagnostics.ready = false;
      diagnostics.publishedLayout = null;
      onLayoutChange(null);
    },
  };
}

function resolveOfficeAnchors(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  selectedKey: string | null,
  conversationTargetKey: string | null,
): OfficeRendererAnchors {
  const agentEntry = selectedKey
    ? projection.roster.find(({ agent }) => agent.key === selectedKey) ?? null
    : null;
  const directDesk = conversationTargetKey
    ? projection.deskRoster.find(({ desk }) => desk.key === conversationTargetKey)?.desk ?? null
    : null;
  const selectedDesk = !agentEntry && selectedKey
    ? projection.deskRoster.find(({ desk }) => desk.key === selectedKey)?.desk ?? null
    : null;
  const agentDesk = agentEntry?.agent.deskKey
    ? projection.deskRoster.find(({ desk }) => desk.key === agentEntry.agent.deskKey)?.desk ?? null
    : null;
  return {
    agent: agentEntry
      ? resolveOfficeAgentAnchor(projection, layout, agentEntry.agent.key)
      : null,
    workbench: resolveOfficeDeskAnchor(projection, layout, directDesk ?? agentDesk ?? selectedDesk),
  };
}

function resolveOfficeDeskAnchor(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  desk: OfficeDesk | null,
): OfficeRendererAnchor | null {
  if (!desk) {
    return null;
  }
  const roomIndex = projection.rooms.findIndex(({ key }) => key === desk.roomKey);
  const room = projection.rooms[roomIndex];
  const rect = layout.rooms.find(({ index }) => index === roomIndex);
  if (!room || !rect) {
    return null;
  }
  const deskIndex = room.desks.findIndex(({ key }) => key === desk.key);
  if (deskIndex < 0) {
    return null;
  }
  const anchor = deskAnchor(rect, deskIndex);
  return { x: anchor.x, y: anchor.deskY + 10 };
}

function resolveOfficeAgentAnchor(
  projection: HerdrOfficeProjection,
  layout: OfficeLayout,
  key: string,
): OfficeRendererAnchor | null {
  const entry = projection.roster.find(({ agent }) => agent.key === key);
  if (!entry) {
    return null;
  }
  const agent = entry.agent;
  if (agent.destination === "reception") {
    const receptionIndex = projection.receptions.findIndex(
      (reception) => reception.hostKey === agent.hostKey,
    );
    const reception = projection.receptions[receptionIndex];
    const rect = layout.ceoBlocks.receptions[receptionIndex];
    if (!reception || !rect) {
      return null;
    }
    const index = reception.waitingAgents.findIndex(({ key: agentKey }) => agentKey === key);
    if (index < 0) {
      return null;
    }
    const anchor = receptionAgentAnchor(rect, index);
    return { x: anchor.x, y: anchor.characterFeetY - 42 };
  }
  if (agent.destination === "bar") {
    const barIndex = projection.barAgents.findIndex(({ key: agentKey }) => agentKey === key);
    if (barIndex < 0) {
      return null;
    }
    const slot = agentBarSlot(layout.ceoBlocks, barIndex);
    return { x: slot.x, y: slot.characterFeetY - 42 };
  }
  const roomIndex = projection.rooms.findIndex(({ key: roomKey }) => roomKey === agent.roomKey);
  const room = projection.rooms[roomIndex];
  const rect = layout.rooms.find(({ index }) => index === roomIndex);
  if (!room || !rect) {
    return null;
  }
  if (agent.placement === "seated") {
    const deskIndex = room.desks.findIndex(({ occupantAgentKey }) => occupantAgentKey === key);
    if (deskIndex >= 0) {
      const anchor = deskAnchor(rect, deskIndex);
      return { x: anchor.x, y: anchor.characterFeetY - 42 };
    }
  }
  const standingIndex = room.roomAgents
    .filter(({ placement }) => placement === "standing")
    .findIndex(({ key: agentKey }) => agentKey === key);
  if (standingIndex >= 0) {
    const anchor = standingAnchor(rect, standingIndex);
    return { x: anchor.x, y: anchor.characterFeetY - 42 };
  }
  return null;
}

function drawBackground(stage: Container, layout: OfficeLayout) {
  const background = new Graphics();
  background.roundRect(0, 0, layout.officeWidth, layout.totalHeight, 6).fill(0x0e0e1c);
  for (let band = 0; band < 14; band += 1) {
    background
      .rect(
        2,
        2 + (layout.totalHeight - 4) * (band / 14),
        layout.officeWidth - 4,
        layout.totalHeight / 14 + 1,
      )
      .fill({ color: blendColor(0x15152a, 0x090914, band / 13), alpha: 0.9 });
  }
  background
    .roundRect(2, 2, layout.officeWidth - 4, layout.totalHeight - 4, 5)
    .stroke({ width: 2, color: 0x2a2a48, alpha: 0.8 });
  stage.addChild(background);
}

function drawCeoReception(
  stage: Container,
  layout: OfficeLayout,
  projection: HerdrOfficeProjection,
  observability: OfficeObservability,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const band = new Container();
  if (layout.fallbackMessage) {
    if (layout.ceoOverflowMarkerRect) {
      drawRoomOverflowMarker(band, layout.ceoOverflowMarkerRect, 0xf0c878);
    }
    stage.addChild(band);
    return;
  }
  const ceoBlocks = layout.ceoBlocks;
  const ceoRoomRight = layout.ceoRect.x + layout.ceoRect.width;
  const floor = new Graphics();
  drawTiledFloor(
    floor,
    4,
    4,
    ceoRoomRight - 4,
    layout.ceoRect.height,
    0x131328,
    0x0e0e1d,
  );
  floor
    .roundRect(4, 4, ceoRoomRight - 4, layout.ceoRect.height, 4)
    .stroke({ width: 2, color: 0x8d7135, alpha: 0.8 });
  band.addChild(floor);
  drawVerticalRoad(
    band,
    ceoRoomRight,
    4,
    Math.max(0, layout.agentBarRect.x - ceoRoomRight),
    layout.ceoRect.height,
  );
  const ceoContent = new Container();
  ceoContent.position.x = ceoBlocks.ceoOriginX;
  ceoContent.scale.x = ceoBlocks.ceoScale;
  addSign(
    ceoContent,
    ceoBlocks.ceoContentWidth / 2 - 88,
    8,
    "CEO OFFICE",
    0x76571c,
    176,
    undefined,
    undefined,
    undefined,
    13,
  );
  drawCeo(ceoContent, textures, ceoBlocks.localCeoX);
  drawOtelCostBoard(ceoContent, observability, ceoBlocks.localOtelBoardX);
  drawLiveStateBlackboard(ceoContent, projection, ceoBlocks.localBoardX);
  const receptionRects = ceoBlocks.localReceptions;
  projection.receptions.forEach((reception, index) => {
    const rect = receptionRects[index];
    if (!rect) {
      return;
    }
    drawReceptionDesk(
      ceoContent,
      reception,
      projection,
      rect,
      selectedKey,
      textures,
      animated,
      onSelect,
      onActivateAgent,
    );
  });
  if (projection.coverage.omittedReceptionDesks > 0) {
    const overflow = label(`+${projection.coverage.omittedReceptionDesks} host desks in roster`, {
      size: 10,
      color: 0xd7c394,
      anchor: { x: 1, y: 0 },
    });
    overflow.position.set(ceoBlocks.ceoContentWidth - 18, 13);
    ceoContent.addChild(overflow);
  }
  band.addChild(ceoContent);
  if (layout.ceoOverflowMarkerRect) {
    drawRoomOverflowMarker(band, layout.ceoOverflowMarkerRect, 0xf0c878);
  }
  drawAgentBar(
    band,
    ceoBlocks,
    projection,
    selectedKey,
    textures,
    animated,
    onSelect,
    onActivateAgent,
  );
  stage.addChild(band);
}

function drawVerticalRoad(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const road = new Graphics();
  road.rect(x, y, width, height).fill(0x252537);
  road.rect(x, y, 1, height).fill({ color: 0x6c6990, alpha: 0.35 });
  road.rect(x + width - 1, y, 1, height).fill({ color: 0x6c6990, alpha: 0.35 });
  for (let markerY = y + 14; markerY < y + height - 8; markerY += 18) {
    road.rect(x + width / 2, markerY, 1, 6).fill({ color: 0x77749a, alpha: 0.38 });
  }
  parent.addChild(road);
}

function drawCeo(parent: Container, textures: readonly Texture[], deskX: number) {
  const deskWidth = OFFICE_GEOMETRY.ceoDeskWidth;
  const deskCenterX = deskX + deskWidth / 2;
  const title = label("YOU · CEO", { size: 11, color: 0xf6e3b2, anchor: 0.5 });
  title.position.set(deskCenterX, 48);
  parent.addChild(title);
  drawChair(parent, deskCenterX, 136, 0x8c6e35);
  const viewer = new Container();
  viewer.position.set(deskCenterX, 148);
  addCharacterSprite(viewer, textures[0] ?? Texture.EMPTY);
  parent.addChild(viewer);
  drawChairArms(parent, deskCenterX, 136, 0x8c6e35);
  const desk = new Graphics();
  desk.roundRect(deskX, 130, deskWidth, 44, 5).fill(0x493728);
  desk.roundRect(deskX + 4, 134, deskWidth - 8, 36, 4).fill(0x705234);
  desk.roundRect(deskX + 50, 138, 60, 25, 3).fill(0x182031);
  desk.roundRect(deskX + 57, 144, 46, 13, 2).fill(0x356c9e);
  desk.rect(deskX + 4, 168, deskWidth - 8, 2).fill({ color: 0xc39a55, alpha: 0.72 });
  parent.addChild(desk);
}

function drawLiveStateBlackboard(
  parent: Container,
  projection: HerdrOfficeProjection,
  x: number,
) {
  const {
    ceoBoardY: y,
    ceoBoardWidth: width,
    ceoBoardHeight: height,
  } = OFFICE_GEOMETRY;
  const board = new Graphics();
  board.roundRect(x + 4, y + 5, width, height, 5).fill({ color: 0x000000, alpha: 0.34 });
  board.roundRect(x, y, width, height, 5).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3).fill(0x17251f);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.78 });
  board.rect(x + 10, y + 18, width - 20, 1).fill({ color: 0xd8e8c8, alpha: 0.2 });
  board.rect(x + 8, y + height - 10, width - 16, 2).fill({ color: 0x8f6e3c, alpha: 0.58 });
  parent.addChild(board);

  const heading = label("WORKFORCE", {
    size: 12,
    color: 0xe2f1d1,
    anchor: 0.5,
  });
  heading.position.set(x + width / 2, y + 12);
  parent.addChild(heading);

  const metrics: Array<[string, number | string]> = [
    ["HOSTS", projection.coverage.observedHosts],
    ["SPACES", projection.coverage.observedWorkspaces],
    ["AGENTS", projection.coverage.observedAgents],
    ["WORKING", projection.coverage.status.working],
    ["INPUT", projection.coverage.status.blocked],
    ["STALE", projection.coverage.staleHosts],
  ];
  const columnWidth = (width - 20) / 3;
  metrics.forEach(([metric, value], index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const centerX = x + 10 + columnWidth * (column + 0.5);
    const centerY = y + 52 + row * 44;
    const valueLabel = label(String(value), {
      size: 20,
      color: metric === "STALE" && typeof value === "number" && value > 0
        ? 0xffb0ba
        : 0xf1e9bd,
      anchor: 0.5,
    });
    valueLabel.position.set(centerX, centerY);
    parent.addChild(valueLabel);
    const metricLabel = label(metric, {
      size: 11,
      color: 0xa9c8a4,
      anchor: 0.5,
    });
    metricLabel.position.set(centerX, centerY + 13);
    parent.addChild(metricLabel);
  });

}

function drawOtelCostBoard(
  parent: Container,
  observability: OfficeObservability,
  x: number,
) {
  const {
    ceoBoardY: y,
    ceoOtelBoardWidth: width,
    ceoBoardHeight: height,
  } = OFFICE_GEOMETRY;
  const board = new Graphics();
  board.roundRect(x + 4, y + 5, width, height, 5).fill({ color: 0x000000, alpha: 0.34 });
  board.roundRect(x, y, width, height, 5).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3).fill(0x17251f);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 3)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.78 });
  board.rect(x + 10, y + 34, width - 20, 1).fill({ color: 0xd8e8c8, alpha: 0.2 });
  board.rect(x + 8, y + height - 10, width - 16, 2).fill({ color: 0x8f6e3c, alpha: 0.58 });
  parent.addChild(board);

  const heading = label("ECONOMY", {
    size: 12,
    color: 0xe2f1d1,
    anchor: 0.5,
  });
  heading.position.set(x + width / 2, y + 12);
  parent.addChild(heading);

  const modelHeader = label("MODEL", {
    size: 11,
    color: 0xa9c8a4,
    anchor: { x: 0, y: 0.5 },
    weight: "700",
  });
  modelHeader.position.set(x + 12, y + 26);
  parent.addChild(modelHeader);
  const tokenColumnX = x + 100;
  const coinIcon = new Graphics();
  coinIcon.circle(tokenColumnX - 4, y + 25, 5).fill({ color: 0xd4b66c, alpha: 0.62 });
  coinIcon.circle(tokenColumnX + 3, y + 24, 5).fill({ color: 0xd4b66c, alpha: 0.82 });
  coinIcon.circle(tokenColumnX, y + 28, 5).fill(0xf1e9bd);
  coinIcon.circle(tokenColumnX, y + 28, 2).fill({ color: 0x8a6b3d, alpha: 0.8 });
  parent.addChild(coinIcon);
  const costHeader = label("$$$", {
    size: 12,
    color: 0xa9c8a4,
    anchor: { x: 1, y: 0.5 },
    weight: "700",
  });
  costHeader.position.set(x + width - 12, y + 26);
  parent.addChild(costHeader);

  if (observability.health !== "available" || observability.models.length === 0) {
    const status = label(
      observability.health === "degraded" ? "DEGRADED" : "NO DATA",
      { size: 14, color: observability.health === "degraded" ? 0xffb0ba : 0xd7c394, anchor: 0.5 },
    );
    status.position.set(x + width / 2, y + 78);
    parent.addChild(status);
    return;
  }

  observability.models.slice(0, 4).forEach((model, index) => {
    const rowY = y + 48 + index * 22;
    const modelLabel = label(formatOfficeModelName(model.model), {
      size: 11,
      color: 0xf0ece5,
      anchor: { x: 0, y: 0.5 },
    });
    modelLabel.position.set(x + 12, rowY);
    parent.addChild(modelLabel);
    const tokenLabel = label(formatOfficeUsage(officeModelUsageTotal(model.usage)), {
      size: 12,
      color: 0xf1e9bd,
      anchor: 0.5,
    });
    tokenLabel.position.set(tokenColumnX, rowY);
    parent.addChild(tokenLabel);
    const costLabel = label(formatOfficeCost(model.costUsd, model.costKind), {
      size: 12,
      color: 0xf1e9bd,
      anchor: { x: 1, y: 0.5 },
    });
    costLabel.position.set(x + width - 12, rowY);
    parent.addChild(costLabel);
  });

  board.rect(x + 10, y + height - 31, width - 20, 1).fill({ color: 0xd8e8c8, alpha: 0.2 });
  const totalLabel = label("TOTAL", {
    size: 11,
    color: 0xa9c8a4,
    anchor: { x: 0, y: 0.5 },
    weight: "700",
  });
  totalLabel.position.set(x + 12, y + height - 20);
  parent.addChild(totalLabel);
  const totalTokens = label(formatOfficeUsage(observability.totalUsage), {
    size: 12,
    color: 0xf1e9bd,
    anchor: 0.5,
    weight: "700",
  });
  totalTokens.position.set(tokenColumnX, y + height - 20);
  parent.addChild(totalTokens);
  const totalCostKind = observability.models.some(({ costKind }) =>
    costKind !== null && costKind !== "reported"
  ) ? "estimated" as const : null;
  const totalCost = label(formatOfficeCost(observability.totalCostUsd, totalCostKind), {
    size: 12,
    color: 0xf1e9bd,
    anchor: { x: 1, y: 0.5 },
    weight: "700",
  });
  totalCost.position.set(x + width - 12, y + height - 20);
  parent.addChild(totalCost);
}

function drawReceptionDesk(
  parent: Container,
  reception: OfficeReception,
  projection: HerdrOfficeProjection,
  rect: OfficeReceptionRect,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const host = projection.hosts.find(({ key }) => key === reception.hostKey);
  if (!host) {
    return;
  }
  const accent = hostColor(host);
  const centerX = rect.x + rect.width / 2;
  const zone = new Graphics();
  zone.rect(rect.x, rect.y, rect.width, rect.height).fill({
    color: selectedKey === host.key ? accent : 0x000000,
    alpha: selectedKey === host.key ? 0.08 : 0.001,
  });
  makeInteractive(zone, host.key, onSelect);
  parent.addChild(zone);
  if (rect.index > 0) {
    const separator = new Graphics();
    separator.rect(
      rect.x - rect.gapBefore / 2,
      rect.y + 8,
      1,
      rect.height - 20,
    ).fill({ color: 0x77749a, alpha: 0.22 });
    parent.addChild(separator);
  }
  const agents = reception.waitingAgents;
  const table = receptionTableRect(rect);
  const receptionChairs = Array.from({ length: 4 }, (_, index) => {
    const anchor = receptionAgentAnchor(rect, index);
    const chairY = anchor.characterFeetY - OFFICE_GEOMETRY.characterHeight * 0.18;
    drawChair(parent, anchor.x, chairY, accent);
    return { anchor, chairY };
  });
  Array.from({ length: 4 }, (_, index) =>
    table.x + table.width * ((index + 0.5) / 4)).forEach((x) => {
    const chairY = table.y + table.height + 10;
    drawChair(parent, x, chairY, accent);
    drawChairArms(parent, x, chairY, accent);
  });
  agents.forEach((agent, index) => {
    const { anchor, chairY } = receptionChairs[index];
    const name = label(shortLabel(agent.displayLabel, 12), {
      size: 8,
      color: 0xf2edf1,
      anchor: 0.5,
    });
    name.position.set(anchor.x, anchor.nameY);
    makeInteractive(name, agent.key, onSelect, onActivateAgent);
    parent.addChild(name);
    const character = drawCharacter(
      parent,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      false,
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.alpha = agent.stale ? 0.56 : 1;
    drawChairArms(parent, anchor.x, chairY, accent);
  });
  receptionChairs.slice(agents.length).forEach(({ anchor, chairY }) => {
    drawChairArms(parent, anchor.x, chairY, accent);
  });

  const desk = new Graphics();
  desk.ellipse(
    table.x + table.width / 2,
    table.y + table.height + 3,
    Math.max(1, table.width * 0.38),
    5,
  )
    .fill({ color: 0x000000, alpha: 0.24 });
  desk.roundRect(table.x, table.y, table.width, table.height, 16).fill(0x4a3526);
  desk.roundRect(table.x + 4, table.y + 4, table.width - 8, table.height - 8, 13)
    .fill(0x765437);
  desk.roundRect(table.x + table.width * 0.32, table.y + 8, table.width * 0.36, 7, 3)
    .fill(0x2d2b32);
  desk.roundRect(table.x + 6, table.y + 6, table.width - 12, table.height - 12, 11)
    .stroke({ width: 1, color: accent, alpha: 0.68 });
  makeInteractive(desk, host.key, onSelect);
  parent.addChild(desk);
  const deskLabel = label(shortLabel(host.displayLabel, 20), {
    size: 10,
    color: 0xf4e6c0,
    anchor: 0.5,
  });
  deskLabel.position.set(centerX, table.y + table.height / 2);
  parent.addChild(deskLabel);
  if (reception.overflowCount > 0) {
    const overflow = label(`+${reception.overflowCount} waiting in roster`, {
      size: 8,
      color: 0xf0c878,
      anchor: 0.5,
    });
    overflow.position.set(centerX, table.y + table.height - 7);
    parent.addChild(overflow);
  }
}

function drawHallways(stage: Container, layout: OfficeLayout) {
  const hall = new Graphics();
  const y = layout.ceoBandHeight;
  hall.rect(4, y, layout.officeWidth - 8, OFFICE_GEOMETRY.hallwayHeight).fill(0x252537);
  hall.rect(4, y, layout.officeWidth - 8, 1).fill({ color: 0x6c6990, alpha: 0.35 });
  for (let x = 20; x < layout.officeWidth - 20; x += 18) {
    hall.rect(x, y + 16, 7, 1).fill({ color: 0x77749a, alpha: 0.38 });
  }
  stage.addChild(hall);
}

function drawRoomRoads(stage: Container, layout: OfficeLayout) {
  const road = new Graphics();
  const rows = new Map<number, OfficeRoomRect[]>();
  layout.rooms.forEach((room) => {
    const row = rows.get(room.row) ?? [];
    row.push(room);
    rows.set(room.row, row);
  });
  const sortedRows = [...rows.values()]
    .map((row) => row.sort((left, right) => left.x - right.x))
    .sort((left, right) => left[0].y - right[0].y);

  sortedRows.forEach((row) => {
    row.slice(0, -1).forEach((room, index) => {
      const next = row[index + 1];
      const gap = next.x - (room.x + room.width);
      if (gap > 0) {
        drawVerticalRoad(road, room.x + room.width, room.y, gap, Math.min(room.height, next.height));
      }
    });
  });
  sortedRows.slice(0, -1).forEach((row, index) => {
    const nextRow = sortedRows[index + 1];
    const rowBottom = Math.max(...row.map(({ y, height }) => y + height));
    const nextRowTop = Math.min(...nextRow.map(({ y }) => y));
    if (nextRowTop > rowBottom) {
      drawHorizontalRoad(road, 4, rowBottom, layout.officeWidth - 8, nextRowTop - rowBottom);
    }
  });
  stage.addChild(road);
}

function drawHorizontalRoad(
  parent: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  if (width <= 0 || height <= 0) {
    return;
  }
  parent.rect(x, y, width, height).fill(0x252537);
  parent.rect(x, y, width, 1).fill({ color: 0x6c6990, alpha: 0.35 });
  parent.rect(x, y + height - 1, width, 1).fill({ color: 0x6c6990, alpha: 0.35 });
  for (let markerX = x + 14; markerX < x + width - 8; markerX += 18) {
    parent.rect(markerX, y + height / 2, 7, 1).fill({ color: 0x77749a, alpha: 0.38 });
  }
}

function roomHasActivity(room: OfficeRoom) {
  const activeAgentKeys = new Set(
    room.roomAgents
      .filter(({ semanticStatus }) => semanticStatus !== "idle")
      .map(({ key }) => key),
  );
  return room.roomAgents.some(({ semanticStatus }) => semanticStatus !== "idle")
    || room.desks.some(({ occupantAgentKey }) => Boolean(occupantAgentKey && activeAgentKeys.has(occupantAgentKey)));
}

function drawRoomHeading(
  parent: Container,
  room: OfficeRoom,
  host: OfficeHost,
  rect: OfficeRoomRect,
  accent: number,
  selectedKey: string | null,
  onSelect: (key: string) => void,
  onActivateRoom: (key: string) => void,
) {
  const fallbackActionWidth = OFFICE_GEOMETRY.roomHeaderActionWidth;
  const fallbackTitleBoxWidth = Math.max(
    0,
    rect.headerRect.width - 2 * (
      fallbackActionWidth +
      OFFICE_GEOMETRY.roomHeaderActionGap +
      fallbackActionWidth +
      OFFICE_GEOMETRY.roomHeaderCloseGap
    ),
  );
  const fallbackTitleBoxX = Math.max(0, (rect.headerRect.width - fallbackTitleBoxWidth) / 2);
  const header = rect.header ?? {
    workspace: shortLabel(room.displayLabel, 18),
    host: shortLabel(host.displayLabel, 16),
    width: rect.headerRect.width,
    titleBoxX: fallbackTitleBoxX,
    titleBoxWidth: fallbackTitleBoxWidth,
    renameX: fallbackTitleBoxX + fallbackTitleBoxWidth + OFFICE_GEOMETRY.roomHeaderActionGap,
    closeX: Math.max(0, rect.headerRect.width - fallbackActionWidth),
    renameWidth: fallbackActionWidth,
    closeWidth: fallbackActionWidth,
    actionWidth: fallbackActionWidth,
    actionGap: OFFICE_GEOMETRY.roomHeaderActionGap,
    closeGap: OFFICE_GEOMETRY.roomHeaderCloseGap,
    height: rect.headerRect.height,
    emergencyEllipsis: false,
  };
  const x = rect.headerRect.x + header.titleBoxX;
  const y = rect.headerRect.y;
  const workspace = label(header.workspace.toUpperCase(), {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xffffff,
    anchor: { x: 0, y: 0.5 },
  });
  const hostName = label(header.host.toUpperCase(), {
    size: OFFICE_HEADING_TEXT_SIZE,
    color: 0xf5d892,
    anchor: { x: 0, y: 0.5 },
  });
  const hyphenOne = label("-", { size: OFFICE_HEADING_TEXT_SIZE, color: 0xf0e6c6, anchor: 0.5 });
  const hyphenTwo = label("-", { size: OFFICE_HEADING_TEXT_SIZE, color: 0xf0e6c6, anchor: 0.5 });
  const titleBoxWidth = Math.min(
    Math.max(0, rect.headerRect.width - header.titleBoxX),
    Math.max(0, header.titleBoxWidth),
  );
  const background = new Graphics();
  background.roundRect(x, y, titleBoxWidth, Math.min(22, rect.headerRect.height), 4)
    .fill(selectedKey === room.key ? accent : blendColor(accent, 0x121522, 0.5));
  background.roundRect(x, y, titleBoxWidth, Math.min(22, rect.headerRect.height), 4)
    .stroke({ width: selectedKey === room.key ? 2 : 1, color: blendColor(accent, 0xffffff, 0.35), alpha: 0.84 });
  makeInteractive(background, room.key, onSelect, onActivateRoom);
  parent.addChild(background);

  let cursor = x + 10;
  drawNotebookIcon(parent, cursor, y + 3, 0xf6e3b2, room.key, onSelect, onActivateRoom);
  cursor += 16;
  hyphenOne.position.set(cursor + hyphenOne.width / 2, y + 11);
  makeInteractive(hyphenOne, room.key, onSelect, onActivateRoom);
  parent.addChild(hyphenOne);
  cursor += hyphenOne.width;
  workspace.position.set(cursor, y + 11);
  makeInteractive(workspace, room.key, onSelect, onActivateRoom);
  parent.addChild(workspace);
  cursor += workspace.width + 12;
  drawComputerIcon(parent, cursor, y + 4, 0xe4f0ff, room.key, onSelect, onActivateRoom);
  cursor += 20;
  hyphenTwo.position.set(cursor + hyphenTwo.width / 2, y + 11);
  makeInteractive(hyphenTwo, room.key, onSelect, onActivateRoom);
  parent.addChild(hyphenTwo);
  cursor += hyphenTwo.width;
  hostName.position.set(cursor, y + 11);
  makeInteractive(hostName, room.key, onSelect, onActivateRoom);
  parent.addChild(hostName);
}

function drawNotebookIcon(
  parent: Container,
  x: number,
  y: number,
  color: number,
  key: string,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const icon = new Graphics();
  icon.roundRect(x + 2, y, 12, 16, 2).fill({ color, alpha: 0.94 });
  icon.rect(x + 4, y + 4, 7, 1).fill(0x604e35);
  icon.rect(x + 4, y + 7, 7, 1).fill(0x604e35);
  icon.rect(x + 4, y + 10, 5, 1).fill(0x604e35);
  icon.rect(x, y + 3, 2, 10).fill(blendColor(color, 0x0c101a, 0.35));
  makeInteractive(icon, key, onSelect, onActivate);
  parent.addChild(icon);
}

function drawComputerIcon(
  parent: Container,
  x: number,
  y: number,
  color: number,
  key: string,
  onSelect: (key: string) => void,
  onActivate: (key: string) => void,
) {
  const icon = new Graphics();
  icon.roundRect(x, y, 17, 11, 2).fill({ color, alpha: 0.94 });
  icon.roundRect(x + 3, y + 3, 11, 5, 1).fill(0x344a5e);
  icon.rect(x + 7, y + 11, 3, 3).fill(color);
  icon.rect(x + 4, y + 14, 9, 1).fill(color);
  makeInteractive(icon, key, onSelect, onActivate);
  parent.addChild(icon);
}


function drawRoom(
  stage: Container,
  room: OfficeRoom,
  rect: OfficeRoomRect,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  onActivateRoom: (key: string) => void,
  canCreateSeat: (roomKey: string) => boolean,
  onNewSeat: (roomKey: string) => void,
) {
  const host = projection.hosts.find(({ key }) => key === room.hostKey);
  if (!host) {
    return;
  }
  const theme = THEMES[host.deterministicSkin.themeIndex % THEMES.length];
  const active = roomHasActivity(room);
  const hasUnseenCompletion = room.desks.some((desk) =>
    desk.completionAgentKeys.some((key) => !completionSeenKeys.has(key)),
  );
  const hasSelectedCompletion = room.desks.some((desk) =>
    desk.completionAgentKeys.includes(selectedKey ?? ""),
  );
  const roomSelected = selectedKey === room.key || hasSelectedCompletion;
  const parent = new Container();
  const floor = new Graphics();
  const floorA = active ? blendColor(theme.floorA, 0x5d5138, 0.34) : theme.floorA;
  const floorB = active ? blendColor(theme.floorB, 0x443a2a, 0.32) : theme.floorB;
  drawTiledFloor(floor, rect.wallRect.x, rect.wallRect.y, rect.wallRect.width, rect.wallRect.height, floorA, floorB);
  floor.rect(rect.wallRect.x, rect.wallRect.y, rect.wallRect.width, Math.min(34, rect.wallRect.height))
    .fill({ color: theme.wall, alpha: 0.76 });
  const borderInset = 3;
  floor.roundRect(
    rect.x + borderInset,
    rect.y + borderInset,
    Math.max(0, rect.width - borderInset * 2),
    Math.max(0, rect.height - borderInset * 2),
    4,
  ).stroke({
    width: roomSelected ? 2 : hasUnseenCompletion ? 2 : 1,
    color: roomSelected
      ? 0xffffff
      : hasUnseenCompletion
        ? 0xf0c878
        : theme.accent,
    alpha: roomSelected ? 0.92 : hasUnseenCompletion ? 0.92 : 0.78,
  });
  makeInteractive(floor, room.key, onSelect, onActivateRoom);
  parent.addChild(floor);
  drawRoomHeading(parent, room, host, rect, theme.accent, selectedKey, onSelect, onActivateRoom);
  if (rect.overflowMarkerRect) {
    drawRoomOverflowMarker(parent, rect.overflowMarkerRect, theme.accent);
  }
  drawPlant(parent, rect.x + 14, rect.y + rect.height - 18, theme.accent);
  drawPlant(parent, rect.x + rect.width - 16, rect.y + rect.height - 18, theme.accent);

  const agentByKey = new Map(room.roomAgents.map((agent) => [agent.key, agent]));
  room.desks.forEach((desk, index) => {
    const occupant = desk.occupantAgentKey ? agentByKey.get(desk.occupantAgentKey) : undefined;
    drawTabDesk(
      parent,
      desk,
      occupant,
      rect,
      index,
      theme.accent,
      selectedKey,
      completionSeenKeys,
      textures,
      animated,
      onSelect,
      onActivateAgent,
    );
  });
  room.roomAgents
    .filter(({ placement }) => placement === "standing")
    .forEach((agent, index) => {
      drawStandingAgent(
        parent,
        agent,
        rect,
        index,
        selectedKey,
        textures,
        animated,
        onSelect,
        onActivateAgent,
      );
    });
  if (canCreateSeat(room.key)) {
    if (room.desks.length < OFFICE_GEOMETRY.desksPerRoom) {
      drawNewSeatAction(parent, room, rect, room.desks.length, theme.accent, onNewSeat);
    } else {
      drawFullRoomAction(parent, rect, theme.accent);
    }
  }

  const overflow: string[] = [];
  if (room.omittedDeskCount > 0) {
    overflow.push(`+${room.omittedDeskCount} desks`);
  }
  if (room.omittedAgentCount > 0) {
    overflow.push(`+${room.omittedAgentCount} agents`);
  }
  if (overflow.length > 0) {
    const copy = label(`${overflow.join(" · ")} in roster`, {
      size: 9,
      color: 0xd7deea,
      anchor: { x: 1, y: 0 },
    });
    copy.position.set(rect.x + rect.width - 18, rect.y + rect.height - 18);
    parent.addChild(copy);
  }
  if (room.stale) {
    parent.alpha = 0.68;
    const stale = new Graphics();
    stale.rect(rect.x, rect.y, rect.width, rect.height).fill({ color: 0x7b2735, alpha: 0.08 });
    parent.addChild(stale);
  }
  stage.addChild(parent);
}

function drawRoomOverflowMarker(parent: Container, rect: { x: number; y: number; width: number; height: number }, accent: number) {
  if (rect.width <= 0 || rect.height <= 0) {
    return;
  }
  const marker = new Graphics();
  marker.roundRect(rect.x, rect.y, rect.width, rect.height, 3)
    .fill({ color: 0x1b202b, alpha: 0.96 })
    .stroke({ width: 1, color: accent, alpha: 0.86 });
  parent.addChild(marker);
  const text = label("MORE", { size: 7, color: 0xf0c878, anchor: 0.5 });
  text.position.set(rect.x + rect.width / 2, rect.y + rect.height / 2);
  parent.addChild(text);
}

function drawNewSeatAction(
  parent: Container,
  room: OfficeRoom,
  rect: OfficeRoomRect,
  index: number,
  accent: number,
  onNewSeat: (roomKey: string) => void,
) {
  const anchor = deskAnchor(rect, index);
  const action = new Container();
  action.label = room.key;
  action.eventMode = "static";
  action.cursor = "pointer";
  action.on("pointertap", (event) => {
    event.stopPropagation();
    onNewSeat(room.key);
  });
  const plate = new Graphics();
  // Keep the visible + target self-describing for Pixi's hit-test walk so
  // hover callouts work on the empty-seat action as well as on desks.
  plate.label = room.key;
  plate.eventMode = "static";
  plate.roundRect(anchor.x - 25, anchor.deskY, 50, 27, 5)
    .fill({ color: accent, alpha: 0.1 })
    .stroke({ width: 1, color: accent, alpha: 0.8 });
  action.addChild(plate);
  const plus = label("+", { size: 19, color: 0xf4e6c0, anchor: 0.5, weight: "700" });
  plus.eventMode = "none";
  plus.position.set(anchor.x, anchor.deskY + 13);
  action.addChild(plus);
  const hint = label("NEW SEAT", { size: 7, color: 0xa9c8a4, anchor: 0.5 });
  hint.eventMode = "none";
  hint.position.set(anchor.x, anchor.nameY + 7);
  action.addChild(hint);
  parent.addChild(action);
}

function drawFullRoomAction(
  parent: Container,
  rect: OfficeRoomRect,
  accent: number,
) {
  const x = rect.x + rect.width / 2;
  const y = rect.y + rect.height - 40;
  const plate = new Graphics();
  plate.roundRect(x - 25, y, 50, 27, 5)
    .fill({ color: accent, alpha: 0.04 })
    .stroke({ width: 1, color: accent, alpha: 0.38 });
  parent.addChild(plate);
  const plus = label("+", { size: 19, color: 0x9c947f, anchor: 0.5 });
  plus.alpha = 0.62;
  plus.position.set(x, y + 13);
  parent.addChild(plus);
  const hint = label("ROOM FULL", { size: 7, color: 0x8e958a, anchor: 0.5 });
  hint.position.set(x, y + 35);
  parent.addChild(hint);
}

function drawTabDesk(
  parent: Container,
  desk: OfficeDesk,
  occupant: OfficeAgent | undefined,
  rect: OfficeRoomRect,
  index: number,
  accent: number,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const anchor = deskAnchor(rect, index);
  const deskSelected = selectedKey === desk.key ||
    selectedKey === occupant?.key ||
    desk.completionAgentKeys.includes(selectedKey ?? "");
  const tabName = label(shortLabel(desk.displayLabel, 18), {
    size: 9,
    color: deskSelected ? 0xffffff : 0xdce6f3,
    anchor: 0.5,
  });
  const plateWidth = Math.max(58, Math.min(anchor.stationSpan - 6, tabName.width + 14));
  const tabPlate = new Graphics();
  tabPlate.roundRect(anchor.x - plateWidth / 2, anchor.nameY, plateWidth, 16, 4)
    .fill({ color: deskSelected ? accent : 0x1c2736, alpha: 0.96 });
  tabPlate.roundRect(anchor.x - plateWidth / 2, anchor.nameY, plateWidth, 16, 4)
    .stroke({ width: deskSelected ? 2 : 1, color: accent, alpha: 0.82 });
  makeInteractive(tabPlate, desk.key, onSelect);
  parent.addChild(tabPlate);
  tabName.position.set(anchor.x, anchor.nameY + 8);
  makeInteractive(tabName, desk.key, onSelect);
  parent.addChild(tabName);

  const chairY = anchor.characterFeetY - OFFICE_GEOMETRY.characterHeight * 0.18;
  drawChair(parent, anchor.x, chairY, accent);
  if (occupant) {
    const cue = occupant.stale ? { label: "STALE", color: 0x79869a } : STATUS_CUES[occupant.semanticStatus];
    const status = label(`${shortLabel(occupant.displayLabel, 14)} · ${cue.label}`, {
      size: 9,
      color: 0x111722,
      anchor: 0.5,
    });
    const statusWidth = Math.max(54, Math.min(anchor.stationSpan - 4, status.width + 10));
    const statusPlate = new Graphics();
    statusPlate.roundRect(anchor.x - statusWidth / 2, anchor.nameY + 18, statusWidth, 15, 3)
      .fill({ color: cue.color, alpha: 0.96 });
    makeInteractive(statusPlate, occupant.key, onSelect, onActivateAgent);
    parent.addChild(statusPlate);
    status.position.set(anchor.x, anchor.nameY + 25.5);
    makeInteractive(status, occupant.key, onSelect, onActivateAgent);
    parent.addChild(status);
    if (occupant.semanticStatus === "working" && !occupant.stale) {
      animated.push({ kind: "status", node: statusPlate, baseAlpha: 1, phase: animated.length * 7 });
    }
    const character = drawCharacter(
      parent,
      textures[occupant.characterIndex] ?? Texture.EMPTY,
      anchor.x,
      anchor.characterFeetY,
      occupant.semanticStatus === "working",
      occupant.stale,
      animated,
      occupant.key,
      onSelect,
      deskSelected ? occupant.key : selectedKey,
      onActivateAgent,
    );
    character.alpha = occupant.stale ? 0.56 : 1;
    drawChairArms(parent, anchor.x, chairY, accent);
  } else {
    drawChairArms(parent, anchor.x, chairY, accent);
    const empty = label("EMPTY", { size: 8, color: 0x7f8da1, anchor: 0.5 });
    empty.position.set(anchor.x, anchor.nameY + 25);
    parent.addChild(empty);
  }
  const deskNode = drawDesk(
    parent,
    anchor.x - OFFICE_GEOMETRY.deskWidth / 2,
    anchor.deskY,
    accent,
    occupant?.semanticStatus === "working" && !occupant.stale,
    animated,
    deskSelected,
  );
  makeInteractive(deskNode, desk.key, onSelect);
  if (desk.completionAgentKeys.some((key) => !completionSeenKeys.has(key))) {
    drawCompletionMarker(
      parent,
      desk,
      anchor,
      completionSeenKeys,
      onSelect,
      onActivateAgent,
    );
  }
}

function drawCompletionMarker(
  parent: Container,
  desk: OfficeDesk,
  anchor: ReturnType<typeof deskAnchor>,
  completionSeenKeys: ReadonlySet<string>,
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const unseenKeys = desk.completionAgentKeys.filter((key) => !completionSeenKeys.has(key));
  const primaryKey = unseenKeys[0];
  if (!primaryKey) {
    return;
  }
  const unseenCount = unseenKeys.length;
  const marker = new Container();
  marker.position.set(anchor.x + 17, anchor.deskY - 16);
  marker.alpha = unseenCount > 0 ? 1 : 0.48;
  const sheets = new Graphics();
  sheets.roundRect(-10, -7, 18, 13, 2).fill(0xf2e3bd);
  sheets.roundRect(-7, -10, 18, 13, 2).fill(0xfff4d0);
  sheets.rect(-3, -6, 9, 1).fill(0xb28d58);
  sheets.rect(-3, -3, 7, 1).fill(0xb28d58);
  sheets.rect(-3, 0, 9, 1).fill(0xb28d58);
  sheets.poly([4, 3, 8, 0, 8, 4]).fill(0x77b889);
  sheets.moveTo(4, 2).lineTo(5.5, 3.5).lineTo(8, 0.5)
    .stroke({ width: 1.6, color: 0x2f704b, alpha: 1 });
  marker.addChild(sheets);
  if (unseenCount > 1) {
    const count = label(`+${unseenCount - 1}`, { size: 7, color: 0x251c12, anchor: 0.5 });
    const countPlate = new Graphics();
    countPlate.circle(11, -9, 7).fill(0xf0c878);
    marker.addChild(countPlate);
    count.position.set(11, -9);
    marker.addChild(count);
  }
  makeInteractive(marker, primaryKey, onSelect, onActivateAgent);
  parent.addChild(marker);
}

function drawStandingAgent(
  parent: Container,
  agent: OfficeAgent,
  rect: OfficeRoomRect,
  index: number,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const anchor = standingAnchor(rect, index);
  const cue = agent.stale ? { label: "STALE", color: 0x79869a } : STATUS_CUES[agent.semanticStatus];
  const name = label(shortLabel(agent.displayLabel, 13), {
    size: 9,
    color: 0xf2f4f8,
    anchor: 0.5,
  });
  name.position.set(anchor.x, anchor.nameY + 6);
  makeInteractive(name, agent.key, onSelect, onActivateAgent);
  parent.addChild(name);
  const state = label(cue.label, { size: 7, color: cue.color, anchor: 0.5 });
  state.position.set(anchor.x, anchor.nameY + 18);
  makeInteractive(state, agent.key, onSelect, onActivateAgent);
  parent.addChild(state);
  const character = drawCharacter(
    parent,
    textures[agent.characterIndex] ?? Texture.EMPTY,
    anchor.x,
    anchor.characterFeetY,
    agent.semanticStatus === "working",
    agent.stale,
    animated,
    agent.key,
    onSelect,
    selectedKey,
    onActivateAgent,
  );
  character.alpha = agent.stale ? 0.56 : 1;
}

function drawAgentBar(
  parent: Container,
  blocks: OfficeCeoBlockLayout,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  textures: readonly Texture[],
  animated: AnimatedItem[],
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
) {
  const x = blocks.agentBarX;
  const y = 4;
  const width = blocks.agentBarWidth;
  const height = blocks.agentBarHeight;
  const room = new Container();
  const floor = new Graphics();
  drawTiledFloor(floor, x, y, width, height, 0x17140f, 0x11100d);
  floor.roundRect(x, y, width, height, 4)
    .stroke({ width: 2, color: 0xb59048, alpha: 0.72 });
  room.addChild(floor);
  addSign(
    room,
    x + width / 2 - 58,
    y + 8,
    "AGENT BAR",
    0xa17d37,
    116,
    undefined,
    undefined,
    undefined,
    10,
  );

  const boardX = x + 10;
  const boardY = y + 42;
  const boardWidth = Math.min(76, width * 0.25);
  const boardHeight = height - 86;
  const firstSlot = agentBarSlot(blocks, 0);
  const barX = boardX + boardWidth + 10;
  const barWidth = Math.max(0, x + width - 10 - barX);
  const counterY = y + height - OFFICE_GEOMETRY.agentBarCounterBottomClearance;
  const capacity = firstSlot.capacity;
  const visibleBarAgents = projection.barAgents.slice(0, capacity);
  drawPartyBoard(room, boardX, boardY, boardWidth, boardHeight, visibleBarAgents.length);
  visibleBarAgents.forEach((agent, index) => {
    const slot = agentBarSlot(blocks, index);
    const px = slot.x;
    const rowY = slot.rowY;
    const cue = agent.stale ? { label: "STALE", color: 0x79869a } : STATUS_CUES[agent.semanticStatus];
    const name = label(shortLabel(agent.displayLabel, 10), {
      size: 8,
      color: 0xf0ece5,
      anchor: 0.5,
    });
    name.position.set(px, rowY + 1);
    makeInteractive(name, agent.key, onSelect, onActivateAgent);
    room.addChild(name);
    const state = label(cue.label, { size: 6, color: cue.color, anchor: 0.5 });
    state.position.set(px, rowY + 12);
    makeInteractive(state, agent.key, onSelect, onActivateAgent);
    room.addChild(state);
    const characterFeetY = slot.characterFeetY;
    const character = drawCharacter(
      room,
      textures[agent.characterIndex] ?? Texture.EMPTY,
      px,
      characterFeetY,
      false,
      agent.stale,
      animated,
      agent.key,
      onSelect,
      selectedKey,
      onActivateAgent,
    );
    character.alpha = agent.stale ? 0.56 : 1;
  });
  drawBarCounter(
    room,
    barX,
    counterY,
    barWidth,
    visibleBarAgents.map((_, index) => agentBarSlot(blocks, index).x),
  );
  drawBarBottleRow(room, barX, y + height, barWidth);
  const overflowCount = projection.coverage.omittedBarAgents + Math.max(0, projection.barAgents.length - capacity);
  if (overflowCount > 0) {
    const overflow = label(`+${overflowCount} more`, {
      size: 8,
      color: 0xe5cf98,
      anchor: { x: 1, y: 0 },
    });
    overflow.position.set(x + width - 10, y + 12);
    room.addChild(overflow);
  }
  parent.addChild(room);
}

function drawPartyBoard(
  parent: Container,
  x: number,
  y: number,
  width: number,
  height: number,
  idleCount: number,
) {
  const board = new Graphics();
  board.roundRect(x + 3, y + 4, width, height, 4).fill({ color: 0x000000, alpha: 0.28 });
  board.roundRect(x, y, width, height, 4).fill(0x553b25);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 2).fill(0x17251f);
  board.roundRect(x + 4, y + 4, width - 8, height - 8, 2)
    .stroke({ width: 1, color: 0x9b7542, alpha: 0.72 });
  parent.addChild(board);
  const heading = label("PARTY", { size: 11, color: 0xf2d78f, anchor: 0.5 });
  heading.position.set(x + width / 2, y + 17);
  parent.addChild(heading);
  const value = label(String(idleCount), { size: 26, color: 0xf1e9bd, anchor: 0.5 });
  value.position.set(x + width / 2, y + height / 2 - 4);
  parent.addChild(value);
  drawPartyDecorations(parent, x, y, width, height);
}

function drawPartyDecorations(parent: Container, x: number, y: number, width: number, height: number) {
  const decorations = new Graphics();
  const confetti = [
    [10, 25, 0xe29b66], [width - 14, 23, 0x8fb9d8], [16, 58, 0x9fceac],
    [width - 20, 68, 0xdca4c7], [10, height - 32, 0xf3c07e], [width - 14, height - 30, 0xe29b66],
  ] as const;
  confetti.forEach(([offsetX, offsetY, color], index) => {
    if (index % 2 === 0) {
      decorations.rect(x + offsetX, y + offsetY, 3, 7).fill(color);
    } else {
      decorations.circle(x + offsetX, y + offsetY, 2.5).fill(color);
    }
  });
  const glassX = x + width / 2 - 4;
  const glassY = y + height - 30;
  decorations.roundRect(glassX - 6, glassY, 12, 9, 3)
    .stroke({ width: 1.5, color: 0xf1d19a, alpha: 0.9 });
  decorations.rect(glassX - 1, glassY + 9, 2, 9).fill(0xf1d19a);
  decorations.rect(glassX - 7, glassY + 18, 14, 2).fill(0xf1d19a);
  parent.addChild(decorations);
}

function drawBarBottleRow(parent: Container, x: number, roomBottom: number, width: number) {
  const shelf = new Graphics();
  const bottleY = roomBottom - 30;
  const shelfY = bottleY + 18;
  const shelfWidth = Math.max(0, width - 16);
  shelf.rect(x + 8, shelfY, shelfWidth, 3)
    .fill({ color: 0x5b3c2b, alpha: 0.72 });
  shelf.rect(x + 8, shelfY + 3, shelfWidth, 1)
    .fill({ color: 0xd0a878, alpha: 0.36 });
  parent.addChild(shelf);
  const drinks = new Graphics();
  const count = Math.max(3, Math.min(12, Math.floor(width / 42)));
  for (let index = 0; index < count; index += 1) {
    const drinkX = x + 14 + ((shelfWidth - 12) * index) / Math.max(1, count - 1);
    const drinkY = bottleY;
    const liquid = [0xd36e57, 0x7ab9c4, 0xd6a24e, 0xb884d6][index % 4];
    drinks.roundRect(drinkX - 4, drinkY, 8, 13, 2)
      .fill({ color: liquid, alpha: 0.86 })
      .stroke({ width: 1, color: 0xf1d19a, alpha: 0.78 });
    drinks.rect(drinkX - 2, drinkY - 4, 4, 4).fill(0xf1d19a);
  }
  parent.addChild(drinks);
}

function drawBarCounter(
  parent: Container,
  x: number,
  y: number,
  width: number,
  glassXs: readonly number[],
) {
  const counter = new Graphics();
  counter.roundRect(x + 3, y + 6, width, 34, 8).fill({ color: 0x000000, alpha: 0.28 });
  counter.roundRect(x, y, width, 32, 7).fill(0x4c3122);
  counter.roundRect(x + 4, y + 4, width - 8, 9, 4).fill(0x8b5b35);
  counter.rect(x + 8, y + 7, width - 16, 2).fill({ color: 0xd0a878, alpha: 0.54 });
  counter.roundRect(x + 8, y + 16, width - 16, 12, 4).fill(0x38231d);
  for (let panel = x + 24; panel < x + width - 18; panel += 52) {
    counter.rect(panel, y + 19, 1, 7).fill({ color: 0xb07945, alpha: 0.4 });
  }
  for (let tap = x + 24; tap < x + width - 20; tap += 74) {
    counter.circle(tap, y + 10, 3).fill(0xd0a878);
    counter.rect(tap - 1, y + 9, 2, 7).fill(0x5b3c2b);
  }
  parent.addChild(counter);
  const drinks = new Graphics();
  glassXs.forEach((drinkX, index) => {
    const drinkY = y - 9;
    const liquid = [0xd36e57, 0x7ab9c4, 0xd6a24e, 0xb884d6][index % 4];
    drinks.roundRect(drinkX - 5, drinkY, 10, 8, 2)
      .fill({ color: liquid, alpha: 0.9 })
      .stroke({ width: 1, color: 0xf1d19a, alpha: 0.9 });
    drinks.rect(drinkX - 1, drinkY + 8, 2, 7).fill(0xf1d19a);
    drinks.rect(drinkX - 6, drinkY + 15, 12, 2).fill(0xf1d19a);
  });
  parent.addChild(drinks);
}

function drawCharacter(
  parent: Container,
  texture: Texture,
  x: number,
  feetY: number,
  working: boolean,
  stale: boolean,
  animated: AnimatedItem[],
  key: string,
  onSelect: (key: string) => void,
  selectedKey: string | null,
  onActivateAgent?: (key: string) => void,
) {
  const container = new Container();
  container.position.set(x, feetY);
  // The sprite texture contains transparent pixels and is not a comfortable
  // interaction target by itself. Give the whole character silhouette a
  // stable rectangular hit region so the tooltip follows ordinary pointer
  // movement over the character, not only opaque texture pixels.
  container.hitArea = new Rectangle(
    -30,
    -OFFICE_GEOMETRY.characterHeight - 8,
    60,
    OFFICE_GEOMETRY.characterHeight + 18,
  );
  addCharacterSprite(container, texture);
  const hitTarget = new Graphics();
  hitTarget.rect(
    -30,
    -OFFICE_GEOMETRY.characterHeight - 8,
    60,
    OFFICE_GEOMETRY.characterHeight + 18,
  ).fill({ color: 0xffffff, alpha: 0.0001 });
  makeInteractive(hitTarget, key, onSelect, onActivateAgent);
  container.addChild(hitTarget);
  if (selectedKey === key) {
    const selected = new Graphics();
    selected.ellipse(0, -2, 25, 8).stroke({ width: 2, color: 0xffffff, alpha: 0.9 });
    container.addChildAt(selected, 0);
  }
  makeInteractive(container, key, onSelect, onActivateAgent);
  if (working && !stale) {
    animated.push({ kind: "character", node: container, baseY: feetY, phase: animated.length * 7 });
  }
  parent.addChild(container);
  return container;
}

function addCharacterSprite(container: Container, texture: Texture) {
  if (texture !== Texture.EMPTY) {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.scale.set(OFFICE_GEOMETRY.characterHeight / Math.max(1, texture.height));
    sprite.roundPixels = true;
    container.addChild(sprite);
  } else {
    const fallback = label("◆", { size: 22, color: 0xb4befe, anchor: 0.5 });
    fallback.position.y = -22;
    container.addChild(fallback);
  }
}

function drawChair(parent: Container, x: number, y: number, accent: number) {
  const chair = new Graphics();
  const frame = blendColor(accent, 0x0b0d16, 0.3);
  const cushion = blendColor(accent, 0x20243a, 0.38);
  chair.ellipse(x, y + 13, 28, 7).fill({ color: 0x000000, alpha: 0.24 });
  chair.rect(x - 2, y + 1, 4, 11).fill(frame);
  chair.rect(x - 13, y + 10, 26, 3).fill(frame);
  chair.circle(x - 13, y + 13, 3).fill(frame);
  chair.circle(x + 13, y + 13, 3).fill(frame);
  chair.ellipse(x, y, 27, 11).fill(cushion);
  chair.roundRect(x - 20, y - 31, 40, 22, 7).fill(frame);
  chair.roundRect(x - 16, y - 28, 32, 15, 5).fill(cushion);
  chair.roundRect(x - 13, y - 25, 26, 3, 2).fill({ color: accent, alpha: 0.48 });
  parent.addChild(chair);
}

function drawChairArms(parent: Container, x: number, y: number, accent: number) {
  const arms = new Graphics();
  const color = blendColor(accent, 0x0e1020, 0.18);
  arms.roundRect(x - 20, y - 14, 6, 17, 3).fill(color);
  arms.roundRect(x + 14, y - 14, 6, 17, 3).fill(color);
  parent.addChild(arms);
}

function drawDesk(
  parent: Container,
  x: number,
  y: number,
  accent: number,
  working: boolean,
  animated: AnimatedItem[],
  selected = false,
) {
  const desk = new Graphics();
  desk.ellipse(x + 24, y + 30, 30, 6).fill({ color: 0x000000, alpha: 0.22 });
  desk.roundRect(x, y, 48, 26, 3).fill(0x765b38);
  desk.roundRect(x + 2, y + 2, 44, 22, 2).fill(0xae8b5d);
  desk.roundRect(x + 14, y + 10, 21, 13, 2).fill(blendColor(accent, 0x101722, 0.7));
  desk.roundRect(x + 16, y + 12, 17, 8, 1).fill(working ? 0x347d86 : 0x172131);
  desk.rect(x + 1, y + 24, 46, 2).fill({ color: accent, alpha: 0.78 });
  if (selected) {
    desk.roundRect(x - 3, y - 3, 54, 32, 5)
      .stroke({ width: 2, color: 0xffffff, alpha: 0.92 });
  }
  parent.addChild(desk);
  if (working) {
    const glow = new Graphics();
    glow.roundRect(x + 16, y + 12, 17, 8, 1).fill({ color: 0xc9fff4, alpha: 0.18 });
    glow.eventMode = "none";
    parent.addChild(glow);
    animated.push({ kind: "monitor", node: glow, baseAlpha: 0.18, phase: animated.length * 7 });
  }
  return desk;
}

function drawPlant(parent: Container, x: number, y: number, accent: number) {
  const plant = new Graphics();
  plant.roundRect(x - 6, y, 12, 8, 2).fill(0xa65c46);
  plant.circle(x, y - 4, 7).fill(blendColor(accent, 0x4f956f, 0.7));
  plant.circle(x - 5, y - 7, 4).fill(0x5b9c78);
  plant.circle(x + 5, y - 7, 4).fill(0x69aa85);
  parent.addChild(plant);
}

function drawTiledFloor(
  graphics: Graphics,
  x: number,
  y: number,
  width: number,
  height: number,
  first: number,
  second: number,
) {
  for (let offsetY = 0; offsetY < height; offsetY += OFFICE_GEOMETRY.tile) {
    for (let offsetX = 0; offsetX < width; offsetX += OFFICE_GEOMETRY.tile) {
      graphics.rect(x + offsetX, y + offsetY, OFFICE_GEOMETRY.tile, OFFICE_GEOMETRY.tile)
        .fill(((offsetX + offsetY) / OFFICE_GEOMETRY.tile) % 2 === 0 ? first : second);
    }
  }
}

function addSign(
  parent: Container,
  x: number,
  y: number,
  value: string,
  color: number,
  width: number,
  key?: string,
  onSelect?: (key: string) => void,
  onActivate?: (key: string) => void,
  textSize = 10,
) {
  const background = new Graphics();
  background.roundRect(x, y, width, 19, 4).fill(color);
  background.roundRect(x, y, width, 19, 4)
    .stroke({ width: 1, color: blendColor(color, 0xffffff, 0.32), alpha: 0.72 });
  if (key && onSelect) {
    makeInteractive(background, key, onSelect, onActivate);
  }
  parent.addChild(background);
  const copy = label(value, { size: textSize, color: 0xffffff, anchor: 0.5 });
  copy.position.set(x + width / 2, y + 9.5);
  if (key && onSelect) {
    makeInteractive(copy, key, onSelect, onActivate);
  }
  parent.addChild(copy);
}

function makeInteractive(
  node: Container | Graphics | Text,
  key: string,
  onSelect: (key: string) => void,
  onActivate?: (key: string) => void,
) {
  node.label = key;
  node.eventMode = "static";
  node.cursor = "pointer";
  node.on("pointertap", (event) => {
    event.stopPropagation();
    officeDebug("renderer:pointertap", {
      key,
      detail: event.detail,
      hasActivation: Boolean(onActivate),
    });
    if (event.detail === 0) {
      pointerSequences.delete(onSelect);
      canvasActivationCandidates.delete(onSelect);
      onSelect(key);
      return;
    }
    const now = window.performance.now();
    const prior = pointerSequences.get(onSelect);
    const isSecondClick = prior?.key === key
      && (event.detail === 2 || now - prior.at <= 500);
    onSelect(key);
    if (isSecondClick) {
      pointerSequences.delete(onSelect);
      canvasActivationCandidates.delete(onSelect);
      onActivate?.(key);
      return;
    }
    pointerSequences.set(onSelect, {
      key,
      at: now,
      x: event.global.x,
      y: event.global.y,
      activate: onActivate,
    });
    const candidate = canvasActivationCandidates.get(onSelect);
    if (onActivate && (!candidate || now - candidate.at > 1_000)) {
      canvasActivationCandidates.set(onSelect, {
        key,
        at: now,
        x: event.global.x,
        y: event.global.y,
        activate: onActivate,
      });
    }
  });
}

function label(
  value: string,
  options: {
    size?: number;
    color?: number;
    anchor?: number | { x: number; y: number };
    weight?: "600" | "700";
  } = {},
) {
  const text = new Text({
    text: value,
    resolution: 4,
    style: new TextStyle({
      fontSize: options.size ?? 9,
      fill: options.color ?? 0xffffff,
      fontWeight: options.weight ?? "600",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      dropShadow: { alpha: 0.24, distance: 1, color: 0x000000 },
    }),
  });
  if (typeof options.anchor === "number") {
    text.anchor.set(options.anchor);
  } else if (options.anchor) {
    text.anchor.set(options.anchor.x, options.anchor.y);
  }
  return text;
}

function officeFontReady() {
  const fonts = document.fonts;
  return !fonts || (
    fonts.status === "loaded" &&
    fonts.check(`600 ${OFFICE_HEADING_TEXT_SIZE}px Inter`)
  );
}

function measureOfficeRoomHeader(
  title: string,
  hostTitle: string,
  titleMode: OfficeLongRoomTitleMode,
) {
  const labels = officeHeaderLabels(title, hostTitle, titleMode);
  const hyphenWidth = measureOfficeHeadingText("-");
  const fixedWidth = 10 + 16 + hyphenWidth + 12 + 20 + hyphenWidth + 10;
  const maximumTitleBoxWidth = Math.max(
    0,
    OFFICE_GEOMETRY.maxExpandedRoomWidth -
      2 * OFFICE_GEOMETRY.roomHeaderSafeInset -
      2 * (
        OFFICE_GEOMETRY.roomHeaderActionWidth +
        OFFICE_GEOMETRY.roomHeaderActionGap +
        OFFICE_GEOMETRY.roomHeaderActionWidth +
        OFFICE_GEOMETRY.roomHeaderCloseGap
      ),
  );
  let workspace = labels.workspace;
  let host = labels.host;
  if (fixedWidth + measureOfficeHeadingText(workspace) + measureOfficeHeadingText(host) > maximumTitleBoxWidth) {
    const available = Math.max(0, maximumTitleBoxWidth - fixedWidth);
    const workspaceBudget = Math.floor(available * 0.52);
    workspace = fitOfficeLabelForCanvas(workspace, workspaceBudget);
    host = fitOfficeLabelForCanvas(host, Math.max(0, available - workspaceBudget));
  }
  const titleBoxWidth = Math.ceil(
    fixedWidth + measureOfficeHeadingText(workspace) + measureOfficeHeadingText(host),
  );
  return {
    titleBoxWidth,
    roomWidth: minimumRoomWidthForTitleBox(titleBoxWidth),
    workspace,
    host,
  };
}

function measureOfficeHeadingText(value: string) {
  const text = new Text({
    text: value.toUpperCase(),
    resolution: 4,
    style: new TextStyle({
      fontSize: OFFICE_HEADING_TEXT_SIZE,
      fill: 0xffffff,
      fontWeight: "600",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      dropShadow: { alpha: 0.24, distance: 1, color: 0x000000 },
    }),
  });
  const width = text.width;
  text.destroy();
  return width;
}

function fitOfficeLabelForCanvas(value: string, maximumWidth: number) {
  if (maximumWidth <= 0) {
    return "";
  }
  if (measureOfficeHeadingText(value) <= maximumWidth) {
    return value;
  }
  const ellipsis = "…";
  if (measureOfficeHeadingText(ellipsis) > maximumWidth) {
    return "";
  }
  const points = [...value];
  let end = points.length;
  while (end > 0 && measureOfficeHeadingText(`${points.slice(0, end).join("")}${ellipsis}`) > maximumWidth) {
    end -= 1;
  }
  return end > 0 ? `${points.slice(0, end).join("")}${ellipsis}` : ellipsis;
}

function shortLabel(value: string, limit: number) {
  const points = [...value];
  return points.length <= limit ? value : `${points.slice(0, Math.max(1, limit - 1)).join("")}…`;
}

function hostColor(host: OfficeHost) {
  return THEMES[host.deterministicSkin.themeIndex % THEMES.length].accent;
}

function blendColor(from: number, to: number, amount: number) {
  const ratio = Math.max(0, Math.min(1, amount));
  const fromRed = (from >> 16) & 0xff;
  const fromGreen = (from >> 8) & 0xff;
  const fromBlue = from & 0xff;
  const toRed = (to >> 16) & 0xff;
  const toGreen = (to >> 8) & 0xff;
  const toBlue = to & 0xff;
  return (
    (Math.round(fromRed + (toRed - fromRed) * ratio) << 16) |
    (Math.round(fromGreen + (toGreen - fromGreen) * ratio) << 8) |
    Math.round(fromBlue + (toBlue - fromBlue) * ratio)
  );
}

function ensureDiagnostics(): OfficeRendererDiagnostics {
  if (!window.__HERDR_WORLD_RENDERER__) {
    window.__HERDR_WORLD_RENDERER__ = {
      mounts: 0,
      destroys: 0,
      activeApplications: 0,
      activeTickers: 0,
      activeObservers: 0,
      activeListeners: 0,
      canvases: 0,
      frames: 0,
      sceneRenders: 0,
      sceneSkips: 0,
      ready: false,
      reducedMotion: false,
      lastError: null,
      animation: { characters: 0, monitors: 0, statuses: 0 },
      layout: null,
      publishedLayout: null,
      completionMarkers: 0,
    };
  }
  return window.__HERDR_WORLD_RENDERER__;
}

async function loadTexture(url: string) {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  if (typeof image.decode === "function") {
    await image.decode();
  } else {
    await new Promise<void>((resolve, reject) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => reject(new Error("character asset unavailable")), {
        once: true,
      });
    });
  }
  if (typeof globalThis.createImageBitmap === "function") {
    return Texture.from(await globalThis.createImageBitmap(image));
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("character asset canvas unavailable");
  }
  context.drawImage(image, 0, 0);
  return new Texture({ source: new CanvasSource({ resource: canvas }) });
}

function destroyTextures(textures: readonly Texture[]) {
  for (const texture of textures) {
    if (texture !== Texture.EMPTY) {
      texture.destroy(true);
    }
  }
}
