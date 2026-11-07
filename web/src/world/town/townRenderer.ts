import type { TownRoomPlacement } from "./townRoomPlace";
import {
  TownAmbient,
  townSpriteVisible,
  createTownBlink,
  createTownScreenResolver,
} from "./townAmbient";
import { drawTownSelectionEffects } from "./townSelectionEffects";
/**
 * Pixi renderer for the Office town.
 *
 * Baked layers (ground chunks, interiors, façades and roofs) are uploaded once
 * per layout. Desks, agents and effects are retained sprites updated in place.
 * Drawing goes through the shared World frame scheduler, so ambient motion
 * pauses while the user types in a terminal and input budgets hold.
 */

import { Application, Container, Graphics, Sprite } from "pixi.js";
import type { OfficeAgent } from "../herdrOfficeProjection";
import {
  worldMotionPreference,
  type WorldFrames,
} from "../worldFrameScheduler";
import { registerTownFrames } from "./townFrameLifecycle";
import { createTownDragEffects } from "./townRendererDrag";
import { createTownActorViews } from "./townRendererActors";
import { textureOf } from "./townRendererScene";
import { createTownTopology } from "./townRendererTopology";
import type { TownSceneFrame, TownSceneState } from "./scene/townSceneDiff";
import { diagnostics, type TownFrameTrace } from "./townDiagnostics";
export type { TownFrameTrace } from "./townDiagnostics";
import { DEVTOOLS } from "../devtools/flag";

import {
  TownActors,
  townActorWorld,
  type TownActor,
  type TownActorWorld,
} from "./townActors";
import type { TownMoveResult } from "./townMoves";
import {
  TownCamera,
  townBlend,
  townLevel,
  type TownLevel,
  type TownViewport,
} from "./townCamera";
import {
  TOWN_TILE as T,
  townGeometryKey,
  type TownCell,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import type { TerminalColor } from "../terminalColor";
import { createTownLookResolver } from "./townAppearance";
import { createTownBinnedDesks, TOWN_CRUMB_RATE } from "./townBinnedDesks";
import {
  townCarpetFor,
  townChosenCarpet,
  townHostTheme,
  type TownHostTheme,
} from "./townPaint";
import { buildTownSprites, townCharacter, townHash } from "./townSprites";

export type { TownRendererDiagnostics } from "./townDiagnostics";

export type { TownSceneState } from "./scene/townSceneDiff";

export type TownRendererHandle = {
  camera: TownCamera;
  readonly level: TownLevel;
  /** The town now and what changed since the last frame applied (scene/townSceneDiff.ts). */
  apply(frame: TownSceneFrame): void;
  setViewport(viewport: TownViewport): void;
  /** Ask for a redraw after camera input; the reason is traced. */
  invalidate(reason?: string): void;
  actorPosition(key: string): { x: number; y: number; seated: boolean } | null;
  roofAlpha(hostKey: string): number;
  /**
   * A building gliding or fading in after a topology change: its drawn
   * offset (world pixels) and opacity, for the DOM drawn over it.
   */
  buildingMotion(
    hostKey: string,
  ): { x: number; y: number; alpha: number } | null;
  /** Lift a desk, agent or room under the pointer for a drag. */
  beginDrag(
    kind: "desk" | "agent" | "room",
    key: string,
    x: number,
    y: number,
  ): void;
  /** Follow the pointer (world point) and show where it would land. */
  /** `snap`: the target is a desk the carried desk groups with. */
  moveDrag(
    x: number,
    y: number,
    targetKey: string | null,
    snap?: boolean,
    /** A carried room: where every room would stand if it landed here. */
    room?: TownRoomPlacement | null,
  ): void;
  /** Spring back to its spot, or wait at the target while Herdr moves it. */
  endDrag(mode: "cancel" | "park"): void;
  /** Land on the target with a puff, spring home, or fade when uncertain. */
  finishMove(result: TownMoveResult): void;
  /** Tidy rooms: glide a building's rooms once the town shows them moved. */
  beginGlide(hostKey: string): void;
  finishGlide(result: TownMoveResult): void;
  destroy(): void;
};

/** How often a frame that only fills in the ground renders (see `forced`). */
const TOWN_FILL_RENDER_MS = 100;

const BLOCK_COLORS: Record<string, number> = {
  working: 0x6fc3ff,
  blocked: 0xffb547,
  done: 0x7be08f,
  shell: 0x7fbf7a,
};

const kindOf = (agent: OfficeAgent) => {
  const label =
    `${agent.harness ?? agent.displayLabel} ${agent.taskSummary ?? ""}`.toLowerCase();
  return label.includes("codex")
    ? "codex"
    : label.includes("gemini")
      ? "gemini"
      : "claude";
};

/** Yield to the browser so pending input runs before the next setup step. */
export const nextTownTask = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export async function createTownRenderer(
  element: HTMLElement,
  onFrame: (camera: TownCamera, level: TownLevel) => void,
  signal?: AbortSignal,
  /** A frame that threw; later frames still run. */
  onError?: (error: unknown) => void,
  /** Development builds: each frame's reasons, when they change. */
  onTrace?: (frame: TownFrameTrace) => void,
  /** The scene's camera (scene/townSceneCamera.ts); the renderer steps it. */
  camera = new TownCamera(),
  /** Evidence only, after a real render; materialization retains its work budget. */
  onDrawn?: (pending: boolean) => void,
  onInvalidate?: (reason: string) => void,
): Promise<TownRendererHandle> {
  if (window.__HERDR_WORLD_FORCE_RENDERER_FAILURE__)
    throw new Error("renderer unavailable");
  const stats = diagnostics();
  stats.mounts += 1;
  stats.activeApplications += 1;
  stats.activeTickers += 1;
  stats.ready = false;
  // Setup runs as separate tasks, so input is not held behind React's commit,
  // the WebGL context and sprite painting all at once.
  await nextTownTask();
  const app = new Application();
  try {
    await app.init({
      width: Math.max(1, element.clientWidth),
      height: Math.max(1, element.clientHeight),
      autoStart: false,
      backgroundAlpha: 0,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      roundPixels: false,
      preference: "webgl",
      eventFeatures: {
        move: false,
        globalMove: false,
        click: false,
        wheel: false,
      },
      accessibilityOptions: { activateOnTab: false },
    });
  } catch (error) {
    stats.activeApplications = Math.max(0, stats.activeApplications - 1);
    stats.activeTickers = Math.max(0, stats.activeTickers - 1);
    throw error;
  }
  if (signal?.aborted) {
    app.destroy(true, { children: true, texture: false });
    stats.activeApplications = Math.max(0, stats.activeApplications - 1);
    stats.activeTickers = Math.max(0, stats.activeTickers - 1);
    stats.destroys += 1;
    throw new Error("renderer disposed");
  }
  app.ticker.stop();
  app.stage.eventMode = "none";
  const canvas = app.canvas;
  canvas.setAttribute("aria-hidden", "true");
  canvas.setAttribute("data-office-canvas", "true");
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  element.replaceChildren(canvas);

  await nextTownTask();
  const sprites = buildTownSprites();
  const actors = new TownActors();
  const motion = worldMotionPreference();
  camera.reducedMotion = motion.matches;
  stats.reducedMotion = motion.matches;

  const world = new Container();
  const landLayer = new Container();
  const groundLayer = new Container();
  const sceneLayer = new Container();
  sceneLayer.sortableChildren = true;
  const fxLayer = new Graphics();
  const screenLayer = new Container();
  // Drag effects sit above the scene and survive a scene rebuild.
  const dragLayer = new Container();
  const puffLayer = new Graphics();
  world.addChild(
    landLayer,
    groundLayer,
    sceneLayer,
    fxLayer,
    dragLayer,
    puffLayer,
  );
  app.stage.addChild(world, screenLayer);

  let model: TownModel | null = null;
  /** A desk's table is drawn in its terminal colour. */
  const deskColor = (deskKey: string): TerminalColor =>
    model?.deskColors.get(deskKey) ?? "blue";
  let layout: TownLayout | null = null;
  let state: TownSceneState = {
    selectedKey: null,
    hoverKey: null,
    completionSeenKeys: new Set(),
    summonedKeys: new Set(),
    openHostKey: null,
    calm: false,
  };
  let level: TownLevel = "overview";
  let disposed = false;
  let last = 0;
  let clock = 0;
  let ambient = new TownAmbient(clock);
  let ambientTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelAmbient = () => {
    if (ambientTimer !== null) clearTimeout(ambientTimer);
    ambientTimer = null;
  };
  const visible = (sprite: Sprite | Graphics) =>
    townSpriteVisible(sprite, camera.viewport);

  /** A topology change waits for a whole frame (townTransition.ts). */
  let topologyPending = false;
  let transitioning = false;
  /**
   * Each render redraws the whole window, land included. While the ground
   * only fills in behind an otherwise still scene, one render per painted
   * chunk multiplied that cost on a zoomed-out town, so those frames paint
   * on and render at most every TOWN_FILL_RENDER_MS. Anything else wanting
   * a frame (`forced`) renders it, as does the frame that finds nothing left
   * to paint.
   */
  let lastRender = -Infinity;
  let forced = true;

  const themeFor = (hostKey: string): TownHostTheme =>
    townHostTheme(
      hostKey,
      model?.hosts.get(hostKey)?.deterministicSkin.themeIndex,
      model?.placeColors.hosts.get(hostKey),
    );
  const carpetFor = (roomKey: string) =>
    townChosenCarpet(model?.placeColors.rooms.get(roomKey));

  let dimDirty = true;
  const topology = createTownTopology({
    camera,
    sprites,
    landLayer,
    groundLayer,
    sceneLayer,
    stats,
    model: () => model,
    layout: () => layout,
    deskColor,
    carpetFor,
    themeFor,
    dropActors: (hostKey) => agentViews.drop(hostKey),
    onBuilt: () => {
      dimDirty = true;
    },
  });
  const buildingByHost = topology.byHost;
  // Binned agents' seats fade and crumble until the bus takes them.
  const binnedDesks = createTownBinnedDesks({
    container: (hostKey) => buildingByHost.get(hostKey)?.dynamic,
    carpet: (roomKey) => carpetFor(roomKey) ?? townCarpetFor(roomKey),
    visible,
  });

  /** The layout and desk count the diagnostics report. */
  const recordLayout = () => {
    if (!layout) return;
    stats.desks = layout.buildings.reduce(
      (sum, b) =>
        sum +
        b.rooms.reduce(
          (n, r) => n + r.cells.filter((c) => c.deskKey).length,
          0,
        ),
      0,
    );
    stats.layout = {
      width: layout.width,
      height: layout.height,
      buildings: layout.buildings.length,
      rooms: layout.buildings.reduce((sum, b) => sum + b.rooms.length, 0),
      formFactor: layout.shape.formFactor,
      roomColumns: layout.shape.roomColumns,
      deskColumns: layout.shape.deskColumns,
      geometry: townGeometryKey(layout),
    };
  };

  const seatState = (deskKey: string, seat: number) => {
    const desk = model!.desks.get(deskKey);
    const device = desk?.paneDevices[seat];
    if (!device) return { state: "empty" as const, agent: null };
    if (!device.agentKey) return { state: "shell" as const, agent: null };
    const agent = model!.agents.get(device.agentKey) ?? null;
    if (!agent) return { state: "shell" as const, agent: null };
    const actor = actors.actors.get(agent.key);
    const seated = actor?.mode === "seat";
    const status = agent.semanticStatus;
    return {
      state:
        status === "blocked" ? "blocked" : seated ? status : ("off" as string),
      agent,
      seated,
    };
  };

  const resolveLook = createTownLookResolver();
  const lookOf = (key: string) => resolveLook(model?.agents.get(key), key);

  const resting = (agent: { semanticStatus: string }) =>
    agent.semanticStatus === "idle";
  /** Head-scratches a second: an agent in an unknown state is confused. */
  const CONFUSED_RATE = 0.8;

  const updatePods = (deskBlend: number, glow: boolean, lite: boolean) => {
    const frame = Math.floor(clock * 6);
    // The same fade as standing and walking agents (updateActors).
    const peopleBlend = Math.max(deskBlend, townBlend(0.35, 0.6, camera.z));
    for (const building of topology.buildings)
      for (const pod of building.pods) {
        if (!pod.container.visible) continue;
        pod.seats.forEach((view, seat) => {
          const info = seatState(pod.deskKey, seat);
          const top = view.top;
          const present = info.state !== "empty";
          view.device.visible = present && !lite;
          if (view.device.visible)
            view.device.texture = textureOf(
              top
                ? info.state === "shell"
                  ? sprites.lidShell
                  : info.agent &&
                      info.state !== "off" &&
                      info.state !== "idle" &&
                      info.state !== "unknown"
                    ? (sprites.lid[kindOf(info.agent)] ?? sprites.lidOff)
                    : sprites.lidOff
                : screenCanvas(
                    info.state === "empty" ? "off" : info.state,
                    frame,
                  ),
            );
          if (!top && view.device.visible && visible(view.device)) {
            if (info.state === "idle" || info.state === "unknown")
              ambient.every(1);
            else if (
              info.state === "working" ||
              info.state === "blocked" ||
              info.state === "shell"
            )
              ambient.every(6);
          }
          view.papers.visible = Boolean(
            info.agent &&
              info.agent.semanticStatus === "done" &&
              !state.completionSeenKeys.has(info.agent.key),
          );
          const person = view.person;
          const seated = Boolean(info.agent && info.seated);
          person.visible = seated && peopleBlend > 0.02;
          if (person.visible && info.agent) {
            const typing =
              info.agent.semanticStatus === "working"
                ? Math.floor(clock * 7 + (townHash(info.agent.key) % 7)) % 2
                : 0;
            // Confused agents scratch their heads, then look up again;
            // calm motion holds the scratch.
            const confused = info.agent.semanticStatus === "unknown";
            const phase = (townHash(info.agent.key) % 5) / 5;
            const animate = !state.calm && !camera.reducedMotion;
            const scratching =
              confused &&
              (!animate || Math.floor(clock * CONFUSED_RATE + phase) % 2 === 0);
            if (confused && animate && visible(person))
              ambient.every(CONFUSED_RATE, phase);
            person.texture = textureOf(
              townCharacter(
                lookOf(info.agent.key),
                top ? "down" : "up",
                typing,
                scratching ? "scratch" : "sit",
                // Idle agents doze with their eyes closed.
                top &&
                  (resting(info.agent) ||
                    blink(info.agent.key, visible(person))),
              ),
            );
            person.alpha = peopleBlend;
            if (info.agent.semanticStatus === "working" && visible(person))
              ambient.every(7, townHash(info.agent.key) % 7);
          }
          const glowSprite = view.glow;
          const color = BLOCK_COLORS[info.state];
          glowSprite.visible = glow && !lite && color !== undefined;
          if (glowSprite.visible) {
            glowSprite.tint = color!;
            const pulse =
              info.state === "blocked"
                ? 0.55 + 0.35 * Math.sin(clock * 5)
                : 0.5 + 0.08 * Math.sin(clock * 23 + seat);
            glowSprite.alpha = info.state === "shell" ? 0.3 : pulse;
            if (info.state !== "shell" && visible(glowSprite))
              ambient.continuous();
          }
        });
        if (pod.item) pod.item.visible = !lite;
      }
  };

  const screenCanvas = createTownScreenResolver();
  const blinkFrame = createTownBlink();
  const blink = (key: string, onScreen: boolean) =>
    blinkFrame(key, clock, onScreen, ambient);

  const agentViews = createTownActorViews({
    camera,
    actors,
    sprites,
    screenLayer,
    model: () => model,
    level: () => level,
    clock: () => clock,
    state: () => state,
    ambient: () => ambient,
    layoutCells: () => layoutCells,
    buildingOf: (hostKey) => buildingByHost.get(hostKey),
    lookOf,
    blink,
    visible,
  });

  let layoutCells = new Map<string, TownCell>();

  const updateRoofs = (dt: number) => {
    const roofZ = camera.limits?.roof ?? 0;
    let moving = false;
    for (const building of topology.buildings) {
      let target = camera.z >= roofZ ? 0 : 1;
      if (state.openHostKey === building.hostKey) target = 0;
      else if (
        target === 1 &&
        state.hoverKey === `building:${building.hostKey}`
      )
        target = 0.8;
      const rate = camera.reducedMotion ? 60 : 7;
      building.roofAlpha +=
        (target - building.roofAlpha) * (1 - Math.exp(-dt * rate));
      if (Math.abs(target - building.roofAlpha) < 0.002)
        building.roofAlpha = target;
      else moving = true;
      const alpha = building.roofAlpha;
      building.roof.alpha = alpha;
      building.roof.visible = alpha > 0.005;
      building.roof.y =
        layout!.buildings.find((b) => b.hostKey === building.hostKey)!.y * T -
        12 -
        Math.round((1 - alpha) * 22);
      building.facade.alpha = alpha;
      building.facade.visible = alpha > 0.005;
      building.stub.alpha = 1 - alpha;
      building.interior.visible =
        building.dynamic.visible =
        building.dim.visible =
          alpha < 0.995;
    }
    return moving;
  };

  const updateDim = () => {
    if (!model || !layout) return;
    for (const view of topology.buildings) {
      view.dim.clear();
      const building = layout.buildings.find((b) => b.hostKey === view.hostKey);
      if (!building) continue;
      const stale = model.hosts.get(view.hostKey)?.stale ?? false;
      for (const room of building.rooms) {
        const counts = model.roomCounts.get(room.key);
        const active = Boolean(counts && counts.working + counts.blocked > 0);
        if (!active || stale)
          view.dim
            .rect(
              room.x * T + 3,
              room.y * T + 3,
              room.w * T - 6,
              room.h * T - 6,
            )
            .fill({ color: 0x0e1220, alpha: stale ? 0.45 : 0.32 });
      }
      if (stale)
        view.dim
          .rect(building.x * T, building.y * T, building.w * T, building.h * T)
          .fill({ color: 0x141a2c, alpha: 0.35 });
    }
  };

  let frames: WorldFrames | null = null;
  // An error in one frame is reported and never stops later frames (nor,
  // through the shared scheduler, other views' frames).
  // A state frame and, in development builds, why it was wanted.
  const frameReasons = new Set<string>();
  let lastTraced = "";
  const request = (reason: string) => {
    forced = true;
    if (reason !== "capture") onInvalidate?.(reason);
    if (DEVTOOLS && onTrace) frameReasons.add(reason);
    frames?.request("state");
  };
  const draw = (now: number) => {
    const why = DEVTOOLS && onTrace ? [...frameReasons] : [];
    if (DEVTOOLS) frameReasons.clear();
    try {
      drawFrame(now, why);
    } catch (error) {
      stats.lastError =
        error instanceof Error ? error.message.slice(0, 160) : "frame failed";
      onError?.(error);
    }
  };
  const drawFrame = (now: number, why: string[]) => {
    if (disposed || !layout || !model) return;
    cancelAmbient();
    const elapsed = last ? Math.max(0, (now - last) / 1000) : 1 / 60;
    const dt = Math.min(0.05, elapsed);
    last = now;
    clock += elapsed;
    ambient = new TownAmbient(clock);
    stats.frames += 1;
    const cameraMoved = camera.update(dt);
    const actorsMoved = actors.step(camera.reducedMotion ? 10 : dt, elapsed);
    const limits = camera.limits!;
    level = townLevel(camera.z, limits);
    const deskBlend = townBlend(limits.desk * 0.82, limits.desk, camera.z);
    const lite = camera.z < 0.55;
    world.scale.set(camera.z);
    world.position.set(
      Math.round(camera.viewport.width / 2 - camera.x * camera.z),
      Math.round(camera.viewport.height / 2 - camera.y * camera.z),
    );
    const urgent = topologyPending || transitioning;
    const materializing = topology.materialize(urgent);
    if (dimDirty) {
      dimDirty = false;
      updateDim();
    }
    transitioning = topology.step(dt);
    if (topologyPending) {
      // Every frame of a topology change is whole (townSceneGaps).
      const gaps = topology.gaps();
      if (gaps.length) {
        stats.topologyGaps += 1;
        stats.lastTopologyGap = gaps.slice(0, 4).join(", ");
      } else topologyPending = false;
    }
    const roofsMoving = updateRoofs(dt);
    topology.cull();
    updatePods(deskBlend, camera.z >= 0.6, lite);
    if (binnedDesks.update(clock, camera.reducedMotion))
      ambient.every(TOWN_CRUMB_RATE);
    agentViews.update(Math.max(deskBlend, townBlend(0.35, 0.6, camera.z)));
    agentViews.updateBubbles();
    drawTownSelectionEffects(
      fxLayer,
      model,
      layout,
      actors,
      layoutCells,
      state,
      camera,
      clock,
      ambient,
    );
    onFrame(camera, level); // before the drag, so a carry aims at this frame
    const dragging = dragEffects.update(dt);
    const animated = !camera.reducedMotion && !state.calm;
    const onlyFilling =
      materializing &&
      !urgent &&
      !forced &&
      !cameraMoved &&
      !roofsMoving &&
      !actorsMoved &&
      !camera.flying &&
      !transitioning &&
      !dragging &&
      // Animation due now renders, unless typing has paused it.
      !(animated && frames?.motionAllowed && ambient.next === clock);
    forced = false;
    if (!onlyFilling || now - lastRender >= TOWN_FILL_RENDER_MS) {
      app.renderer.render(app.stage);
      lastRender = now;
    }
    onDrawn?.(materializing);
    stats.level = level;
    stats.zoom = camera.z;
    stats.flying = camera.flying;
    stats.transitioning = transitioning || camera.gliding;
    stats.buildingsDrawn = topology.buildings.length;
    stats.actors = actors.actors.size;
    stats.walking = [...actors.actors.values()].filter(
      (a) => a.mode === "walk",
    ).length;
    stats.animation = {
      characters: actors.actors.size,
      monitors: topology.buildings.reduce(
        (sum, b) => sum + b.pods.filter((pod) => pod.container.visible).length,
        0,
      ),
      statuses: agentViews.bubbleCount(),
    };
    if (!stats.ready) stats.ready = true;
    const moving =
      cameraMoved ||
      roofsMoving ||
      actorsMoved ||
      camera.flying ||
      materializing ||
      transitioning ||
      dragging;
    const next = moving
      ? "state"
      : animated && ambient.next === clock
        ? "motion"
        : null;
    // Animation sleeps under calm or reduced motion; timed state changes don't.
    const motionAt = animated ? ambient.next : Infinity;
    const wakeAt = Math.min(motionAt, ambient.change);
    if (next) frames?.request(next);
    else if (Number.isFinite(wakeAt))
      ambientTimer = setTimeout(
        () => {
          ambientTimer = null;
          forced = true;
          frames?.request(wakeAt === motionAt ? "motion" : "state");
        },
        Math.max(1, (wakeAt - clock) * 1000 - 16),
      );
    if (DEVTOOLS && onTrace) {
      const causes = Object.entries({
        camera: cameraMoved,
        roofs: roofsMoving,
        actors: actorsMoved,
        flight: camera.flying,
        materialize: materializing,
        transition: transitioning,
        drag: dragging,
      })
        .filter(([, on]) => on)
        .map(([name]) => name);
      // Each requested frame, and each change in what keeps frames coming;
      // not every frame of a steady animation.
      const signature = `${next}:${causes.join(",")}`;
      if (why.length || signature !== lastTraced) {
        lastTraced = signature;
        onTrace({ reasons: why, next, causes });
      }
    }
  };
  frames = registerTownFrames(element, canvas, draw, (paused) => {
    stats.interactionPaused = paused;
    if (paused) last = 0;
  });

  const onMotion = (event: MediaQueryListEvent) => {
    camera.reducedMotion = event.matches;
    stats.reducedMotion = event.matches;
    request("motion-preference");
  };
  motion.addEventListener("change", onMotion);

  /** Reconcile agents: all of them, or only those of the given hosts. */
  let actorWorld: TownActorWorld | null = null;
  const syncActors = (instant: boolean, hosts?: ReadonlySet<string>) => {
    if (!layout || !model) return;
    actorWorld = townActorWorld(layout, model, actorWorld);
    stats.navigationsBuilt += actorWorld.built.size;
    layoutCells = new Map(actorWorld.cells);
    actors.sync(
      actorWorld,
      instant || camera.reducedMotion,
      state.summonedKeys,
      state.askingKeys ?? new Set(),
      hosts,
      state.awayKeys ?? new Set(),
      state.heldKeys ?? new Set(),
      state.arrivingKeys ?? new Set(),
    );
    stats.actorsReconciled += actors.reconciled;
    for (const hostKey of hosts ?? actorWorld.buildings.keys())
      stats.hostSyncs[hostKey] = (stats.hostSyncs[hostKey] ?? 0) + 1;
    stats.summoned = [...state.summonedKeys].filter(
      (key) => actors.actors.get(key)?.goal?.kind === "seat",
    );
    stats.held = [...(state.heldKeys ?? [])].filter(
      (key) => actors.actors.get(key)?.goal?.kind === "seat",
    );
  };

  /* ---------- drag and move effects ---------- */
  const podOf = (deskKey: string) =>
    topology.buildings
      .flatMap((b) => b.pods)
      .find((pod) => pod.deskKey === deskKey);
  const dragEffects = createTownDragEffects({
    app,
    camera,
    sprites,
    actors,
    dragLayer,
    puffLayer,
    stats,
    model: () => model,
    layout: () => layout,
    state: () => state,
    layoutCells: () => layoutCells,
    podOf,
    buildingOf: (hostKey) => buildingByHost.get(hostKey)?.container,
    roofAlpha: (hostKey) => buildingByHost.get(hostKey)?.roofAlpha ?? 0,
    deskColor,
    lookOf,
    clock: () => clock,
    request,
  });
  const { beginDrag, moveDrag, endDrag, finishMove } = dragEffects;

  return {
    beginDrag,
    moveDrag,
    endDrag,
    finishMove,
    beginGlide: dragEffects.beginGlide,
    finishGlide: dragEffects.finishGlide,
    camera,
    get level() {
      return level;
    },
    apply({
      model: nextModel,
      layout: nextLayout,
      state: nextState,
      dirty,
      bakeKeys: nextKeys,
    }) {
      model = nextModel;
      layout = nextLayout;
      state = nextState;
      topology.setKeys(nextKeys);
      camera.calm = nextState.calm;
      // Bake again only what changed: the ground when the town's size or a
      // building's rectangle changed, and the changed, new and gone
      // buildings. What was drawn stays until its replacement is drawn in
      // the next frame, then glides or fades (townTransition.ts); carried
      // desks and rooms land in place.
      const { bake } = dirty;
      const instant =
        dirty.first || camera.reducedMotion || dragEffects.active();
      if (bake.scene) {
        topology.startGround(instant);
        stats.sceneRenders += 1;
      }
      for (const hostKey of bake.removed)
        topology.removeBuilding(hostKey, instant);
      for (const hostKey of bake.buildings) {
        topology.replaceBuilding(hostKey, instant);
        if (!dirty.first) stats.buildingBakes += 1;
      }
      if (bake.scene || bake.removed.size || bake.buildings.size) {
        recordLayout();
        if (!dirty.first) topologyPending = true;
      }
      binnedDesks.sync(nextLayout, nextModel, nextState.awayKeys ?? new Set());
      // Agents of unchanged hosts keep their goals and paths; every sync
      // still takes the new model and layout.
      if (dirty.scene || dirty.actors.size)
        syncActors(dirty.first, dirty.first ? undefined : dirty.actors);
      if (dirty.scene) {
        dimDirty = true;
        request("scene");
      } else request("scene-state");
    },
    setViewport(viewport) {
      app.renderer.resize(
        Math.max(1, viewport.width),
        Math.max(1, viewport.height),
      );
      camera.viewport = viewport;
      if (layout) camera.configure(layout, viewport);
      request("viewport");
    },
    invalidate(reason = "input") {
      request(reason);
    },
    actorPosition(key) {
      const actor: TownActor | undefined = actors.actors.get(key);
      // An agent out of the front door (in the bin) is drawn by the bus layer.
      return actor && actor.mode !== "out"
        ? { x: actor.x, y: actor.y, seated: actor.mode === "seat" }
        : null;
    },
    roofAlpha(hostKey) {
      return topology.byHost.get(hostKey)?.roofAlpha ?? 0;
    },
    buildingMotion: topology.motion,
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAmbient();
      dragEffects.clear();
      motion.removeEventListener("change", onMotion);
      frames?.dispose();
      topology.clear();
      agentViews.dispose();
      app.destroy(true, { children: true, texture: false });
      stats.destroys += 1;
      stats.activeApplications = Math.max(0, stats.activeApplications - 1);
      stats.activeTickers = Math.max(0, stats.activeTickers - 1);
      if (stats.activeApplications === 0) stats.ready = false;
    },
  };
}
