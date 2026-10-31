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

import {
  Application,
  CanvasSource,
  Container,
  Graphics,
  Sprite,
  Texture,
} from "pixi.js";
import type { OfficeAgent, OfficeDesk } from "../herdrOfficeProjection";
import {
  worldMotionPreference,
  type WorldFrames,
} from "../worldFrameScheduler";
import { registerTownFrames } from "./townFrameLifecycle";
import { createTownDragEffects } from "./townRendererDrag";
import { createTownActorViews } from "./townRendererActors";
import {
  bakeTownBuilding,
  bakeTownPod,
  textureOf,
  townOutdoor,
  type BuildingView,
  type PodView,
} from "./townRendererScene";
import {
  townBakeDirty,
  townBakeKeys,
  type TownBakeKeys,
} from "./scene/townSceneBake";
import { diagnostics, type TownFrameTrace } from "./townDiagnostics";
export type { TownFrameTrace } from "./townDiagnostics";
import { DEVTOOLS } from "../devtools/flag";

import { TownActors, townActorWorld, type TownActor } from "./townActors";
import type { TownMoveResult } from "./townMoves";
import {
  TownCamera,
  townBlend,
  townLevel,
  type TownLevel,
  type TownViewport,
} from "./townCamera";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  townGeometryKey,
  type TownCell,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import type { TerminalColor } from "../terminalColor";
import { createTownLookResolver } from "./townAppearance";
import {
  paintTownGround,
  townChosenCarpet,
  townHostTheme,
  type TownHostTheme,
} from "./townPaint";
import {
  buildTownSprites,
  townCharacter,
  townHash,
  type TownCanvas,
} from "./townSprites";

export type { TownRendererDiagnostics } from "./townDiagnostics";

export type TownSceneState = {
  selectedKey: string | null;
  hoverKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
  /** Agents the user opened, who walk back to their desks. */
  summonedKeys: ReadonlySet<string>;
  askingKeys?: ReadonlySet<string>;
  /** Building currently held open (for example while moving a desk). */
  openHostKey: string | null;
  calm: boolean;
};

export type TownRendererHandle = {
  camera: TownCamera;
  readonly level: TownLevel;
  setScene(model: TownModel, layout: TownLayout, state: TownSceneState): void;
  setState(state: TownSceneState): void;
  setViewport(viewport: TownViewport): void;
  /** Ask for a redraw after camera input; the reason is traced. */
  invalidate(reason?: string): void;
  actorPosition(key: string): { x: number; y: number; seated: boolean } | null;
  roofAlpha(hostKey: string): number;
  /** Lift a desk or agent under the pointer for a drag. */
  beginDrag(kind: "desk" | "agent", key: string, x: number, y: number): void;
  /** Follow the pointer (world point) and show where it would land. */
  /** `snap`: the target is a desk the carried desk groups with. */
  moveDrag(
    x: number,
    y: number,
    targetKey: string | null,
    snap?: boolean,
  ): void;
  /** Spring back to its spot, or wait at the target while Herdr moves it. */
  endDrag(mode: "cancel" | "park"): void;
  /** Land on the target with a puff, spring home, or fade when uncertain. */
  finishMove(result: TownMoveResult): void;
  destroy(): void;
};

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
  const groundLayer = new Container();
  const sceneLayer = new Container();
  sceneLayer.sortableChildren = true;
  const fxLayer = new Graphics();
  const screenLayer = new Container();
  // Drag effects sit above the scene and survive a scene rebuild.
  const dragLayer = new Container();
  const puffLayer = new Graphics();
  world.addChild(groundLayer, sceneLayer, fxLayer, dragLayer, puffLayer);
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
  let buildings: BuildingView[] = [];
  let ownedTextures: Texture[] = [];
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

  const outdoor = new Container();
  outdoor.sortableChildren = true;

  const clearScene = () => {
    for (const view of buildings) {
      view.container.destroy({ children: true });
      for (const texture of view.textures) texture.destroy(true);
    }
    buildings = [];
    buildingByHost.clear();
    groundLayer.removeChildren().forEach((child) => child.destroy());
    outdoor.removeChildren().forEach((child) => child.destroy());
    for (const texture of ownedTextures) texture.destroy(true);
    ownedTextures = [];
  };

  /** A texture for a painted canvas; the scene's own unless a building's. */
  const own = (canvas: TownCanvas, scene = true) => {
    const texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    if (scene) ownedTextures.push(texture);
    return texture;
  };

  const themeFor = (hostKey: string): TownHostTheme =>
    townHostTheme(
      hostKey,
      model?.hosts.get(hostKey)?.deterministicSkin.themeIndex,
      model?.placeColors.hosts.get(hostKey),
    );
  const carpetFor = (roomKey: string) =>
    townChosenCarpet(model?.placeColors.rooms.get(roomKey));

  const buildScene = () => {
    if (!layout || !model) return;
    clearScene();
    groundChunks.clear();
    pendingPods.clear();
    sceneLayer.addChild(outdoor);
    outdoor.zIndex = -1;
    // Trees, lamps and benches join the scene with the ground chunk under them.
    outdoorItems = townOutdoor(layout, sprites, outdoor);

    pendingBuildings = [...layout.buildings];
    recordLayout();
    agentViews.drop();
  };

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

  /** Walking agents' sprites live in their buildings; they return next frame. */
  /** Bake one building's textures and retained sprites the first time it is needed. */
  const buildBuilding = (building: TownLayout["buildings"][number]) => {
    if (!layout || !model) return;
    const textures: Texture[] = [];
    const { view, pendingCells } = bakeTownBuilding(building, {
      theme: themeFor(building.hostKey),
      stale: model.hosts.get(building.hostKey)?.stale ?? false,
      sprites,
      colorFor: deskColor,
      carpetFor,
      own: (canvas) => {
        const texture = own(canvas, false);
        textures.push(texture);
        return texture;
      },
      textures,
      roofAlpha: camera.z >= (camera.limits?.roof ?? 0) ? 0 : 1,
    });
    pendingPods.set(building.hostKey, pendingCells);
    sceneLayer.addChild(view.container);
    buildings.push(view);
    buildingByHost.set(building.hostKey, view);
    dimDirty = true;
  };

  /** Bake one building again (its colours or desks changed); the rest stay. */
  const rebakeBuilding = (hostKey: string) => {
    const view = buildingByHost.get(hostKey);
    if (view) {
      view.container.destroy({ children: true });
      for (const texture of view.textures) texture.destroy(true);
      buildings = buildings.filter((entry) => entry !== view);
      buildingByHost.delete(hostKey);
    }
    pendingPods.delete(hostKey);
    const building = layout?.buildings.find((b) => b.hostKey === hostKey);
    pendingBuildings = pendingBuildings.filter((b) => b.hostKey !== hostKey);
    if (building) pendingBuildings.push(building);
    agentViews.drop(hostKey);
    stats.buildingBakes += 1;
  };

  const GROUND_CHUNK = 512;
  /** Below this zoom the baked tables suffice and desk sprites stay hidden. */
  // Seated people appear at the same zoom as walking and lounging agents.
  const DETAIL_ZOOM = 0.35;
  const pendingPods = new Map<string, TownCell[]>();
  let outdoorItems: { x: number; y: number; place: () => void }[] = [];
  const buildingByHost = new Map<string, BuildingView>();
  const groundChunks = new Map<string, Sprite>();
  let pendingBuildings: TownLayout["buildings"] = [];
  let dimDirty = true;

  /** Paint visible ground chunks and bake visible buildings, a few per frame. */
  const MATERIALIZE_BUDGET_MS = 5;
  const materialize = () => {
    if (!layout) return false;
    const began = performance.now();
    const spent = () => performance.now() - began >= MATERIALIZE_BUDGET_MS;
    const left = camera.toWorld(-200, -200);
    const right = camera.toWorld(
      camera.viewport.width + 200,
      camera.viewport.height + 200,
    );
    let budget = 1;
    const cx0 = Math.max(0, Math.floor(left.x / GROUND_CHUNK));
    const cy0 = Math.max(0, Math.floor(left.y / GROUND_CHUNK));
    const cx1 = Math.min(
      Math.ceil((layout.width * T) / GROUND_CHUNK),
      Math.ceil(right.x / GROUND_CHUNK),
    );
    const cy1 = Math.min(
      Math.ceil((layout.height * T) / GROUND_CHUNK),
      Math.ceil(right.y / GROUND_CHUNK),
    );
    for (let cy = cy0; cy < cy1 && budget > 0; cy += 1)
      for (let cx = cx0; cx < cx1 && budget > 0; cx += 1) {
        const key = `${cx},${cy}`;
        if (groundChunks.has(key)) continue;
        const region = {
          x: cx * GROUND_CHUNK,
          y: cy * GROUND_CHUNK,
          w: Math.min(GROUND_CHUNK, layout.width * T - cx * GROUND_CHUNK),
          h: Math.min(GROUND_CHUNK, layout.height * T - cy * GROUND_CHUNK),
        };
        const sprite = new Sprite(own(paintTownGround(layout, region)));
        sprite.position.set(region.x, region.y);
        groundLayer.addChild(sprite);
        groundChunks.set(key, sprite);
        outdoorItems = outdoorItems.filter((item) => {
          const inside =
            item.x >= region.x &&
            item.x < region.x + region.w &&
            item.y >= region.y &&
            item.y < region.y + region.h;
          if (inside) item.place();
          return !inside;
        });
        budget -= 1;
      }
    let buildingBudget = spent() ? 0 : 1;
    pendingBuildings = pendingBuildings.filter((building) => {
      if (buildingBudget <= 0) return true;
      const visible =
        building.x * T < right.x &&
        (building.x + building.w) * T > left.x &&
        (building.y - 1) * T < right.y &&
        (building.y + building.h + TOWN_FACADE) * T > left.y;
      if (!visible) return true;
      buildBuilding(building);
      buildingBudget -= 1;
      return false;
    });
    let podsPending = false;
    if (camera.z >= DETAIL_ZOOM)
      for (const view of buildings) {
        const cells = pendingPods.get(view.hostKey);
        if (!cells?.length || !view.container.visible) continue;
        const remaining: TownCell[] = [];
        for (const cell of cells) {
          const X = (cell.x + 1) * T;
          const Y = cell.y * T;
          const visible =
            X - 20 < right.x &&
            X + 84 > left.x &&
            Y - 20 < right.y &&
            Y + 70 > left.y;
          if (!visible || spent()) {
            remaining.push(cell);
            if (visible) podsPending = true;
            continue;
          }
          view.pods.push(buildPod(cell, view.dynamic));
        }
        pendingPods.set(view.hostKey, remaining);
      }
    if (dimDirty) {
      dimDirty = false;
      updateDim();
    }
    return budget <= 0 || buildingBudget <= 0 || podsPending;
  };

  const buildPod = (cell: TownCell, parent: Container): PodView =>
    bakeTownPod(cell, parent, {
      desk: model!.desks.get(cell.deskKey!) as OfficeDesk,
      wood: deskColor(cell.deskKey!),
      pinned: model!.deskPins.has(cell.deskKey!),
      sprites,
    });

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
    agent.semanticStatus === "idle" || agent.semanticStatus === "unknown";

  const updatePods = (deskBlend: number, glow: boolean, lite: boolean) => {
    const frame = Math.floor(clock * 6);
    // The same fade as standing and walking agents (updateActors).
    const peopleBlend = Math.max(deskBlend, townBlend(0.35, 0.6, camera.z));
    for (const building of buildings)
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
            person.texture = textureOf(
              townCharacter(
                lookOf(info.agent.key),
                top ? "down" : "up",
                typing,
                "sit",
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
    for (const building of buildings) {
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
    for (const view of buildings) {
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

  const cull = () => {
    if (!layout) return;
    const left = camera.toWorld(-80, -80);
    const right = camera.toWorld(
      camera.viewport.width + 80,
      camera.viewport.height + 120,
    );
    for (const view of buildings) {
      const building = layout.buildings.find(
        (b) => b.hostKey === view.hostKey,
      )!;
      const visible =
        building.x * T < right.x &&
        (building.x + building.w) * T > left.x &&
        (building.y - 1) * T < right.y &&
        (building.y + building.h + TOWN_FACADE) * T > left.y;
      view.container.visible = visible;
      if (!visible) continue;
      const detailed = camera.z >= DETAIL_ZOOM;
      for (const pod of view.pods) {
        const X = (pod.cell.x + 1) * T;
        const Y = pod.cell.y * T;
        pod.container.visible =
          detailed &&
          X - 20 < right.x &&
          X + 84 > left.x &&
          Y - 20 < right.y &&
          Y + 70 > left.y;
      }
    }
  };

  let frames: WorldFrames | null = null;
  // An error in one frame is reported and never stops later frames (nor,
  // through the shared scheduler, other views' frames).
  // A state frame and, in development builds, why it was wanted.
  const frameReasons = new Set<string>();
  let lastTraced = "";
  const request = (reason: string) => {
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
    const actorsMoved = actors.step(camera.reducedMotion ? 10 : dt);
    const limits = camera.limits!;
    level = townLevel(camera.z, limits);
    const deskBlend = townBlend(limits.desk * 0.82, limits.desk, camera.z);
    const lite = camera.z < 0.55;
    world.scale.set(camera.z);
    world.position.set(
      Math.round(camera.viewport.width / 2 - camera.x * camera.z),
      Math.round(camera.viewport.height / 2 - camera.y * camera.z),
    );
    const materializing = materialize();
    const roofsMoving = updateRoofs(dt);
    cull();
    updatePods(deskBlend, camera.z >= 0.6, lite);
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
    app.renderer.render(app.stage);
    stats.level = level;
    stats.zoom = camera.z;
    stats.flying = camera.flying;
    stats.actors = actors.actors.size;
    stats.walking = [...actors.actors.values()].filter(
      (a) => a.mode === "walk",
    ).length;
    stats.animation = {
      characters: actors.actors.size,
      monitors: buildings.reduce(
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
      dragging;
    const next = moving
      ? "state"
      : !camera.reducedMotion && !state.calm && ambient.next === clock
        ? "motion"
        : null;
    if (next) frames?.request(next);
    else if (
      !camera.reducedMotion &&
      !state.calm &&
      Number.isFinite(ambient.next)
    )
      ambientTimer = setTimeout(
        () => {
          ambientTimer = null;
          frames?.request("motion");
        },
        Math.max(1, (ambient.next - clock) * 1000 - 16),
      );
    if (DEVTOOLS && onTrace) {
      const causes = Object.entries({
        camera: cameraMoved,
        roofs: roofsMoving,
        actors: actorsMoved,
        flight: camera.flying,
        materialize: materializing,
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

  const syncActors = (instant: boolean) => {
    if (!layout || !model) return;
    const actorWorld = townActorWorld(layout, model);
    layoutCells = new Map(actorWorld.cells);
    actors.sync(
      actorWorld,
      instant || camera.reducedMotion,
      state.summonedKeys,
      state.askingKeys ?? new Set(),
    );
    stats.summoned = [...state.summonedKeys].filter(
      (key) => actors.actors.get(key)?.goal?.kind === "seat",
    );
  };

  /* ---------- drag and move effects ---------- */
  const podOf = (deskKey: string) =>
    buildings.flatMap((b) => b.pods).find((pod) => pod.deskKey === deskKey);
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
    deskColor,
    lookOf,
    clock: () => clock,
    request,
  });
  const { beginDrag, moveDrag, endDrag, finishMove } = dragEffects;

  let bakeKeys: TownBakeKeys | null = null;
  return {
    beginDrag,
    moveDrag,
    endDrag,
    finishMove,
    camera,
    get level() {
      return level;
    },
    setScene(nextModel, nextLayout, nextState) {
      const layoutChanged = nextLayout !== layout;
      // Tables, carpets and roofs are baked with their colours (and tables
      // with their pins), so a new colour, pin or host state may bake again.
      const colorsChanged =
        nextModel.deskColors !== model?.deskColors ||
        nextModel.placeColors !== model?.placeColors ||
        nextModel.deskPins !== model?.deskPins ||
        // Roofs show a host's theme and whether it is stale.
        nextModel.hosts !== model?.hosts;
      const first = !layout;
      model = nextModel;
      layout = nextLayout;
      state = nextState;
      camera.calm = nextState.calm;
      if (!layoutChanged && !colorsChanged) {
        syncActors(first);
        dimDirty = true;
        request("scene");
        return;
      }
      // Bake again only what changed: the whole scene when the town's size
      // or a building's rectangle changed, else just the changed buildings.
      const keys = townBakeKeys(nextModel, nextLayout);
      const dirty = townBakeDirty(bakeKeys, keys);
      bakeKeys = keys;
      if (dirty.scene) {
        buildScene();
        stats.sceneRenders += 1;
      } else if (dirty.buildings.size) {
        for (const hostKey of dirty.buildings) rebakeBuilding(hostKey);
        recordLayout();
      }
      syncActors(first);
      dimDirty = true;
      request("scene");
    },
    setState(nextState) {
      const summonedChanged =
        nextState.summonedKeys !== state.summonedKeys ||
        nextState.askingKeys !== state.askingKeys;
      state = nextState;
      camera.calm = nextState.calm;
      if (summonedChanged) syncActors(false);
      request("scene-state");
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
      return actor
        ? { x: actor.x, y: actor.y, seated: actor.mode === "seat" }
        : null;
    },
    roofAlpha(hostKey) {
      return buildings.find((b) => b.hostKey === hostKey)?.roofAlpha ?? 0;
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      cancelAmbient();
      dragEffects.clear();
      motion.removeEventListener("change", onMotion);
      frames?.dispose();
      clearScene();
      agentViews.dispose();
      app.destroy(true, { children: true, texture: false });
      stats.destroys += 1;
      stats.activeApplications = Math.max(0, stats.activeApplications - 1);
      stats.activeTickers = Math.max(0, stats.activeTickers - 1);
      if (stats.activeApplications === 0) stats.ready = false;
    },
  };
}
