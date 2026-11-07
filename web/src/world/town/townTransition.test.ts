import { expect, test } from "bun:test";
import { TownBuildingLayers } from "./townBuildingLayers";
import { TownCamera, townZoomLimits } from "./townCamera";
import { townGroundPlan } from "./townGroundPlan";
import { layoutTown, TOWN_TILE as T, type TownLayout } from "./townLayout";
import { townBakeDirty, townBakeKeys } from "./scene/townSceneBake";
import {
  TOWN_TRANSITION_SECONDS,
  townBuildingRect,
  townCrossfadeAlpha,
  townEase,
  townGroundChunks,
  townMotionPose,
  townRetiringAlpha,
  townLandRect,
  townSceneGaps,
  TOWN_LAND_MARGIN,
  type TownDrawnScene,
  type TownRect,
} from "./townTransition";

const input = (hosts: string[]) => ({
  hosts: hosts.map((key, displayOrder) => ({ key, displayOrder })),
  rooms: hosts.flatMap((hostKey) =>
    Array.from({ length: 2 }, (_, order) => ({
      key: `${hostKey}/${order}`,
      hostKey,
      order,
      deskKeys: Array.from({ length: 4 }, (_, i) => `${hostKey}/${order}/${i}`),
    })),
  ),
});

const keysOf = (layout: TownLayout) =>
  townBakeKeys(
    {
      deskColors: new Map(),
      deskPins: new Map(),
      placeColors: { hosts: new Map(), rooms: new Map() },
      hosts: new Map(),
    } as unknown as Parameters<typeof townBakeKeys>[0],
    layout,
  );

/**
 * Everything a layout needs drawn through `view`, as a whole frame draws it:
 * the ground runs on past the town's edges, through its margin of land.
 */
function whole(layout: TownLayout, view: TownRect): TownDrawnScene {
  const keys = keysOf(layout);
  return {
    ground: new Set(townGroundChunks(layout, view).map((chunk) => chunk.key)),
    buildings: new Map(
      layout.buildings.map((building) => [
        building.hostKey,
        {
          key: keys.buildings.get(building.hostKey)!,
          pods: new Set(
            building.rooms.flatMap((room) =>
              room.cells.flatMap((cell) =>
                cell.deskKey ? [cell.deskKey] : [],
              ),
            ),
          ),
        },
      ]),
    ),
  };
}

const everything = (layout: TownLayout): TownRect => ({
  x: -100,
  y: -100,
  w: layout.width * T + 200,
  h: layout.height * T + 200,
});

test("transitions start where things were drawn and end where they belong", () => {
  expect(townEase(0)).toBe(0);
  expect(townEase(1)).toBe(1);
  expect(townEase(0.5)).toBeCloseTo(0.5);
  const glide = { dx: 120, dy: -40, enter: false, crossfade: false, t: 0 };
  expect(townMotionPose(glide)).toEqual({ x: 120, y: -40, alpha: 1 });
  expect(townMotionPose({ ...glide, t: 1 })).toEqual({ x: 0, y: 0, alpha: 1 });
  const enter = { dx: 0, dy: 0, enter: true, crossfade: false, t: 0 };
  expect(townMotionPose(enter).alpha).toBe(0);
  expect(townMotionPose({ ...enter, t: 1 }).alpha).toBe(1);
  // A building baked again (a desk added or closed) keeps its place and
  // walls opaque while its interior and desks fade in over the old drawing,
  // which stays whole under it until they are in: the changed desk
  // crossfades, the rest never changes and the ground never shows through.
  const rebaked = { dx: 0, dy: 0, enter: false, crossfade: true, t: 0 };
  expect(townMotionPose(rebaked).alpha).toBe(1);
  expect(townCrossfadeAlpha(rebaked)).toBe(0);
  expect(townCrossfadeAlpha({ ...rebaked, t: 0.3 })).toBeGreaterThan(0);
  expect(townCrossfadeAlpha({ ...rebaked, t: 0.3 })).toBeLessThan(1);
  expect(townCrossfadeAlpha({ ...rebaked, t: 1 })).toBe(1);
  expect(townCrossfadeAlpha(glide)).toBe(1);
  for (const t of [0, 0.3, 0.6, 0.99]) {
    const over = townCrossfadeAlpha({ ...rebaked, t });
    const under = townRetiringAlpha(t, "whole");
    expect(over + (1 - over) * under).toBe(1);
  }
  // One partly covered (its building shrank) holds for the first half; a
  // leaving one fades throughout.
  expect(townRetiringAlpha(0.4, "part")).toBe(1);
  expect(townRetiringAlpha(1, "part")).toBe(0);
  expect(townRetiringAlpha(0.5, "none")).toBeCloseTo(0.5);
  expect(townRetiringAlpha(1, "none")).toBe(0);
});

test("a whole frame has no gaps; a missing chunk, building or desk is one", () => {
  const { layout } = layoutTown(input(["a", "b", "c"]), "wide");
  const keys = keysOf(layout);
  const key = (building: TownLayout["buildings"][number]) =>
    keys.buildings.get(building.hostKey)!;
  const view = everything(layout);
  const drawn = whole(layout, view);
  expect(townSceneGaps(layout, view, drawn, key, true)).toEqual([]);
  // The ground cleared before the new one is painted (the old scene reset).
  expect(
    townSceneGaps(layout, view, { ...drawn, ground: new Set() }, key, false),
  ).toContain("ground 0,0");
  // A building dropped before its replacement is baked.
  const [first, second] = layout.buildings;
  const without = new Map(drawn.buildings);
  without.delete(first!.hostKey);
  expect(
    townSceneGaps(layout, view, { ...drawn, buildings: without }, key, false),
  ).toEqual([`building ${first!.hostKey}`]);
  // A building still drawn from an older layout is a gap too.
  const stale = new Map(drawn.buildings);
  stale.set(second!.hostKey, { key: "older", pods: null });
  expect(
    townSceneGaps(layout, view, { ...drawn, buildings: stale }, key, false),
  ).toEqual([`building ${second!.hostKey}`]);
  // Desks drawn without their people and screens, when zoomed in.
  const bare = new Map(drawn.buildings);
  bare.set(first!.hostKey, { key: key(first!), pods: new Set() });
  const missing = townSceneGaps(
    layout,
    view,
    { ...drawn, buildings: bare },
    key,
    true,
  );
  expect(missing.length).toBeGreaterThan(0);
  expect(missing.every((gap) => gap.startsWith("desk a/"))).toBe(true);
  expect(
    townSceneGaps(layout, view, { ...drawn, buildings: bare }, key, false),
  ).toEqual([]);
});

test("only what is in view must be drawn", () => {
  const { layout } = layoutTown(input(["a", "b", "c"]), "wide");
  const keys = keysOf(layout);
  const key = (building: TownLayout["buildings"][number]) =>
    keys.buildings.get(building.hostKey)!;
  const [first] = layout.buildings;
  const view = townBuildingRect(first!);
  const chunks = new Set(
    townGroundChunks(layout, view).map((chunk) => chunk.key),
  );
  const drawn: TownDrawnScene = {
    ground: chunks,
    buildings: new Map([[first!.hostKey, { key: key(first!), pods: null }]]),
  };
  const gaps = townSceneGaps(layout, view, drawn, key, false);
  expect(gaps.filter((gap) => !gap.startsWith("building "))).toEqual([]);
  // A neighbour whose roof edge meets the view must be drawn as well.
  for (const gap of gaps)
    expect(
      layout.buildings.some(
        (b) =>
          gap === `building ${b.hostKey}` &&
          b !== first &&
          townBuildingRect(b).x < view.x + view.w,
      ),
    ).toBe(true);
});

test("each building's plaques move and fade with it, and are plain at rest", () => {
  const layers = new TownBuildingLayers();
  const node = { style: { transform: "", opacity: "" } };
  const other = { style: { transform: "", opacity: "" } };
  layers.ref("a")(node as never);
  layers.ref("b")(other as never);
  layers.update((host) =>
    host === "a" ? { x: -48, y: 0, alpha: 1 } : { x: 0, y: 0, alpha: 0.25 },
  );
  expect(node.style).toEqual({
    transform: "translate(-48.0px, 0.0px)",
    opacity: "",
  });
  expect(other.style).toEqual({ transform: "", opacity: "0.25" });
  layers.update(() => null);
  expect(node.style).toEqual({ transform: "", opacity: "" });
  expect(other.style).toEqual({ transform: "", opacity: "" });
});

test("the camera glides with the buildings and stays in step with them", () => {
  const { layout } = layoutTown(input(["a", "b", "c"]), "wide");
  const viewport = {
    width: 1440,
    height: 900,
    inset: { top: 0, right: 0, bottom: 0, left: 0 },
  };
  const camera = new TownCamera();
  camera.configure(layout, viewport);
  camera.jumpTo(800, 400, townZoomLimits(layout, viewport).home);
  const start = { x: camera.x, y: camera.y };
  camera.glideBy(-160, 32, TOWN_TRANSITION_SECONDS);
  expect([camera.x, camera.y]).toEqual([start.x, start.y]);
  expect(camera.flying).toBe(false);
  // A building gliding from 160 px to its right stays put on screen.
  const motion = { dx: 160, dy: -32, enter: false, crossfade: true, t: 0 };
  const screen = () => {
    const pose = townMotionPose(motion);
    return camera.toScreen(640 + pose.x, 320 + pose.y);
  };
  const before = screen();
  for (let frame = 0; frame < 30; frame += 1) {
    camera.update(1 / 60);
    motion.t = Math.min(1, motion.t + 1 / 60 / TOWN_TRANSITION_SECONDS);
    expect(screen().x).toBeCloseTo(before.x, 3);
    expect(screen().y).toBeCloseTo(before.y, 3);
  }
  expect(camera.moving).toBe(false);
  expect(camera.x).toBeCloseTo(start.x - 160);
  expect(camera.y).toBeCloseTo(start.y + 32);
  // A second change mid-glide carries what was left of the first.
  camera.glideBy(100, 0, TOWN_TRANSITION_SECONDS);
  camera.update(TOWN_TRANSITION_SECONDS / 2);
  camera.glideBy(50, 0, TOWN_TRANSITION_SECONDS);
  for (let frame = 0; frame < 60; frame += 1) camera.update(1 / 60);
  expect(camera.x).toBeCloseTo(start.x - 10);
  // The user's own pan ends a glide; reduced motion never glides.
  camera.glideBy(100, 0, TOWN_TRANSITION_SECONDS);
  camera.panBy(0, 0);
  expect(camera.moving).toBe(false);
  camera.reducedMotion = true;
  const x = camera.x;
  camera.glideBy(40, 0, TOWN_TRANSITION_SECONDS);
  expect(camera.x).toBeCloseTo(x + 40);
  expect(camera.moving).toBe(false);
});

test("a building without rooms that moves is baked again in its new place", () => {
  // Hide the middle of three hosts when the rightmost has no rooms.
  const roomless = (hosts: string[]) => {
    const all = input(hosts);
    return { ...all, rooms: all.rooms.filter((room) => room.hostKey !== "c") };
  };
  const before = layoutTown(roomless(["a", "b", "c"]), "wide").layout;
  const after = layoutTown(roomless(["a", "c"]), "wide").layout;
  const at = (layout: TownLayout) =>
    layout.buildings.find((building) => building.hostKey === "c")!.x;
  expect(at(after)).toBeLessThan(at(before));
  const dirty = townBakeDirty(keysOf(before), keysOf(after));
  expect(dirty.removed).toEqual(new Set(["b"]));
  expect(dirty.buildings).toEqual(new Set(["c"]));
});

test("the ground stops a margin of land past the town, shaded into the woods", () => {
  const { layout } = layoutTown(input(["a", "b"]), "wide");
  const land = townLandRect(layout);
  expect(land).toEqual({
    x: -TOWN_LAND_MARGIN * T,
    y: -TOWN_LAND_MARGIN * T,
    w: (layout.width + 2 * TOWN_LAND_MARGIN) * T,
    h: (layout.height + 2 * TOWN_LAND_MARGIN) * T,
  });
  // However far the camera sees, chunks tile exactly the land, no farther.
  const chunks = townGroundChunks(layout, {
    x: -10_000,
    y: -10_000,
    w: 30_000,
    h: 30_000,
  });
  let area = 0;
  for (const { region } of chunks) {
    expect(region.x).toBeGreaterThanOrEqual(land.x);
    expect(region.y).toBeGreaterThanOrEqual(land.y);
    expect(region.x + region.w).toBeLessThanOrEqual(land.x + land.w);
    expect(region.y + region.h).toBeLessThanOrEqual(land.y + land.h);
    area += region.w * region.h;
  }
  expect(area).toBe(land.w * land.h);
  expect(townGroundChunks(layout, { x: -9000, y: 0, w: 100, h: 100 })).toEqual(
    [],
  );
  // The outer tile row is the page's woodland green; the shading thins
  // inward and stops before the town.
  const corner = chunks.find(
    ({ region }) => region.x === land.x && region.y === land.y,
  )!;
  const plan = townGroundPlan(layout, corner.region);
  const alphaAt = (x: number, y: number) =>
    plan.shade
      .filter((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h)
      .map((m) => Number(/,([\d.]+)\)$/.exec(m.fill)![1]));
  expect(alphaAt(land.x + T * 12, land.y)).toEqual([1]);
  const inner = alphaAt(land.x + T * 12, land.y + T * 7)[0]!;
  expect(inner).toBeGreaterThan(0);
  expect(inner).toBeLessThan(0.5);
  expect(alphaAt(land.x + T * 12, land.y + T * 8)).toEqual([]);
  expect(alphaAt(0, 0)).toEqual([]);
});
