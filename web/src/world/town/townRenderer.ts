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
  registerWorldFrames,
  worldMotionPreference,
  type WorldFrames,
} from "../worldFrameScheduler";
import { worldRendererCountersEnabled } from "../worldRendererDebug";
import { TownActors, townActorWorld, type TownActor } from "./townActors";
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
  townDeskSlots,
  townDeskTable,
  townSeat,
  type TownCell,
  type TownLayout,
} from "./townLayout";
import type { TownModel } from "./townModel";
import {
  paintTownFacade,
  paintTownGround,
  paintTownInterior,
  paintTownRoof,
  TOWN_HOST_THEMES,
  type TownHostTheme,
} from "./townPaint";
import {
  buildTownSprites,
  townCanvas,
  townCharacter,
  townHash,
  townLookFor,
  townScreen,
  TOWN_WOODS,
  type TownCanvas,
  type TownLook,
} from "./townSprites";

export type TownRendererDiagnostics = {
  mounts: number;
  destroys: number;
  activeApplications: number;
  activeTickers: number;
  frames: number;
  sceneRenders: number;
  ready: boolean;
  reducedMotion: boolean;
  interactionPaused: boolean;
  lastError: string | null;
  level: TownLevel | null;
  zoom: number;
  actors: number;
  walking: number;
  desks: number;
  /** Animated node counts, kept compatible with existing browser evidence. */
  animation: { characters: number; monitors: number; statuses: number };
  layout: null | {
    width: number;
    height: number;
    buildings: number;
    rooms: number;
  };
};

declare global {
  interface Window {
    __HERDR_WORLD_FORCE_RENDERER_FAILURE__?: boolean;
    __HERDR_TOWN_RENDERER__?: TownRendererDiagnostics;
  }
}

function diagnostics(): TownRendererDiagnostics {
  const enabled = worldRendererCountersEnabled();
  if (enabled && window.__HERDR_TOWN_RENDERER__)
    return window.__HERDR_TOWN_RENDERER__;
  const value: TownRendererDiagnostics = {
    mounts: 0,
    destroys: 0,
    activeApplications: 0,
    activeTickers: 0,
    frames: 0,
    sceneRenders: 0,
    ready: false,
    reducedMotion: false,
    interactionPaused: false,
    lastError: null,
    level: null,
    zoom: 1,
    actors: 0,
    walking: 0,
    desks: 0,
    animation: { characters: 0, monitors: 0, statuses: 0 },
    layout: null,
  };
  if (enabled) window.__HERDR_TOWN_RENDERER__ = value;
  return value;
}

export type TownSceneState = {
  selectedKey: string | null;
  hoverKey: string | null;
  completionSeenKeys: ReadonlySet<string>;
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
  /** Ask for a redraw after camera input. */
  invalidate(): void;
  actorPosition(key: string): { x: number; y: number; seated: boolean } | null;
  roofAlpha(hostKey: string): number;
  /** Lift a desk or agent under the pointer for a drag. */
  beginDrag(kind: "desk" | "agent", key: string, x: number, y: number): void;
  /** Follow the pointer (world point) and show where it would land. */
  moveDrag(x: number, y: number, targetKey: string | null): void;
  /** Spring back to its spot, or wait at the target while Herdr moves it. */
  endDrag(mode: "cancel" | "park"): void;
  /** The move finished: land with a puff, or spring back on failure. */
  finishMove(moved: boolean): void;
  destroy(): void;
};

const BLOCK_COLORS: Record<string, number> = {
  working: 0x6fc3ff,
  blocked: 0xffb547,
  done: 0x7be08f,
  shell: 0x7fbf7a,
};

const textureCache = new WeakMap<TownCanvas, Texture>();
function textureOf(canvas: TownCanvas) {
  let texture = textureCache.get(canvas);
  if (!texture) {
    texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    textureCache.set(canvas, texture);
  }
  return texture;
}

let glowCanvas: TownCanvas | null = null;
function glowTexture() {
  if (!glowCanvas) {
    const [canvas, g] = townCanvas(64, 64);
    const gradient = g.createRadialGradient(32, 32, 1, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    glowCanvas = canvas;
  }
  return textureOf(glowCanvas);
}

const kindOf = (agent: OfficeAgent) => {
  const label =
    `${agent.displayLabel} ${agent.taskSummary ?? ""}`.toLowerCase();
  return label.includes("codex")
    ? "codex"
    : label.includes("gemini")
      ? "gemini"
      : "claude";
};

/** One seat's sprites: a top seat has a person and laptop lid, a bottom seat a screen and back. */
type SeatView = {
  top: boolean;
  person: Sprite;
  device: Sprite;
  glow: Sprite;
  /** Finished work left at the seat until the user checks it. */
  papers: Sprite;
};

type PodView = {
  container: Container;
  deskKey: string;
  seats: SeatView[];
  item: Sprite | null;
  cell: TownCell;
};

type BuildingView = {
  hostKey: string;
  container: Container;
  interior: Sprite;
  dim: Graphics;
  dynamic: Container;
  facade: Sprite;
  stub: Sprite;
  roof: Sprite;
  roofAlpha: number;
  pods: PodView[];
  textures: Texture[];
};

type ActorView = { sprite: Sprite; shadow: Graphics; look: TownLook };

/** Yield to the browser so pending input runs before the next setup step. */
export const nextTownTask = () =>
  new Promise<void>((resolve) => window.setTimeout(resolve, 0));

export async function createTownRenderer(
  element: HTMLElement,
  onFrame: (camera: TownCamera, level: TownLevel) => void,
  signal?: AbortSignal,
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
  const camera = new TownCamera();
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
  let layout: TownLayout | null = null;
  let state: TownSceneState = {
    selectedKey: null,
    hoverKey: null,
    completionSeenKeys: new Set(),
    openHostKey: null,
    calm: false,
  };
  let buildings: BuildingView[] = [];
  const actorViews = new Map<string, ActorView>();
  const bubbles = new Map<string, Sprite>();
  let ownedTextures: Texture[] = [];
  let level: TownLevel = "overview";
  let disposed = false;
  let last = 0;
  let clock = 0;

  const outdoor = new Container();
  outdoor.sortableChildren = true;

  const clearScene = () => {
    for (const view of buildings) view.container.destroy({ children: true });
    buildings = [];
    buildingByHost.clear();
    groundLayer.removeChildren().forEach((child) => child.destroy());
    outdoor.removeChildren().forEach((child) => child.destroy());
    for (const texture of ownedTextures) texture.destroy(true);
    ownedTextures = [];
  };

  const own = (canvas: TownCanvas) => {
    const texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    ownedTextures.push(texture);
    return texture;
  };

  const themeFor = (hostKey: string): TownHostTheme => {
    const host = model?.hosts.get(hostKey);
    return TOWN_HOST_THEMES[
      (host?.deterministicSkin.themeIndex ?? townHash(hostKey)) %
        TOWN_HOST_THEMES.length
    ]!;
  };

  const buildScene = () => {
    if (!layout || !model) return;
    clearScene();
    groundChunks.clear();
    pendingPods.clear();
    sceneLayer.addChild(outdoor);
    outdoor.zIndex = -1;
    const add = (canvas: TownCanvas, x: number, y: number, z: number) => {
      const sprite = new Sprite(textureOf(canvas));
      sprite.position.set(x, y);
      sprite.zIndex = z;
      outdoor.addChild(sprite);
      return sprite;
    };
    // Trees, lamps and benches join the scene with the ground chunk under them.
    outdoorItems = [];
    for (const tree of layout.trees)
      outdoorItems.push({
        x: tree.x * T,
        y: tree.y * T,
        place: () => {
          const sprite = add(
            sprites.trees[tree.variant]!,
            tree.x * T + 8,
            tree.y * T + 14,
            tree.y * T + 14,
          );
          sprite.anchor.set(17 / 34, 43 / 44);
        },
      });
    for (const lamp of layout.lamps)
      outdoorItems.push({
        x: lamp.x * T,
        y: lamp.y * T,
        place: () =>
          add(sprites.lamp, lamp.x * T + 5, lamp.y * T - 22, lamp.y * T + 8),
      });
    for (const bush of layout.bushes)
      outdoorItems.push({
        x: bush.x * T,
        y: bush.y * T,
        place: () =>
          add(sprites.bush, bush.x * T - 2, bush.y * T + 2, bush.y * T + 13),
      });
    for (const bench of layout.benches)
      outdoorItems.push({
        x: bench.x * T,
        y: bench.y * T,
        place: () =>
          add(sprites.bench, bench.x * T, bench.y * T + 2, bench.y * T + 12),
      });
    outdoorItems.push({
      x: layout.board.x * T,
      y: layout.board.y * T,
      place: () =>
        add(
          sprites.board,
          layout!.board.x * T - 8,
          layout!.board.y * T - 16,
          layout!.board.y * T + 14,
        ),
    });
    const fountain = new Graphics();
    const fx = layout.plaza.x * T + 8;
    const fy = layout.plaza.y * T + 4;
    fountain
      .ellipse(fx + 2, fy + 6, 26, 12)
      .fill({ color: 0x000000, alpha: 0.18 })
      .ellipse(fx, fy + 2, 25, 11)
      .fill(0x9d978c)
      .ellipse(fx, fy, 25, 11)
      .fill(0xb9b2a5)
      .ellipse(fx, fy, 20, 8)
      .fill(0x4f9fd3)
      .ellipse(fx, fy - 1, 15, 5)
      .fill(0x6fb9e6)
      .rect(fx - 3, fy - 14, 6, 14)
      .fill(0x9d978c)
      .rect(fx - 5, fy - 16, 10, 3)
      .fill(0xb9b2a5);
    fountain.zIndex = fy + 12;
    outdoor.addChild(fountain);

    pendingBuildings = [...layout.buildings];
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
    };
    for (const view of actorViews.values()) {
      view.sprite.destroy();
      view.shadow.destroy();
    }
    actorViews.clear();
  };

  /** Bake one building's textures and retained sprites the first time it is needed. */
  const buildBuilding = (building: TownLayout["buildings"][number]) => {
    if (!layout || !model) return;
    {
      const theme = themeFor(building.hostKey);
      const stale = model.hosts.get(building.hostKey)?.stale ?? false;
      const container = new Container();
      container.zIndex = (building.y + building.h) * T + 4;
      const interior = new Sprite(
        own(
          paintTownInterior(building, theme, {
            table: sprites.table,
            tableSmall: sprites.tableSmall,
            chair: sprites.chair,
            chairBack: sprites.chairBack,
            woodFor: (deskKey) =>
              TOWN_WOODS[townHash(deskKey) % TOWN_WOODS.length]!,
          }),
        ),
      );
      interior.position.set(building.x * T, building.y * T);
      const dim = new Graphics();
      const dynamic = new Container();
      dynamic.sortableChildren = true;
      const facadeCanvas = paintTownFacade(building, theme);
      const facade = new Sprite(own(facadeCanvas));
      facade.position.set(building.x * T, (building.y + building.h) * T);
      const [stubCanvas, stubContext] = townCanvas(facadeCanvas.width, 9);
      stubContext.drawImage(facadeCanvas, 0, -23);
      const stub = new Sprite(own(stubCanvas));
      stub.position.set(building.x * T, (building.y + building.h) * T);
      const roof = new Sprite(own(paintTownRoof(building, theme, stale)));
      roof.position.set(building.x * T - 4, building.y * T - 12);
      container.addChild(interior, dynamic, dim, stub, facade, roof);

      for (const plant of building.plants) {
        const sprite = new Sprite(textureOf(sprites.plant));
        sprite.position.set(plant.x * T, (plant.y + 1) * T - 24);
        sprite.zIndex = (plant.y + 1) * T - 2;
        dynamic.addChild(sprite);
      }
      const L = building.lounge;
      for (const [canvas, x, y] of [
        [sprites.sofa, (L.x + 1) * T - 1, (L.y + 1) * T - 8],
        [sprites.coffee, (L.x + 7) * T + 1, (L.y + 1) * T - 10],
        [sprites.cooler, (L.x + 8) * T + 2, (L.y + 1) * T - 12],
      ] as const) {
        const sprite = new Sprite(textureOf(canvas));
        sprite.position.set(x, y);
        sprite.zIndex = (L.y + 2) * T - 2;
        dynamic.addChild(sprite);
      }
      const counterX = building.doorX * T;
      const counterY = (building.counter.y + 1) * T - 8;
      const me = new Sprite(
        textureOf(townCharacter(townLookFor("you"), "down", 0, "sit", false)),
      );
      me.position.set(counterX - 7, counterY - 11);
      const meChair = new Sprite(textureOf(sprites.chair));
      meChair.position.set(counterX - 7, counterY - 14);
      const counter = new Sprite(textureOf(sprites.counter));
      counter.position.set(counterX - 41, counterY);
      const counterLid = new Sprite(textureOf(sprites.lid.claude!));
      counterLid.position.set(counterX - 23, counterY - 4);
      const reception = new Container();
      reception.addChild(meChair, me, counter, counterLid);
      reception.zIndex = (building.counter.y + 3) * T - 2;
      dynamic.addChild(reception);

      // Tables and chairs are baked into the interior; the detailed desk
      // sprites (people, screens, glow) are created on demand from the room level.
      const pods: PodView[] = [];
      const pendingCells: TownCell[] = [];
      for (const room of building.rooms)
        for (const cell of room.cells)
          if (cell.deskKey) pendingCells.push(cell);
      pendingPods.set(building.hostKey, pendingCells);
      sceneLayer.addChild(container);
      buildings.push({
        hostKey: building.hostKey,
        container,
        interior,
        dim,
        dynamic,
        facade,
        stub,
        roof,
        roofAlpha: camera.z >= (camera.limits?.roof ?? 0) ? 0 : 1,
        pods,
        textures: [],
      });
      buildingByHost.set(building.hostKey, buildings[buildings.length - 1]!);
      dimDirty = true;
    }
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

  const buildPod = (cell: TownCell, parent: Container): PodView => {
    const desk = model!.desks.get(cell.deskKey!) as OfficeDesk;
    const container = new Container();
    const X = (cell.x + 1) * T;
    const Y = cell.y * T;
    container.zIndex = Y + 52;
    const wood = TOWN_WOODS[townHash(desk.key) % TOWN_WOODS.length]!;
    const make = (canvas: TownCanvas | null, x: number, y: number) => {
      const sprite = new Sprite(canvas ? textureOf(canvas) : Texture.EMPTY);
      sprite.position.set(x, y);
      container.addChild(sprite);
      return sprite;
    };
    const glow = (x: number, y: number, size: number) => {
      const sprite = new Sprite(glowTexture());
      sprite.anchor.set(0.5);
      sprite.position.set(x, y);
      sprite.width = sprite.height = size;
      sprite.blendMode = "add";
      sprite.visible = false;
      return sprite;
    };
    const place = townDeskTable(cell.seats);
    const shadow = new Graphics()
      .rect(X + place.x + 4, Y + 50, place.w - 2, 4)
      .fill({ color: 0x000000, alpha: 0.2 });
    container.addChild(shadow);
    const slots = townDeskSlots(cell.seats);
    // Layered back to front: top chairs and people, the table, then laptops,
    // screens, the people seen from behind and their chair backs.
    for (const slot of slots)
      if (slot.top) make(sprites.chair, X + slot.chairX, Y + 2);
    const people = slots.map((slot) =>
      slot.top ? make(null, X + slot.chairX, Y + 5) : null,
    );
    make(
      (cell.seats <= 2 ? sprites.tableSmall : sprites.table)[wood]!,
      X + place.x,
      Y + 17,
    );
    const devices = slots.map((slot) =>
      make(
        slot.top ? sprites.lidOff : null,
        X + slot.chairX,
        slot.top ? Y + 13 : Y + 26,
      ),
    );
    const itemIndex = townHash(`${desk.key}:item`) % 4;
    const itemX = X + (cell.seats <= 2 ? 41 : 29);
    const item =
      itemIndex === 0
        ? make(sprites.mug, itemX + 1, Y + 22)
        : itemIndex === 1
          ? make(sprites.cactus, itemX, Y + 19)
          : null;
    const glows = slots.map((slot) =>
      slot.top
        ? glow(X + slot.chairX + 7, Y + 12, 38)
        : glow(X + slot.chairX + 7, Y + 30, 30),
    );
    for (const sprite of glows) container.addChild(sprite);
    // Beside the laptop or screen, on the table top.
    const papers = slots.map((slot) => {
      const sprite = make(
        sprites.papers,
        X + slot.chairX + 14,
        slot.top ? Y + 18 : Y + 28,
      );
      sprite.visible = false;
      return sprite;
    });
    const backs = slots.map((slot) =>
      slot.top ? null : make(null, X + slot.chairX, Y + 34),
    );
    for (const slot of slots)
      if (!slot.top) make(sprites.chairBack, X + slot.chairX, Y + 45);
    parent.addChild(container);
    return {
      container,
      deskKey: desk.key,
      seats: slots.map((slot, seat) => ({
        top: slot.top,
        person: (people[seat] ?? backs[seat])!,
        device: devices[seat]!,
        glow: glows[seat]!,
        papers: papers[seat]!,
      })),
      item,
      cell,
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

  const looks = new Map<string, TownLook>();
  const lookOf = (key: string) => {
    let look = looks.get(key);
    if (!look) looks.set(key, (look = townLookFor(key)));
    return look;
  };

  const resting = (agent: { semanticStatus: string }) =>
    agent.semanticStatus === "idle" || agent.semanticStatus === "unknown";

  const updatePods = (
    deskBlend: number,
    glow: boolean,
    lite: boolean,
    blink: (key: string) => boolean,
  ) => {
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
                top && (resting(info.agent) || blink(info.agent.key)),
              ),
            );
            person.alpha = peopleBlend;
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
          }
        });
        if (pod.item) pod.item.visible = !lite;
      }
  };

  const screenCanvases = new Map<string, TownCanvas>();
  const screenCanvas = (stateName: string, frame: number) => {
    const key = `${stateName}:${stateName === "working" ? frame % 7 : stateName === "off" ? 0 : stateName === "idle" || stateName === "unknown" ? Math.floor(frame / 6) % 36 : frame % 2}`;
    let canvasValue = screenCanvases.get(key);
    if (!canvasValue)
      screenCanvases.set(
        key,
        (canvasValue = townScreen(stateName, Number(key.split(":")[1]))),
      );
    return canvasValue;
  };

  const blinkAt = new Map<string, number>();
  const blink = (key: string) => {
    let next = blinkAt.get(key);
    if (next === undefined)
      blinkAt.set(key, (next = clock + 1 + (townHash(key) % 400) / 100));
    if (clock > next + 0.13)
      blinkAt.set(
        key,
        clock + 2 + (townHash(`${key}${Math.floor(clock)}`) % 400) / 100,
      );
    return clock > next && clock < next + 0.13;
  };

  const updateActors = (standingAlpha: number) => {
    const live = new Set<string>();
    for (const actor of actors.actors.values()) {
      if (actor.mode === "seat") continue;
      const building = buildingByHost.get(actor.hostKey);
      if (!building || !building.container.visible) continue;
      live.add(actor.key);
      let view = actorViews.get(actor.key);
      if (!view) {
        const sprite = new Sprite(Texture.EMPTY);
        const shadow = new Graphics()
          .rect(-5, -1, 10, 3)
          .fill({ color: 0x000000, alpha: 0.22 });
        building.dynamic.addChild(shadow, sprite);
        view = { sprite, shadow, look: lookOf(actor.key) };
        actorViews.set(actor.key, view);
      }
      const moving = actor.mode === "walk";
      const frame = moving ? Math.floor(actor.walked / 6) % 4 : 0;
      const bob = moving && frame % 2 ? -1 : 0;
      view.sprite.texture = textureOf(
        townCharacter(view.look, actor.dir, frame, "stand", blink(actor.key)),
      );
      view.sprite.position.set(
        Math.round(actor.x - 7),
        Math.round(actor.y - 19 + bob),
      );
      view.sprite.zIndex = actor.y;
      view.shadow.position.set(Math.round(actor.x), Math.round(actor.y));
      view.shadow.zIndex = actor.y - 0.5;
      view.sprite.alpha = view.shadow.alpha = standingAlpha;
      view.sprite.visible = view.shadow.visible = standingAlpha > 0.02;
    }
    for (const [key, view] of actorViews)
      if (!live.has(key)) {
        view.sprite.destroy();
        view.shadow.destroy();
        actorViews.delete(key);
      }
  };

  const updateBubbles = () => {
    const scale = Math.min(4, Math.max(2, Math.round(camera.z * 1.5)));
    const wanted = new Set<string>();
    if (model && level !== "town")
      for (const actor of actors.actors.values()) {
        const agent = model.agents.get(actor.key);
        if (!agent) continue;
        const status = agent.semanticStatus;
        const near = level === "room" || level === "desk";
        // Working agents chat in short bursts: a typing bubble a third of the time.
        const phase = clock * 0.35 + (townHash(actor.key) % 97) / 97;
        const chatting =
          near &&
          !state.calm &&
          !camera.reducedMotion &&
          status === "working" &&
          actor.mode === "seat" &&
          phase - Math.floor(phase) < 0.33;
        const kind =
          status === "blocked"
            ? "blocked"
            : status === "done" && !state.completionSeenKeys.has(agent.key)
              ? "done"
              : level === "desk" && status === "idle" && actor.mode === "stand"
                ? "idle"
                : near && status === "idle" && actor.mode === "seat"
                  ? "sleep"
                  : chatting
                    ? (`typing${Math.floor(clock * 3) % 3}` as
                        | "typing0"
                        | "typing1"
                        | "typing2")
                    : null;
        if (!kind) continue;
        let headX = actor.x;
        let headY = actor.y - 20;
        if (actor.mode === "seat") {
          const seat = model.agentSeats.get(actor.key);
          const cell = seat && layoutCells.get(seat.deskKey);
          if (cell && seat) {
            const geometry = townSeat(cell, seat.seat);
            headX = geometry.cx;
            headY = geometry.top ? geometry.tableY + 4 : geometry.tableY + 33;
          }
        }
        const point = camera.toScreen(headX, headY);
        if (
          point.x < -40 ||
          point.y < -40 ||
          point.x > camera.viewport.width + 40 ||
          point.y > camera.viewport.height + 40
        )
          continue;
        wanted.add(actor.key);
        let bubble = bubbles.get(actor.key);
        if (!bubble) {
          bubble = new Sprite(Texture.EMPTY);
          bubble.anchor.set(0.5, 1);
          screenLayer.addChild(bubble);
          bubbles.set(actor.key, bubble);
        }
        bubble.texture = textureOf(sprites.bubble[kind]);
        const bubbleScale =
          (kind === "blocked" || kind === "done") && !near ? 2 : scale;
        bubble.scale.set(bubbleScale);
        const bounce =
          kind === "blocked" && !camera.reducedMotion && !state.calm
            ? Math.abs(Math.sin(clock * 4 + (townHash(actor.key) % 7))) * 3
            : 0;
        bubble.position.set(
          Math.round(point.x),
          Math.round(point.y - 2 - bounce),
        );
      }
    for (const [key, bubble] of bubbles)
      if (!wanted.has(key)) {
        bubble.destroy();
        bubbles.delete(key);
      }
  };

  let layoutCells = new Map<string, TownCell>();

  const drawEffects = () => {
    fxLayer.clear();
    if (!model) return;
    const ring = (
      x: number,
      y: number,
      rx: number,
      ry: number,
      color: number,
      alpha: number,
    ) => {
      fxLayer
        .ellipse(x, y, rx, ry)
        .stroke({ color, width: 1.5 / Math.max(0.5, camera.z) + 0.5, alpha });
      fxLayer.ellipse(x, y, rx, ry).fill({ color, alpha: alpha * 0.2 });
    };
    for (const [key, color] of [
      [state.selectedKey, 0xffd166],
      [state.hoverKey !== state.selectedKey ? state.hoverKey : null, 0xffffff],
    ] as const) {
      if (!key) continue;
      const alpha = color === 0xffd166 ? 0.7 + 0.3 * Math.sin(clock * 5) : 0.45;
      const actor = actors.actors.get(key);
      if (actor) {
        if (actor.mode === "seat") {
          const seat = model.agentSeats.get(key);
          const cell = seat && layoutCells.get(seat.deskKey);
          if (cell && seat) {
            const geometry = townSeat(cell, seat.seat);
            ring(
              geometry.cx,
              geometry.top ? geometry.tableY + 17 : geometry.tableY + 56,
              11,
              4,
              color,
              alpha,
            );
          }
        } else ring(actor.x, actor.y, 10, 4, color, alpha);
        continue;
      }
      const cell = layoutCells.get(key);
      if (cell) {
        ring((cell.x + 3) * T, cell.y * T + 50, 38, 8, color, alpha);
        continue;
      }
      const room = layout?.buildings
        .flatMap((b) => b.rooms)
        .find((r) => r.key === key);
      if (room)
        fxLayer
          .rect(room.x * T + 2, room.y * T + 2, room.w * T - 4, room.h * T - 4)
          .stroke({ color, width: 2, alpha });
    }
  };

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
  const draw = (now: number) => {
    if (disposed || !layout || !model) return;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
    last = now;
    clock += dt;
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
    updatePods(deskBlend, camera.z >= 0.6, lite, blink);
    updateActors(Math.max(deskBlend, townBlend(0.35, 0.6, camera.z)));
    updateBubbles();
    drawEffects();
    const dragging = updateDrag(dt);
    app.renderer.render(app.stage);
    stats.level = level;
    stats.zoom = camera.z;
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
      statuses: bubbles.size,
    };
    onFrame(camera, level);
    if (!stats.ready) stats.ready = true;
    if (
      cameraMoved ||
      roofsMoving ||
      actorsMoved ||
      camera.flying ||
      materializing ||
      dragging
    )
      frames?.request("state");
    else if (!camera.reducedMotion && !state.calm) frames?.request("motion");
  };
  frames = registerWorldFrames(element, draw, (paused) => {
    stats.interactionPaused = paused;
  });

  const onMotion = (event: MediaQueryListEvent) => {
    camera.reducedMotion = event.matches;
    stats.reducedMotion = event.matches;
    frames?.request("state");
  };
  motion.addEventListener("change", onMotion);

  const syncActors = (instant: boolean) => {
    if (!layout || !model) return;
    const actorWorld = townActorWorld(layout, model);
    layoutCells = new Map(actorWorld.cells);
    actors.sync(actorWorld, instant || camera.reducedMotion);
  };

  /* ---------- drag and move effects ---------- */
  type Puff = { x: number; y: number; vx: number; vy: number; life: number };
  const puffs: Puff[] = [];
  const quiet = () => camera.reducedMotion || state.calm;
  const puffAt = (x: number, y: number, count: number) => {
    if (quiet()) return;
    for (let i = 0; i < count; i += 1) {
      const angle = Math.PI * (0.9 + 1.2 * Math.random());
      const speed = 18 + 34 * Math.random();
      puffs.push({
        x: x + (Math.random() - 0.5) * 24,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.5,
        life: 0.45 + 0.3 * Math.random(),
      });
    }
  };
  type DragVisual = {
    kind: "desk" | "agent";
    key: string;
    ghost: Container;
    shadow: Graphics;
    highlight: Graphics;
    slot: Sprite | null;
    home: { x: number; y: number };
    x: number;
    y: number;
    tilt: number;
    lastX: number;
    target: { x: number; y: number; w: number; h: number } | null;
    dimmed: Container | null;
    phase:
      | { name: "drag" }
      | { name: "back"; t: number; x0: number; y0: number }
      | { name: "park"; t: number; x0: number; y0: number }
      | { name: "land"; t: number };
  };
  let drag: DragVisual | null = null;
  const podOf = (deskKey: string) =>
    buildings.flatMap((b) => b.pods).find((pod) => pod.deskKey === deskKey);
  const deskWood = (deskKey: string) =>
    TOWN_WOODS[townHash(deskKey) % TOWN_WOODS.length]!;
  const clearDrag = () => {
    if (!drag) return;
    if (drag.dimmed && !drag.dimmed.destroyed) drag.dimmed.alpha = 1;
    drag.ghost.destroy({ children: true, texture: true });
    drag.shadow.destroy();
    drag.highlight.destroy();
    drag.slot?.destroy();
    drag = null;
  };
  const beginDrag = (
    kind: "desk" | "agent",
    key: string,
    x: number,
    y: number,
  ) => {
    clearDrag();
    if (!model || !layout) return;
    const ghost = new Container();
    let home = { x, y };
    let dimmed: Container | null = null;
    if (kind === "desk") {
      const cell = layoutCells.get(key);
      const pod = podOf(key);
      if (cell) home = { x: (cell.x + 3) * T, y: cell.y * T + 30 };
      let image: Sprite;
      if (pod) {
        // A snapshot of the desk as drawn, people and screens included.
        image = new Sprite(app.renderer.generateTexture(pod.container));
        pod.container.alpha = 0.25;
        dimmed = pod.container;
      } else {
        const seats = cell?.seats ?? 4;
        image = new Sprite(
          textureOf(
            (seats <= 2 ? sprites.tableSmall : sprites.table)[deskWood(key)]!,
          ),
        );
      }
      image.anchor.set(0.5);
      ghost.addChild(image);
    } else {
      const actor = actors.actors.get(key);
      const seat = model.agentSeats.get(key);
      const cell = seat && layoutCells.get(seat.deskKey);
      if (cell && seat) {
        const geometry = townSeat(cell, seat.seat);
        home = { x: geometry.cx, y: geometry.seatedY - 10 };
      } else if (actor) home = { x: actor.x, y: actor.y - 10 };
      const image = new Sprite(
        textureOf(townCharacter(lookOf(key), "down", 0, "stand", false)),
      );
      image.anchor.set(0.5, 0.8);
      ghost.addChild(image);
    }
    const shadow = new Graphics()
      .ellipse(0, 0, kind === "desk" ? 30 : 8, kind === "desk" ? 6 : 3)
      .fill({ color: 0x000000, alpha: 0.32 });
    const highlight = new Graphics();
    dragLayer.addChild(highlight, shadow, ghost);
    drag = {
      kind,
      key,
      ghost,
      shadow,
      highlight,
      slot: null,
      home,
      x: home.x,
      y: home.y,
      tilt: 0,
      lastX: x,
      target: null,
      dimmed,
      phase: { name: "drag" },
    };
    puffAt(
      home.x,
      home.y + (kind === "desk" ? 24 : 8),
      kind === "desk" ? 8 : 4,
    );
    moveDrag(x, y, null);
  };
  const moveDrag = (x: number, y: number, targetKey: string | null) => {
    if (!drag || !layout || drag.phase.name !== "drag") return;
    drag.tilt +=
      (Math.max(-0.35, Math.min(0.35, (x - drag.lastX) * 0.03)) - drag.tilt) *
      0.3;
    drag.lastX = x;
    drag.x = x;
    drag.y = y - (drag.kind === "desk" ? 24 : 14);
    drag.target = null;
    drag.slot?.destroy();
    drag.slot = null;
    if (targetKey && drag.kind === "desk") {
      // The next free spot of the target room, where the desk will land.
      const room = layout.buildings
        .flatMap((b) => b.rooms)
        .find((candidate) => candidate.key === targetKey);
      const cell = room?.cells.find((candidate) => !candidate.deskKey);
      if (cell) {
        drag.target = {
          x: (cell.x + 1) * T - 3,
          y: cell.y * T + 2,
          w: 70,
          h: 57,
        };
        const seats = model?.desks.get(drag.key)?.paneDevices.length ?? 4;
        const slot = new Sprite(
          textureOf(
            (seats <= 2 ? sprites.tableSmall : sprites.table)[
              deskWood(drag.key)
            ]!,
          ),
        );
        slot.alpha = 0.35;
        slot.position.set(
          (cell.x + 1) * T + (seats <= 2 ? 14 : -1),
          cell.y * T + 17,
        );
        dragLayer.addChildAt(slot, 1);
        drag.slot = slot;
      }
    } else if (targetKey && drag.kind === "agent") {
      const cell = layoutCells.get(targetKey);
      if (cell)
        drag.target = {
          x: (cell.x + 1) * T - 3,
          y: cell.y * T + 2,
          w: 70,
          h: 57,
        };
    }
    frames?.request("state");
  };
  const endDrag = (mode: "cancel" | "park") => {
    if (!drag || drag.phase.name !== "drag") return;
    if (mode === "park" && drag.target)
      drag.phase = { name: "park", t: 0, x0: drag.x, y0: drag.y };
    else drag.phase = { name: "back", t: 0, x0: drag.x, y0: drag.y };
    frames?.request("state");
  };
  const finishMove = (moved: boolean) => {
    if (!drag) return;
    if (moved && drag.target) {
      puffAt(
        drag.target.x + drag.target.w / 2,
        drag.target.y + drag.target.h - 4,
        14,
      );
      drag.phase = { name: "land", t: 0 };
    } else drag.phase = { name: "back", t: 0, x0: drag.x, y0: drag.y };
    frames?.request("state");
  };
  /** Advance drag effects and puffs; true while anything still moves. */
  const updateDrag = (dt: number) => {
    puffLayer.clear();
    for (let i = puffs.length - 1; i >= 0; i -= 1) {
      const puff = puffs[i]!;
      puff.life -= dt;
      if (puff.life <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      puff.x += puff.vx * dt;
      puff.y += puff.vy * dt;
      puff.vx *= 0.9;
      puff.vy *= 0.9;
      puffLayer
        .circle(puff.x, puff.y, 2 + (0.8 - puff.life) * 6)
        .fill({ color: 0xe8dcc4, alpha: Math.min(0.5, puff.life) });
    }
    if (!drag) return puffs.length > 0;
    const fast = quiet() ? 20 : 1;
    const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, t), 3);
    let x = drag.x;
    let y = drag.y;
    let tilt = drag.tilt;
    let alpha = 1;
    let scale = 1;
    const phase = drag.phase;
    if (phase.name === "back") {
      phase.t += (dt / 0.28) * fast;
      const k = ease(phase.t);
      x = phase.x0 + (drag.home.x - phase.x0) * k;
      y = phase.y0 + (drag.home.y - phase.y0) * k;
      tilt = drag.tilt * (1 - k);
      if (phase.t >= 1) {
        clearDrag();
        return puffs.length > 0;
      }
    } else if (phase.name === "park" && drag.target) {
      phase.t += dt * fast;
      const k = ease(phase.t / 0.35);
      const tx = drag.target.x + drag.target.w / 2;
      const ty = drag.target.y + drag.target.h / 2 - 8;
      const bob = quiet() ? 0 : Math.sin(clock * 5) * 2;
      x = phase.x0 + (tx - phase.x0) * k;
      y = phase.y0 + (ty - phase.y0) * k + bob * k;
      tilt = drag.tilt * (1 - k);
      alpha = 1 - 0.3 * k;
    } else if (phase.name === "land" && drag.target) {
      phase.t += (dt / 0.35) * fast;
      x = drag.target.x + drag.target.w / 2;
      y = drag.target.y + drag.target.h / 2 - 8 * (1 - phase.t);
      scale = 1 + 0.15 * Math.sin(Math.min(1, phase.t) * Math.PI);
      alpha = Math.max(0, 1 - phase.t);
      tilt = 0;
      if (phase.t >= 1) {
        clearDrag();
        return puffs.length > 0;
      }
    }
    drag.ghost.position.set(x, y);
    drag.ghost.rotation = tilt;
    drag.ghost.alpha = alpha;
    drag.ghost.scale.set(scale);
    drag.shadow.position.set(x, y + (drag.kind === "desk" ? 40 : 12));
    drag.shadow.alpha = alpha;
    drag.highlight.clear();
    if (drag.target && phase.name !== "back") {
      const pulse = 0.12 + 0.08 * Math.sin(clock * 4);
      const r = drag.target;
      drag.highlight
        .rect(r.x, r.y, r.w, r.h)
        .fill({ color: 0x7be08f, alpha: phase.name === "drag" ? 0.3 : pulse })
        .stroke({ color: 0x7be08f, width: 1.5, alpha: 0.9 });
    }
    return true;
  };

  let sceneKey = "";
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
      const first = !layout;
      model = nextModel;
      layout = nextLayout;
      state = nextState;
      camera.calm = nextState.calm;
      const key = `${nextLayout.width}x${nextLayout.height}:${nextLayout.buildings.map((b) => `${b.hostKey}@${b.x},${b.y},${b.w},${b.h}:${b.rooms.map((r) => r.cells.map((c) => (c.deskKey ? `${c.deskKey}#${c.seats}` : "-")).join(",")).join("|")}`).join(";")}`;
      if (layoutChanged && key !== sceneKey) {
        sceneKey = key;
        buildScene();
        stats.sceneRenders += 1;
      }
      syncActors(first);
      dimDirty = true;
      frames?.request("state");
    },
    setState(nextState) {
      state = nextState;
      camera.calm = nextState.calm;
      frames?.request("state");
    },
    setViewport(viewport) {
      app.renderer.resize(
        Math.max(1, viewport.width),
        Math.max(1, viewport.height),
      );
      camera.viewport = viewport;
      if (layout) camera.configure(layout, viewport);
      frames?.request("state");
    },
    invalidate() {
      frames?.request("state");
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
      clearDrag();
      motion.removeEventListener("change", onMotion);
      frames?.dispose();
      clearScene();
      for (const bubble of bubbles.values()) bubble.destroy();
      app.destroy(true, { children: true, texture: false });
      stats.destroys += 1;
      stats.activeApplications = Math.max(0, stats.activeApplications - 1);
      stats.activeTickers = Math.max(0, stats.activeTickers - 1);
      if (stats.activeApplications === 0) stats.ready = false;
    },
  };
}
