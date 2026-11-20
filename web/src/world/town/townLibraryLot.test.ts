import { expect, test } from "bun:test";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import { townLandscape } from "./townLandscape";
import {
  layoutTown,
  TOWN_SHAPES,
  TOWN_TILE as T,
  TownGround,
  type TownInput,
  type TownShape,
} from "./townLayout";
import {
  TOWN_LIBRARY_YARD_ROWS,
  townLibraryFoldAt,
  townLibraryLot,
  townLibraryReserve,
} from "./townLibraryLot";
import { townHarbourFoldAt } from "./townHarbourLot";
import { townPostLotBeside, townPostReserve } from "./townPostLot";

const town = (spec: Record<string, number[]>): TownInput => ({
  hosts: Object.keys(spec).map((key, displayOrder) => ({ key, displayOrder })),
  rooms: Object.entries(spec).flatMap(([hostKey, rooms]) =>
    rooms.map((desks, order) => ({
      key: `${hostKey}/${order}`,
      hostKey,
      order,
      deskKeys: Array.from(
        { length: desks },
        (_, d) => `${hostKey}/${order}/${d}`,
      ),
    })),
  ),
});

const towns: [string, TownInput, TownShape][] = [
  ["empty", town({}), TOWN_SHAPES.wide],
  ["one building", town({ a: [1] }), TOWN_SHAPES.wide],
  ["one tall building", town({ a: [3, 3, 2, 2, 1, 1] }), TOWN_SHAPES.medium],
  ["two buildings", town({ a: [2], b: [1] }), TOWN_SHAPES.wide],
  [
    "two streets",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    TOWN_SHAPES.wide,
  ],
];

test.each(towns)(
  "the library stands right of the town center on the first street (%s), on clear land",
  (_, input, shape) => {
    const { layout } = layoutTown(input, shape);
    const lot = townLibraryLot(layout)!;
    expect(lot).not.toBeNull();
    const area = townLibraryReserve(lot);
    const { center } = layout;
    const firstStreet = Math.min(...layout.roads);
    // Right of the center's east wing, a short lawn between, inside the town.
    expect(area.x0).toBeGreaterThanOrEqual(center.x + center.w);
    expect(lot.x - (center.x + center.w)).toBeLessThanOrEqual(3);
    expect(area.x1).toBeLessThanOrEqual(layout.width);
    // Its garden fronts the first street, as the center and post office do.
    expect(lot.yardY + TOWN_LIBRARY_YARD_ROWS).toBe(firstStreet);
    for (const b of layout.buildings) expect(b.y).toBeGreaterThan(area.y1);
    // Clear of the post office on the other side.
    const post = townPostReserve(townPostLotBeside(layout.center));
    expect(post.x1).toBeLessThanOrEqual(area.x0);
    // No street lamp stands in front of the garden.
    for (const lamp of layout.lamps)
      if (lamp.y === firstStreet)
        expect(lamp.x < area.x0 || lamp.x >= area.x1).toBe(true);
    // The house and the garden stand on grass.
    for (let y = lot.y; y < lot.yardY + TOWN_LIBRARY_YARD_ROWS; y += 1)
      for (let x = lot.x; x < lot.x + lot.w; x += 1)
        expect(layout.ground[y * layout.width + x]).toBe(TownGround.grass);
    // No tree, hedge or pond grows on its lot.
    const land = townLandscape(layout);
    for (let y = area.y0; y < area.y1; y += 1)
      for (let x = area.x0; x < area.x1; x += 1) {
        expect(land.reserved(x, y)).toBe(0);
        expect(land.objectAt(x, y)).toBeNull();
      }
  },
);

test("making room for the library moves nothing that stands", () => {
  // The lawn right of the center comes from widening the town, not from
  // shifting the buildings: a town keeps its first building where it stood.
  const one = layoutTown(town({ a: [1] }), TOWN_SHAPES.wide).layout;
  const two = layoutTown(town({ a: [1], b: [1] }), TOWN_SHAPES.wide).layout;
  expect(two.buildings[0]!.x).toBe(one.buildings[0]!.x);
  for (const layout of [one, two]) {
    const lot = townLibraryLot(layout)!;
    expect(lot.x).toBe(layout.center.x + layout.center.w + 2);
    expect(townPostLotBeside(layout.center).x).toBeLessThan(layout.center.x);
  }
});

test.each([
  ["laptop, one building", town({ a: [1] }), 1440, 900],
  ["small laptop, two buildings", town({ a: [2], b: [1] }), 1280, 720],
  [
    "laptop, two streets",
    town({ a: [2], b: [1], c: [1], d: [1], e: [1] }),
    1440,
    900,
  ],
] as const)(
  "the library is in a laptop's home view (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.wide);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townLibraryLot(layout)!;
    const topLeft = camera.toScreen(lot.x * T, lot.y * T);
    const bottomRight = camera.toScreen(
      (lot.x + lot.w) * T,
      (lot.yardY + TOWN_LIBRARY_YARD_ROWS) * T,
    );
    expect(topLeft.x).toBeGreaterThanOrEqual(viewport.inset.left);
    expect(topLeft.y).toBeGreaterThanOrEqual(viewport.inset.top);
    expect(bottomRight.x).toBeLessThanOrEqual(width - viewport.inset.right);
    expect(bottomRight.y).toBeLessThanOrEqual(height - viewport.inset.bottom);
  },
);

test("a narrow town folds the library to a sign on the center's left wing", () => {
  const { layout } = layoutTown(town({ a: [2] }), TOWN_SHAPES.phone);
  expect(townLibraryLot(layout)).toBeNull();
  const { center } = layout;
  const at = townLibraryFoldAt(center, T);
  // Left of the plaque and doors in the middle, on the center itself: the
  // post office stands left of the center on a phone too (#1033), so the
  // sign (about 100 pixels wide) never hangs over its lot.
  expect(at.x - 50).toBeGreaterThanOrEqual(center.x * T);
  expect(at.x + 50).toBeLessThan((center.x + center.w / 2) * T - 24);
  expect(
    townPostReserve(townPostLotBeside(layout.center)).x1 * T,
  ).toBeLessThanOrEqual(at.x - 50);
  expect(at.y).toBeLessThan((center.y + center.h) * T);
  // Below the Shipyard's signpost on the same wing, the two never touching.
  const signpost = townHarbourFoldAt(center, T);
  expect(at.x).toBe(signpost.x);
  expect(at.y - signpost.y).toBeGreaterThanOrEqual(28 * 1.6);
});

test.each([
  ["one single-desk room", town({ a: [1] }), 390, 844],
  ["three single-desk rooms, small phone", town({ a: [1, 1, 1] }), 360, 640],
  ["a tall building", town({ a: [6, 4, 3, 2] }), 390, 844],
] as const)(
  "the folded library sign stands inside a phone's home view (%s)",
  (_, input, width, height) => {
    const { layout } = layoutTown(input, TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const at = townLibraryFoldAt(layout.center, T);
    const sign = camera.toScreen(at.x, at.y);
    const { inset } = viewport;
    expect(sign.x - 50).toBeGreaterThanOrEqual(inset.left);
    expect(sign.y + 15).toBeLessThanOrEqual(height - inset.bottom);
  },
);
