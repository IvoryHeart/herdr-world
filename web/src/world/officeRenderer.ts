/*
 * MODIFIED FILE NOTICE — Apache-2.0 Section 4(b)
 *
 * This TypeScript drawing adaptation is downstream Herdr World / Office work
 * derived from the historical Claw-Empire Office renderer. Source provenance,
 * source hashes, and license obligations are recorded in docs/world-assets.md.
 */

// Pixi’s CSP-safe polyfill replaces generated Function paths with static synchronizers.
import "pixi.js/unsafe-eval";

import { Application, Container, Texture } from "pixi.js";
import type {
  HerdrOfficeProjection,
  OfficeRoom,
} from "./herdrOfficeProjection";
import { OFFICE_GEOMETRY, OFFICE_NEARBY_AGENT_LIMIT } from "./officeGeometry";
import type {
  OfficeLayout,
  OfficeLongRoomTitleMode,
  OfficeRoomAlignment,
} from "./officeGeometry";
import { OfficeLayoutPublisher, resolveOfficeGeometry } from "./officeLayout";
import type {
  OfficeGeometryRoomDescriptor,
  PublishedOfficeLayout,
} from "./officeLayout";
import { officeDebug } from "../officeDebug";
import {
  officeVisibleReceptions,
  officeVisibleRooms,
} from "./officeVirtualization";
import { cacheOfficeStaticContent } from "./officeStaticCache";
import { OfficeScenePreparation } from "./officeScenePreparation";
import { OfficeFloorTextures } from "./officeFloorTextures";
import { officeSceneSignature } from "./officeSceneSignature";
import { yieldWorldTask } from "./worldObject";
import {
  registerWorldFrames,
  worldMotionPreference,
  type WorldFrames,
} from "./worldFrameScheduler";
import { OFFICE_SCENE_DESTROY_OPTIONS } from "./officeRendererResources";
import type { OfficeObservability } from "./officeObservability";
import type { OfficeCreationActionState } from "./officeRoomActions";
import {
  type AnimatedItem,
  type OfficeRendererController,
  type OfficeCanvasHover,
} from "./officeRendererTypes";
import { ensureDiagnostics } from "./officeRendererDiagnostics";
import { loadTexture, destroyTextures } from "./officeRendererTextures";
import { resolveOfficeAnchors } from "./officeRendererAnchors";
import {
  officeFontReady,
  measureOfficeRoomHeader,
  headingWidths,
} from "./officeDrawingShared";
import {
  pointerSequences,
  canvasActivationCandidates,
} from "./officeInteraction";
import { drawRoom } from "./officeRoomDrawing";
import { drawCeoReception } from "./officeReceptionDrawing";
import {
  drawBackground,
  drawHallways,
  drawRoomRoads,
} from "./officeCommonAreaDrawing";

export const CHARACTER_URLS = Array.from(
  { length: 12 },
  (_, index) => `/world/characters/${index + 1}-D-1.png`,
);

export async function createOfficeRenderer(
  element: HTMLElement,
  projection: HerdrOfficeProjection,
  selectedKey: string | null,
  completionSeenKeys: ReadonlySet<string>,
  observability: OfficeObservability,
  onSelect: (key: string) => void,
  onActivateAgent: (key: string) => void,
  onActivateRoom: (key: string) => void,
  seatCreationStates: Readonly<Record<string, OfficeCreationActionState>>,
  onNewSeat: (roomKey: string) => void,
  onHover: (hover: OfficeCanvasHover | null) => void,
  onLayoutChange: (layout: PublishedOfficeLayout | null) => void,
  onCanvasRendered: (revision: number) => void,
  roomAlignment: OfficeRoomAlignment,
  longRoomTitleMode: OfficeLongRoomTitleMode,
  initializationSignal?: AbortSignal,
  onRendererError?: (error: unknown) => void,
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
  let currentSeatCreationStates = seatCreationStates;
  const layoutPublisher = new OfficeLayoutPublisher();
  let currentLayout: PublishedOfficeLayout | null = null;
  let lastWidth = 0;
  let resizeTimer: number | null = null;
  let lastRendererSize = { width: 0, height: 0 };
  let lastViewportSize = { width: 0, height: 0 };
  let lastSceneSignature: string | null = null;
  let sceneRequest = 0;
  let sceneComplete = false;
  let tick = 0;
  let currentFontReady = officeFontReady();
  const animated: AnimatedItem[] = [];
  const layers = new Map<
    string,
    {
      signature: string;
      container: Container;
      ready: boolean;
      animated: AnimatedItem[];
    }
  >();
  let fontRevision = 0;
  const roomVersions = new WeakMap<OfficeRoom, number>();
  let nextRoomVersion = 0;
  const roomVersion = (room: OfficeRoom) => {
    let version = roomVersions.get(room);
    if (version === undefined)
      roomVersions.set(room, (version = ++nextRoomVersion));
    return version;
  };
  let cachedPixels = 0;
  const layerPixels = new WeakMap<Container, number>();
  const scrollElement = element.closest<HTMLElement>(".world-stage-scroll");
  const motionPreference = worldMotionPreference();
  let reducedMotion = motionPreference.matches;

  try {
    await app.init({
      width: OFFICE_GEOMETRY.minOfficeWidth,
      height: 640,
      autoStart: false,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      roundPixels: true,
      preference: "webgl",
      eventFeatures: { globalMove: false },
      accessibilityOptions: { activateOnTab: false },
    });
  } catch (error) {
    diagnostics.activeApplications = Math.max(
      0,
      diagnostics.activeApplications - 1,
    );
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    throw error;
  }
  if (disposed || initializationSignal?.aborted) {
    app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
    diagnostics.destroys += 1;
    diagnostics.activeApplications = Math.max(
      0,
      diagnostics.activeApplications - 1,
    );
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    if (diagnostics.activeApplications === 0) {
      diagnostics.ready = false;
      diagnostics.publishedLayout = null;
    }
    throw new Error("renderer disposed");
  }
  // Explicit ordinary-task turns between paints admit queued socket replies.
  // A frame-rate cap alone still leaves the automatic rAF chain ahead of input.
  app.ticker.maxFPS = 0;
  let animationWork: WorldFrames | null = null;
  diagnostics.interactionPaused = false;
  const cancelAnimation = () => animationWork?.cancel();
  const scheduleAnimation = () => {
    if (
      !disposed &&
      sceneComplete &&
      !reducedMotion &&
      !document.hidden &&
      animated.length
    )
      animationWork?.request("motion");
  };
  officeDebug("renderer:pixi-ready");
  const canvas = app.canvas;
  element.replaceChildren(canvas);
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-office-canvas", "true");
  canvas.style.imageRendering = "auto";
  // Pixi disables every native touch gesture on its event target. Office owns
  // selection through taps, but empty floor and roads must remain a natural
  // two-axis pan surface for the surrounding logical-canvas scroller.
  canvas.style.touchAction = "pan-x pan-y";
  diagnostics.canvases = document.querySelectorAll(
    "canvas[data-office-canvas='true']",
  ).length;
  diagnostics.lastError = null;

  const floors = new OfficeFloorTextures();
  const preparation = new OfficeScenePreparation(app.renderer);
  const textures = await Promise.all(
    CHARACTER_URLS.map((url) => loadTexture(url).catch(() => Texture.EMPTY)),
  );
  officeDebug("renderer:textures-ready", {
    textures: textures.filter((texture) => texture !== Texture.EMPTY).length,
  });
  if (disposed || initializationSignal?.aborted) {
    const ownsCanvas = element.contains(canvas);
    app.destroy(true, OFFICE_SCENE_DESTROY_OPTIONS);
    destroyTextures(textures);
    floors.destroy();
    preparation.destroy();
    if (ownsCanvas) {
      element.replaceChildren();
    }
    diagnostics.destroys += 1;
    diagnostics.activeApplications = Math.max(
      0,
      diagnostics.activeApplications - 1,
    );
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    diagnostics.canvases = document.querySelectorAll(
      "canvas[data-office-canvas='true']",
    ).length;
    if (diagnostics.activeApplications === 0) {
      diagnostics.ready = false;
      diagnostics.publishedLayout = null;
    }
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
    const closeToFirstClick =
      Math.hypot(event.offsetX - prior.x, event.offsetY - prior.y) <= 12;
    const current = window.performance.now() - prior.at <= 1_000;
    pointerSequences.delete(select);
    canvasActivationCandidates.delete(select);
    if (closeToFirstClick && current) {
      prior.activate(prior.key);
    }
  };
  app.canvas.addEventListener("dblclick", onCanvasDoubleClick);
  diagnostics.activeListeners += 3;
  animationWork = registerWorldFrames(
    element,
    (now) => {
      if (
        !disposed &&
        sceneComplete &&
        !reducedMotion &&
        !document.hidden &&
        animated.length
      )
        app.ticker.update(now);
      scheduleAnimation();
    },
    (paused) => {
      diagnostics.interactionPaused = paused;
    },
  );

  const reportSceneFailure = (error: unknown) => {
    diagnostics.lastError =
      error instanceof Error ? error.message.slice(0, 160) : "renderer failed";
    diagnostics.ready = false;
    onRendererError?.(error);
  };
  const acknowledgeCanvas = () => {
    if (
      currentLayout &&
      layoutPublisher.ackCanvasRendered(currentLayout.layoutRevision)
    )
      onCanvasRendered(currentLayout.layoutRevision);
  };
  const renderScene = async (layout: OfficeLayout) => {
    if (disposed) {
      return;
    }
    const scrollTop = scrollElement?.scrollTop ?? 0;
    const viewportHeight = Math.min(
      layout.totalHeight,
      Math.max(1, scrollElement?.clientHeight ?? layout.totalHeight),
    );
    const visibleRooms = officeVisibleRooms(
      layout.rooms,
      scrollTop,
      viewportHeight,
    );
    const visibleReceptions = officeVisibleReceptions(
      currentProjection.receptions,
      layout.ceoBlocks.receptions,
      scrollElement?.scrollLeft ?? 0,
      scrollElement?.clientWidth ?? layout.officeWidth,
    );
    const sceneSignature = officeSceneSignature({
      layout,
      projection: currentProjection,
      selectedKey: currentSelectedKey,
      completionSeenKeys: currentCompletionSeenKeys,
      observability: currentObservability,
      seatCreationStates: currentSeatCreationStates,
      visibleRoomIndices: visibleRooms.map(({ index }) => index),
      roomVersions: visibleRooms.map(({ index }) =>
        roomVersion(currentProjection.rooms[index]!),
      ),
      visibleReceptionIndices: visibleReceptions.map(({ index }) => index),
    });
    if (sceneSignature === lastSceneSignature) {
      diagnostics.sceneSkips += 1;
      if (sceneComplete) {
        app.render();
        acknowledgeCanvas();
      }
      return;
    }
    cancelAnimation();
    const request = ++sceneRequest;
    sceneComplete = false;
    diagnostics.ready = false;
    const current = () =>
      !disposed && !initializationSignal?.aborted && request === sceneRequest;
    const paintSlice = async (container?: Container, force = false) => {
      if (!current()) return false;
      if (container && !(await preparation.prepareScene(container, current)))
        return false;
      if (container) {
        const pixels = cacheOfficeStaticContent(
          container,
          new Set(animated.map(({ node }) => node)),
          app.renderer.resolution,
          Math.max(0, 4 * app.canvas.width * app.canvas.height - cachedPixels),
        );
        cachedPixels += pixels;
        layerPixels.set(container, pixels);
        container.renderable = true;
        for (const layer of layers.values()) {
          if (layer.container === container) layer.ready = true;
        }
        await yieldWorldTask();
        if (!current()) return false;
      }
      if (container || force) {
        app.render();
        await yieldWorldTask();
      }
      return current();
    };
    lastSceneSignature = sceneSignature;
    diagnostics.sceneRenders += 1;
    animated.splice(0);
    const wanted = new Set([
      "background",
      "ceo",
      "hallways",
      "roads",
      ...visibleRooms.map(
        ({ index }) => `room:${currentProjection.rooms[index]?.key}`,
      ),
    ]);
    for (const [key, layer] of layers) {
      if (!wanted.has(key)) {
        cachedPixels -= layerPixels.get(layer.container) ?? 0;
        layer.container.destroy(OFFICE_SCENE_DESTROY_OPTIONS);
        layers.delete(key);
      }
    }
    let layerIndex = 0;
    const drawLayer = (
      key: string,
      signature: string,
      draw: (container: Container, items: AnimatedItem[]) => void,
    ) => {
      let layer = layers.get(key);
      const changed = !layer || layer.signature !== signature;
      if (changed) {
        if (layer) {
          cachedPixels -= layerPixels.get(layer.container) ?? 0;
          layer.container.destroy(OFFICE_SCENE_DESTROY_OPTIONS);
        }
        layer = {
          signature,
          container: new Container(),
          ready: false,
          animated: [],
        };
        layer.container.renderable = false;
        draw(layer.container, layer.animated);
        layers.set(key, layer);
        app.stage.addChildAt(layer.container, layerIndex);
        diagnostics.layerBuilds += 1;
      } else {
        app.stage.setChildIndex(layer!.container, layerIndex);
        diagnostics.layerReuses += 1;
      }
      layerIndex += 1;
      layer!.animated.forEach((item, index) => {
        item.phase = (animated.length + index) * 7;
      });
      animated.push(...layer!.animated);
      return changed || !layer!.ready ? layer!.container : undefined;
    };
    if (
      !(await paintSlice(
        drawLayer(
          "background",
          JSON.stringify([layout.officeWidth, layout.totalHeight]),
          (parent) => drawBackground(parent, layout),
        ),
      ))
    )
      return;
    const ceoSignature = officeSceneSignature({
      layout,
      projection: currentProjection,
      selectedKey: currentSelectedKey,
      observability: currentObservability,
      visibleRoomIndices: [],
      visibleReceptionIndices: visibleReceptions.map(({ index }) => index),
    });
    if (
      !(await paintSlice(
        drawLayer("ceo", `${fontRevision}:${ceoSignature}`, (parent, items) =>
          drawCeoReception(
            parent,
            layout,
            currentProjection,
            currentObservability,
            currentSelectedKey,
            textures,
            items,
            select,
            activateAgent,
            visibleReceptions,
            floors,
          ),
        ),
      ))
    )
      return;
    if (
      !(await paintSlice(
        drawLayer(
          "hallways",
          layout.inputDigest ?? JSON.stringify(layout),
          (parent) => drawHallways(parent, layout),
        ),
      ))
    )
      return;
    for (const rect of visibleRooms) {
      const room = currentProjection.rooms[rect.index];
      if (!room) continue;
      const keys = new Set([
        room.key,
        ...room.roomAgents.map(({ key }) => key),
        ...room.desks.flatMap((desk) => [
          desk.key,
          ...desk.completionAgentKeys,
          ...desk.paneDevices.map(({ key }) => key),
        ]),
      ]);
      const signature = JSON.stringify([
        fontRevision,
        rect,
        roomVersion(room),
        currentProjection.hosts.find(({ key }) => key === room.hostKey),
        currentSelectedKey && keys.has(currentSelectedKey)
          ? currentSelectedKey
          : null,
        [...currentCompletionSeenKeys].filter((key) => keys.has(key)).sort(),
        currentSeatCreationStates[room.key],
      ]);
      if (
        !(await paintSlice(
          drawLayer(`room:${room.key}`, signature, (parent, items) =>
            drawRoom(
              parent,
              room,
              rect,
              currentProjection,
              currentSelectedKey,
              currentCompletionSeenKeys,
              textures,
              items,
              select,
              activateAgent,
              activateRoom,
              currentSeatCreationStates[room.key] ?? {
                visible: false,
                enabled: false,
                reason: null,
              },
              onNewSeat,
              floors,
            ),
          ),
        ))
      )
        return;
    }
    // Preserve the original painter order, including roads above room edges.
    if (
      !(await paintSlice(
        drawLayer(
          "roads",
          JSON.stringify([
            layout.inputDigest ?? layout,
            visibleRooms.map(({ index }) => index),
          ]),
          (parent) => drawRoomRoads(parent, layout, visibleRooms),
        ),
        true,
      ))
    )
      return;
    sceneComplete = true;
    scheduleAnimation();
    acknowledgeCanvas();
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
      (count, room) =>
        count +
        room.desks.reduce(
          (deskCount, desk) =>
            deskCount +
            desk.completionAgentKeys.filter(
              (key) => !currentCompletionSeenKeys.has(key),
            ).length,
          0,
        ),
      0,
    );
  };

  const syncScrollPosition = () => {
    app.stage.position.x = -(scrollElement?.scrollLeft ?? 0);
    app.stage.position.y = -(scrollElement?.scrollTop ?? 0);
    if (currentLayout) {
      void renderScene(currentLayout).catch(reportSceneFailure);
    }
  };
  if (scrollElement) {
    scrollElement.addEventListener("scroll", syncScrollPosition, {
      passive: true,
    });
    diagnostics.activeListeners += 1;
  }

  const build = async (requestedWidth = element.clientWidth) => {
    if (disposed) {
      return;
    }
    const viewportWidth = scrollElement?.clientWidth ?? element.clientWidth;
    const width = Math.floor(viewportWidth || requestedWidth || 0);
    const roomDescriptors: OfficeGeometryRoomDescriptor[] =
      currentProjection.rooms.map((room) => {
        const host = currentProjection.hosts.find(
          ({ key }) => key === room.hostKey,
        );
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
          deskCount:
            room.desks.length +
            (currentSeatCreationStates[room.key]?.visible &&
            room.desks.length < OFFICE_GEOMETRY.desksPerRoom
              ? 1
              : 0),
          deskFootprintWidth: room.desks.some(
            ({ paneDevices }) => paneDevices.length,
          )
            ? OFFICE_GEOMETRY.paneDeskWidth
            : undefined,
          deskFootprintHeight: room.desks.some(
            ({ paneDevices }) => paneDevices.length,
          )
            ? OFFICE_GEOMETRY.paneDeskRowHeight
            : undefined,
          standingCount:
            room.roomAgents.filter(({ placement }) => placement === "standing")
              .length -
            room.desks.reduce(
              (total, desk) =>
                total +
                (desk.paneDevices.length
                  ? Math.min(
                      OFFICE_NEARBY_AGENT_LIMIT,
                      room.roomAgents.filter(
                        ({ placement, deskKey }) =>
                          placement === "standing" && deskKey === desk.key,
                      ).length,
                    )
                  : 0),
              0,
            ),
          actions: {
            rename: true,
            close: true,
            createSeat: currentSeatCreationStates[room.key]?.visible === true,
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
    const canvasWidth = Math.min(
      layout.officeWidth,
      Math.max(1, scrollElement?.clientWidth ?? layout.officeWidth),
    );
    currentLayout = layout;
    const viewport = scrollElement ?? element;
    lastViewportSize = {
      width: viewport.clientWidth,
      height: viewport.clientHeight,
    };
    diagnostics.publishedLayout = layout;
    onLayoutChange(layout);
    lastWidth = layout.officeWidth;
    if (
      lastRendererSize.width !== canvasWidth ||
      lastRendererSize.height !== viewportHeight
    ) {
      app.renderer.resize(canvasWidth, viewportHeight);
      lastRendererSize = { width: canvasWidth, height: viewportHeight };
    }
    element.style.width = `${layout.officeWidth}px`;
    element.style.height = `${layout.totalHeight}px`;
    app.stage.position.x = -(scrollElement?.scrollLeft ?? 0);
    app.stage.position.y = -(scrollElement?.scrollTop ?? 0);
    await renderScene(layout);
    if (disposed || currentLayout !== layout) return;
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
    tick += app.ticker.deltaTime;
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
    headingWidths.clear();
    fontRevision += 1;
    currentFontReady = ready;
    lastSceneSignature = null;
    void build(lastWidth || element.clientWidth).catch(reportSceneFailure);
  };
  fontSet?.addEventListener("loadingdone", refreshFontMetrics);
  if (fontSet) {
    void fontSet.ready.then(() => {
      // The initial scene already measured a loaded font. Rebuilding it again
      // in the same microtask turn delays socket replies without changing it.
      if (officeFontReady() !== currentFontReady) refreshFontMetrics();
    });
    diagnostics.activeListeners += 1;
  }

  const onMotionChange = (event: MediaQueryListEvent) => {
    reducedMotion = event.matches;
    diagnostics.reducedMotion = reducedMotion;
    cancelAnimation();
    if (reducedMotion) {
      for (const item of animated) {
        if (item.kind === "character") {
          item.node.y = item.baseY;
        } else {
          item.node.alpha = item.baseAlpha;
        }
      }
    }
    if (sceneComplete) app.render();
    scheduleAnimation();
  };
  const onVisibilityChange = () => {
    cancelAnimation();
    if (!document.hidden && sceneComplete) {
      app.render();
      scheduleAnimation();
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  diagnostics.activeListeners += 1;
  motionPreference.addEventListener("change", onMotionChange);
  diagnostics.activeListeners += 1;

  const observer = new ResizeObserver((entries) => {
    const nextWidth = Math.max(
      OFFICE_GEOMETRY.minOfficeWidth,
      Math.floor(entries[0]?.contentRect.width || 0),
    );
    const viewport = scrollElement ?? element;
    if (
      Math.abs(nextWidth - lastWidth) <= 10 &&
      viewport.clientWidth === lastViewportSize.width &&
      viewport.clientHeight === lastViewportSize.height
    ) {
      return;
    }
    if (resizeTimer !== null) {
      window.clearTimeout(resizeTimer);
    }
    resizeTimer = window.setTimeout(() => {
      resizeTimer = null;
      void build(nextWidth).catch(reportSceneFailure);
    }, 80);
  });
  observer.observe(scrollElement ?? element);
  diagnostics.activeObservers += 1;
  try {
    await build();
    scheduleAnimation();
  } catch (error) {
    cancelAnimation();
    animationWork?.dispose();
    observer.disconnect();
    motionPreference.removeEventListener("change", onMotionChange);
    document.removeEventListener("visibilitychange", onVisibilityChange);
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
    floors.destroy();
    preparation.destroy();
    diagnostics.activeApplications = Math.max(
      0,
      diagnostics.activeApplications - 1,
    );
    diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
    diagnostics.activeObservers = Math.max(0, diagnostics.activeObservers - 1);
    diagnostics.activeListeners = Math.max(
      0,
      diagnostics.activeListeners - (scrollElement ? 7 : 6),
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
      nextSeatCreationStates = currentSeatCreationStates,
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
      currentSeatCreationStates = nextSeatCreationStates;
      return build(lastWidth || element.clientWidth);
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
      cancelAnimation();
      animationWork?.dispose();
      const ownsCanvas = element.contains(canvas);
      if (resizeTimer !== null) {
        window.clearTimeout(resizeTimer);
      }
      observer.disconnect();
      motionPreference.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
      floors.destroy();
      preparation.destroy();
      if (ownsCanvas) {
        element.replaceChildren();
      }
      element.style.removeProperty("width");
      element.style.removeProperty("height");
      diagnostics.destroys += 1;
      diagnostics.activeApplications = Math.max(
        0,
        diagnostics.activeApplications - 1,
      );
      diagnostics.activeTickers = Math.max(0, diagnostics.activeTickers - 1);
      diagnostics.activeObservers = Math.max(
        0,
        diagnostics.activeObservers - 1,
      );
      diagnostics.activeListeners = Math.max(
        0,
        diagnostics.activeListeners - (scrollElement ? 7 : 6),
      );
      diagnostics.canvases = document.querySelectorAll(
        "canvas[data-office-canvas='true']",
      ).length;
      if (diagnostics.activeApplications === 0) {
        diagnostics.ready = false;
        diagnostics.publishedLayout = null;
      }
      onLayoutChange(null);
    },
  };
}

export type { OfficeRendererDiagnostics } from "./officeRendererTypes";
export type { OfficeRendererController } from "./officeRendererTypes";
export type { OfficeRendererAnchor } from "./officeRendererTypes";
export type { OfficeCanvasHover } from "./officeRendererTypes";
export type { OfficeRendererAnchors } from "./officeRendererTypes";
