/**
 * The Town renderer's ground and buildings as the layout changes (see
 * townRenderer.ts for the rest of the frame). What was drawn stays until its
 * replacement is drawn: a topology change bakes what is in view in its first
 * frame, then a rebaked building's interior and desks fade in over its old
 * drawing (so an added or closed desk fades while the rest stays put), both
 * gliding together to its new place, and the old ground fades out over the
 * new (townTransition.ts). Otherwise ground and buildings are painted a few
 * per frame, as the camera reaches them.
 */

import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { OfficeDesk } from "../herdrOfficeProjection";
import type { TerminalColor } from "../terminalColor";
import type { TownBakeKeys } from "./scene/townSceneBake";
import type { TownCamera } from "./townCamera";
import type { TownRendererDiagnostics } from "./townDiagnostics";
import { TOWN_TILE as T, type TownCell, type TownLayout } from "./townLayout";
import type { TownModel } from "./townModel";
import { paintTownGround, type TownHostTheme } from "./townPaint";
import {
  bakeTownBuilding,
  bakeTownPod,
  townOutdoor,
  type BuildingView,
  type PodView,
  type TownOutdoorItem,
} from "./townRendererScene";
import type { TownCanvas, TownStaticSprites } from "./townSprites";
import {
  TOWN_TRANSITION_SECONDS,
  townBuildingRect,
  townCrossfadeAlpha,
  townDeskRect,
  townEase,
  townGroundChunks,
  townMotionPose,
  townRectsMeet,
  townRetiringAlpha,
  townSceneGaps,
  type TownBuildingMotion,
  type TownCover,
  type TownRect,
} from "./townTransition";

/** Below this zoom the baked tables suffice and desk sprites stay hidden. */
// Seated people appear at the same zoom as walking and lounging agents.
export const TOWN_DETAIL_ZOOM = 0.35;

export type TownTopologyContext = {
  camera: TownCamera;
  sprites: TownStaticSprites;
  groundLayer: Container;
  sceneLayer: Container;
  stats: TownRendererDiagnostics;
  model(): TownModel | null;
  layout(): TownLayout | null;
  deskColor(deskKey: string): TerminalColor;
  carpetFor(roomKey: string): string | undefined;
  themeFor(hostKey: string): TownHostTheme;
  /** Walking agents' sprites live in their building: drop one building's. */
  dropActors(hostKey: string): void;
  /** A building was baked: its rooms' dimming is drawn again. */
  onBuilt(): void;
};

export function createTownTopology(ctx: TownTopologyContext) {
  const { camera, sprites, groundLayer, sceneLayer, stats } = ctx;
  let buildings: BuildingView[] = [];
  const buildingByHost = new Map<string, BuildingView>();
  const pendingPods = new Map<string, TownCell[]>();
  let pendingBuildings: TownLayout["buildings"] = [];

  /** The ground and outdoor items painted for one layout. */
  type GroundView = {
    layer: Container;
    outdoor: Container;
    chunks: Map<string, Sprite>;
    items: TownOutdoorItem[];
    textures: Texture[];
  };
  let ground: GroundView | null = null;
  /** Drawings being replaced or removed, fading (and gliding) out. */
  type Retiring =
    | { kind: "ground"; ground: GroundView; t: number }
    | {
        kind: "building";
        view: BuildingView;
        t: number;
        /** How its replacement covers it, or "none" when it leaves on its own. */
        cover: TownCover;
        /** Progress of its own crossfade, which runs on under its replacement. */
        fade: number | null;
        /** Its offset and opacity when it began to leave. */
        from: { x: number; y: number; alpha: number };
        /** Where it glides to, in world pixels, with its replacement. */
        dx: number;
        dy: number;
      };
  const retiring: Retiring[] = [];
  /** Motion for buildings baked next frame: where each was drawn before. */
  const pendingMotion = new Map<string, Omit<TownBuildingMotion, "t">>();
  /**
   * The parts of a building that crossfade with its old drawing: the
   * interior, its rooms' dimming and the desks' pods. Walls, the roof and
   * walking agents (in `dynamic`, beside the pods) stay opaque.
   */
  const crossfade = (view: BuildingView, alpha: number) => {
    view.interior.alpha = view.dim.alpha = alpha;
    for (const pod of view.pods) pod.container.alpha = alpha;
  };
  /** A replaced building's roof keeps its fade. */
  const pendingRoof = new Map<string, number>();
  let bakeKeys: TownBakeKeys | null = null;

  const destroyGround = (view: GroundView) => {
    view.layer.destroy({ children: true });
    view.outdoor.destroy({ children: true });
    for (const texture of view.textures) texture.destroy(true);
  };
  const destroyView = (view: BuildingView) => {
    view.container.destroy({ children: true });
    for (const texture of view.textures) texture.destroy(true);
  };

  const clearScene = () => {
    for (const view of buildings) destroyView(view);
    buildings = [];
    buildingByHost.clear();
    for (const entry of retiring)
      if (entry.kind === "ground") destroyGround(entry.ground);
      else destroyView(entry.view);
    retiring.length = 0;
    if (ground) destroyGround(ground);
    ground = null;
  };

  /** A texture for a painted canvas, owned (and destroyed) by `owner`. */
  const own = (canvas: TownCanvas, owner: Texture[]) => {
    const texture = new Texture({
      source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
    });
    owner.push(texture);
    return texture;
  };

  /**
   * The town's size or a building's rectangle changed: paint its ground
   * again. The old ground stays drawn above the new one and fades out, so no
   * frame shows the ground missing.
   */
  const startGround = (instant: boolean) => {
    const layout = ctx.layout();
    if (!layout) return;
    const old = ground;
    const layer = new Container();
    const outdoor = new Container();
    outdoor.sortableChildren = true;
    outdoor.zIndex = -1;
    groundLayer.addChildAt(layer, 0);
    sceneLayer.addChild(outdoor);
    // Trees, lamps and benches join the scene with the ground chunk under them.
    ground = {
      layer,
      outdoor,
      chunks: new Map(),
      items: townOutdoor(layout, sprites, outdoor),
      textures: [],
    };
    if (!old) return;
    if (instant) destroyGround(old);
    else {
      old.outdoor.zIndex = -0.5;
      retiring.push({ kind: "ground", ground: old, t: 0 });
    }
  };

  /**
   * A building's view leaves: under its replacement, gliding with it to its
   * new place, or on its own when its host is gone.
   */
  const retireBuilding = (
    hostKey: string,
    instant: boolean,
    next: TownLayout["buildings"][number] | undefined,
  ) => {
    const view = buildingByHost.get(hostKey);
    pendingPods.delete(hostKey);
    pendingBuildings = pendingBuildings.filter((b) => b.hostKey !== hostKey);
    pendingMotion.delete(hostKey);
    pendingRoof.delete(hostKey);
    // Walking agents' sprites live in their building; they return next frame.
    ctx.dropActors(hostKey);
    if (!view) return;
    buildings = buildings.filter((entry) => entry !== view);
    buildingByHost.delete(hostKey);
    pendingRoof.set(hostKey, view.roofAlpha);
    if (instant) {
      destroyView(view);
      return;
    }
    // Where it is drawn now (it may be gliding already), relative to its baked place.
    const at = view.container.position;
    const dx = next ? (next.x - view.x) * T : at.x;
    const dy = next ? (next.y - view.y) * T : at.y;
    const fade = view.motion?.crossfade ? view.motion.t : null;
    view.motion = null;
    view.container.zIndex -= 0.5;
    retiring.push({
      kind: "building",
      view,
      t: 0,
      cover: !next
        ? "none"
        : next.w >= view.w && next.h >= view.h
          ? "whole"
          : "part",
      fade,
      from: { x: at.x, y: at.y, alpha: view.container.alpha },
      dx,
      dy,
    });
    stats.transitions += 1;
    if (next)
      pendingMotion.set(hostKey, {
        dx: (view.x - next.x) * T + at.x,
        dy: (view.y - next.y) * T + at.y,
        enter: false,
        crossfade: true,
      });
  };

  /** Bake a building again (or for the first time): its old view stays until then. */
  const replaceBuilding = (hostKey: string, instant: boolean) => {
    const building = ctx.layout()?.buildings.find((b) => b.hostKey === hostKey);
    const had = buildingByHost.has(hostKey);
    retireBuilding(hostKey, instant, building);
    if (!building) return;
    pendingBuildings.push(building);
    if (!had && !instant) {
      pendingMotion.set(hostKey, {
        dx: 0,
        dy: 0,
        enter: true,
        crossfade: false,
      });
      stats.transitions += 1;
    }
  };

  /** Advance glides and fades; true while any still runs. */
  const stepTransitions = (dt: number) => {
    const step = dt / TOWN_TRANSITION_SECONDS;
    let active = false;
    for (const view of buildings) {
      const motion = view.motion;
      if (!motion) continue;
      motion.t = Math.min(1, motion.t + step);
      const pose = townMotionPose(motion);
      view.container.position.set(pose.x, pose.y);
      view.container.alpha = pose.alpha;
      if (motion.crossfade) crossfade(view, townCrossfadeAlpha(motion));
      if (motion.t >= 1) view.motion = null;
      else active = true;
    }
    for (let index = retiring.length - 1; index >= 0; index -= 1) {
      const entry = retiring[index]!;
      entry.t = Math.min(1, entry.t + step);
      if (entry.t >= 1) {
        if (entry.kind === "ground") destroyGround(entry.ground);
        else destroyView(entry.view);
        retiring.splice(index, 1);
        continue;
      }
      active = true;
      if (entry.kind === "ground") {
        entry.ground.layer.alpha = entry.ground.outdoor.alpha =
          1 - townEase(entry.t);
        continue;
      }
      const e = townEase(entry.t);
      const { from } = entry;
      entry.view.container.position.set(
        from.x + (entry.dx - from.x) * e,
        from.y + (entry.dy - from.y) * e,
      );
      entry.view.container.alpha =
        from.alpha * townRetiringAlpha(entry.t, entry.cover);
      // A drawing replaced mid-crossfade finishes it under its replacement,
      // so the one under it is never uncovered.
      if (entry.fade !== null) {
        entry.fade = Math.min(1, entry.fade + step);
        crossfade(entry.view, townEase(entry.fade));
      }
    }
    return active;
  };

  /** Bake one building's textures and retained sprites the first time it is needed. */
  const buildBuilding = (building: TownLayout["buildings"][number]) => {
    const model = ctx.model();
    if (!model) return;
    const textures: Texture[] = [];
    const roof = pendingRoof.get(building.hostKey);
    pendingRoof.delete(building.hostKey);
    const { view, pendingCells } = bakeTownBuilding(building, {
      theme: ctx.themeFor(building.hostKey),
      stale: model.hosts.get(building.hostKey)?.stale ?? false,
      sprites,
      colorFor: ctx.deskColor,
      carpetFor: ctx.carpetFor,
      own: (canvas) => own(canvas, textures),
      textures,
      roofAlpha: roof ?? (camera.z >= (camera.limits?.roof ?? 0) ? 0 : 1),
      key: bakeKeys?.buildings.get(building.hostKey) ?? "",
    });
    const motion = pendingMotion.get(building.hostKey);
    pendingMotion.delete(building.hostKey);
    if (motion) {
      view.motion = { ...motion, t: 0 };
      const pose = townMotionPose(view.motion);
      view.container.position.set(pose.x, pose.y);
      view.container.alpha = pose.alpha;
      if (motion.crossfade) {
        crossfade(view, townCrossfadeAlpha(view.motion));
        stats.crossfades += 1;
      }
    }
    pendingPods.set(building.hostKey, pendingCells);
    sceneLayer.addChild(view.container);
    buildings.push(view);
    buildingByHost.set(building.hostKey, view);
    ctx.onBuilt();
  };

  /** The camera's view in world pixels, widened by `margin` screen pixels. */
  const viewRect = (margin: number): TownRect => {
    const left = camera.toWorld(-margin, -margin);
    const right = camera.toWorld(
      camera.viewport.width + margin,
      camera.viewport.height + margin,
    );
    return { x: left.x, y: left.y, w: right.x - left.x, h: right.y - left.y };
  };
  const shifted = (rect: TownRect, by: { x: number; y: number }) => ({
    ...rect,
    x: rect.x + by.x,
    y: rect.y + by.y,
  });
  /** In `view` where it ends up, or where it is drawn on its way there. */
  const meets = (
    rect: TownRect,
    view: TownRect,
    offset: { x: number; y: number } | undefined,
  ) =>
    townRectsMeet(rect, view) ||
    (offset !== undefined &&
      (offset.x !== 0 || offset.y !== 0) &&
      townRectsMeet(shifted(rect, offset), view));

  const paintChunk = (into: GroundView, key: string, region: TownRect) => {
    const layout = ctx.layout();
    if (!layout) return;
    const sprite = new Sprite(
      own(paintTownGround(layout, region), into.textures),
    );
    sprite.position.set(region.x, region.y);
    into.layer.addChild(sprite);
    into.chunks.set(key, sprite);
    into.items = into.items.filter((item) => {
      const inside =
        item.x >= region.x &&
        item.x < region.x + region.w &&
        item.y >= region.y &&
        item.y < region.y + region.h;
      if (inside) item.place();
      return !inside;
    });
  };

  /**
   * Paint visible ground chunks and bake visible buildings, a few per frame.
   * `urgent` (a topology change is being drawn): everything in view is
   * drawn now, so the frame is whole; the rest keeps its budget.
   */
  const MATERIALIZE_BUDGET_MS = 5;
  const materialize = (urgent: boolean) => {
    const layout = ctx.layout();
    if (!layout || !ground) return false;
    const into = ground;
    const began = performance.now();
    const spent = () => performance.now() - began >= MATERIALIZE_BUDGET_MS;
    const view = viewRect(0);
    const near = viewRect(200);
    if (urgent)
      for (const { key, region } of townGroundChunks(layout, view))
        if (!into.chunks.has(key)) paintChunk(into, key, region);
    let budget = 1;
    for (const { key, region } of townGroundChunks(layout, near)) {
      if (budget <= 0) break;
      if (into.chunks.has(key)) continue;
      paintChunk(into, key, region);
      budget -= 1;
    }
    let buildingBudget = spent() ? 0 : 1;
    pendingBuildings = pendingBuildings.filter((building) => {
      const rect = townBuildingRect(building);
      const motion = pendingMotion.get(building.hostKey);
      const offset = motion && { x: motion.dx, y: motion.dy };
      if (!meets(rect, near, offset)) return true;
      const now = urgent && meets(rect, view, offset);
      if (!now && buildingBudget <= 0) return true;
      buildBuilding(building);
      if (!now) buildingBudget -= 1;
      return false;
    });
    // A building not drawn now enters without motion when it is baked.
    if (urgent) pendingMotion.clear();
    let podsPending = false;
    if (camera.z >= TOWN_DETAIL_ZOOM)
      for (const building of buildings) {
        const cells = pendingPods.get(building.hostKey);
        // Culling ran last frame; a topology change checks each desk here.
        if (!cells?.length || (!urgent && !building.container.visible))
          continue;
        const offset = building.container.position;
        const remaining: TownCell[] = [];
        for (const cell of cells) {
          const rect = townDeskRect(cell);
          const seen = meets(rect, near, offset);
          const now = urgent && meets(rect, view, offset);
          if (!seen || (!now && spent())) {
            remaining.push(cell);
            if (seen) podsPending = true;
            continue;
          }
          const pod = buildPod(cell, building.dynamic);
          // A desk drawn during a crossfade joins it.
          if (building.motion?.crossfade)
            pod.container.alpha = townCrossfadeAlpha(building.motion);
          building.pods.push(pod);
        }
        pendingPods.set(building.hostKey, remaining);
      }
    return budget <= 0 || buildingBudget <= 0 || podsPending;
  };

  /** What this frame is missing, by the layout (townSceneGaps). */
  const sceneGaps = () => {
    const layout = ctx.layout();
    if (!layout || !ground) return ["ground"];
    const drawn = new Map<
      string,
      { key: string; pods: ReadonlySet<string> | null }
    >();
    for (const view of buildings)
      drawn.set(view.hostKey, {
        key: view.key,
        pods: new Set(view.pods.map((pod) => pod.deskKey)),
      });
    return townSceneGaps(
      layout,
      viewRect(0),
      { ground: new Set(ground.chunks.keys()), buildings: drawn },
      (building) => bakeKeys?.buildings.get(building.hostKey) ?? "",
      camera.z >= TOWN_DETAIL_ZOOM,
    );
  };

  const buildPod = (cell: TownCell, parent: Container): PodView => {
    const model = ctx.model()!;
    return bakeTownPod(cell, parent, {
      desk: model.desks.get(cell.deskKey!) as OfficeDesk,
      wood: ctx.deskColor(cell.deskKey!),
      pinned: model.deskPins.has(cell.deskKey!),
      sprites,
    });
  };

  const cull = () => {
    const layout = ctx.layout();
    if (!layout) return;
    const view = viewRect(80);
    view.h += 40;
    const detailed = camera.z >= TOWN_DETAIL_ZOOM;
    for (const building of buildings) {
      const placed = layout.buildings.find(
        (b) => b.hostKey === building.hostKey,
      )!;
      // A gliding building is drawn between where it was and its new place.
      const offset = building.container.position;
      const visible = meets(townBuildingRect(placed), view, offset);
      building.container.visible = visible;
      if (!visible) continue;
      for (const pod of building.pods)
        pod.container.visible =
          detailed && meets(townDeskRect(pod.cell), view, offset);
    }
  };

  return {
    /** The buildings drawn for the current layout. */
    get buildings(): readonly BuildingView[] {
      return buildings;
    },
    byHost: buildingByHost as ReadonlyMap<string, BuildingView>,
    /** What each building is baked from now. */
    setKeys(keys: TownBakeKeys) {
      bakeKeys = keys;
    },
    startGround,
    replaceBuilding,
    removeBuilding: (hostKey: string, instant: boolean) =>
      retireBuilding(hostKey, instant, undefined),
    materialize,
    step: stepTransitions,
    gaps: sceneGaps,
    cull,
    /** A building's drawn offset and opacity while it glides or fades in. */
    motion(hostKey: string) {
      const motion =
        buildingByHost.get(hostKey)?.motion ?? pendingMotion.get(hostKey);
      return motion ? townMotionPose({ t: 0, ...motion }) : null;
    },
    clear: clearScene,
  };
}
