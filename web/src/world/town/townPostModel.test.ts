import { expect, test } from "bun:test";
import { needsYouCount, type NeedsYouItem } from "../needsYou";
import { TownSceneCamera, townViewport } from "./scene/townSceneCamera";
import { TownCamera } from "./townCamera";
import { townHarbourFoldAt } from "./townHarbourLot";
import { townLibraryFoldAt } from "./townLibraryLot";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import {
  TOWN_POST_EMPTY,
  townPostCounts,
  townPostFoldAt,
  townPostParts,
  townPostSignAt,
  townPostSpoken,
  townPostWaiting,
} from "./townPostModel";
import { townPostLotBeside } from "./townPostLot";
import { townWarehouseFoldAt } from "./townWarehouseModel";

const items = (
  ...kinds: NeedsYouItem["kind"][]
): Pick<NeedsYouItem, "kind">[] => kinds.map((kind) => ({ kind }));

test("it counts Needs you's items by kind, and the Outbox's checks", () => {
  const listed = items("asks", "asks", "needs", "done", "done", "done");
  const counts = townPostCounts(listed, 1);
  expect(counts).toEqual({ asks: 2, needs: 1, done: 3, outbox: 1 });
  // Waiting is what the top bar's counter counts: asks and blocked agents.
  expect(townPostWaiting(counts)).toBe(needsYouCount(listed as NeedsYouItem[]));
});

test("its sign reads at a glance: urgent first, empty kinds left out", () => {
  const parts = townPostParts({ asks: 2, needs: 1, done: 0, outbox: 1 });
  expect(parts.map((part) => [part.mark, part.text])).toEqual([
    ["asks", "2 questions"],
    ["needs", "1 blocked"],
    [null, "1 to check"],
  ]);
  expect(townPostSpoken({ asks: 1, needs: 2, done: 1, outbox: 2 })).toBe(
    "1 question for you, 2 agents blocked, 1 finished to review, 2 answers to check",
  );
  expect(townPostParts(TOWN_POST_EMPTY)).toEqual([]);
  expect(townPostSpoken(TOWN_POST_EMPTY)).toBe("nothing for you");
});

const town = (rooms: number[]) => ({
  hosts: [{ key: "a", displayOrder: 0 }],
  rooms: rooms.map((desks, order) => ({
    key: `a/${order}`,
    hostKey: "a",
    order,
    deskKeys: Array.from({ length: desks }, (_, desk) => `a/${order}/${desk}`),
  })),
});

test("a wide town's sign stands on the post office's roof, not on the town center", () => {
  const { layout } = layoutTown(town([2, 1]), TOWN_SHAPES.wide);
  const lot = townPostLotBeside(layout.center);
  const at = townPostSignAt(lot);
  // Anchored at its bottom-right, the sign grows up and left over the lot.
  expect(at.x).toBeGreaterThan(lot.x * T);
  expect(at.x).toBeLessThanOrEqual((lot.x + lot.w) * T);
  expect(at.x).toBeLessThan(layout.center.x * T);
  expect(at.y).toBeLessThan(lot.yardY * T);
});

test.each([
  ["one single-desk room", [1], 390, 844],
  ["three single-desk rooms", [1, 1, 1], 390, 844],
  ["three single-desk rooms, small phone", [1, 1, 1], 360, 640],
  ["a tall building", [6, 4, 3, 2], 390, 844],
] as const)(
  "a narrow town folds it to a sign across its own house, in a phone's home view (%s)",
  (_, rooms, width, height) => {
    const { layout } = layoutTown(town([...rooms]), TOWN_SHAPES.phone);
    const viewport = townViewport(width, height, { left: 0, right: 0 });
    const camera = new TownCamera();
    camera.viewport = viewport;
    new TownSceneCamera(new Map(), () => {}).attach(camera, layout, viewport);
    const lot = townPostLotBeside(layout.center);
    const at = townPostFoldAt(lot);
    const sign = camera.toScreen(at.x, at.y);
    // A folded sign keeps its screen size near home zoom (--iz, up to 1.6):
    // the post office's is up to about 138 by 28 pixels with all four
    // counts, the wings' signs about 100 by 28.
    const z = camera.z;
    const scale = z * Math.min(1.6, Math.max(0.55, 1 / z));
    const { inset } = viewport;
    expect(sign.x - 69 * scale).toBeGreaterThanOrEqual(inset.left);
    expect(sign.y - 14 * scale).toBeGreaterThanOrEqual(inset.top);
    expect(sign.y + 14 * scale).toBeLessThanOrEqual(height - inset.bottom);
    // On the post office's front, under its roof and above its yard.
    expect(at.x).toBeGreaterThan(lot.x * T);
    expect(at.x).toBeLessThan((lot.x + lot.w) * T);
    expect(at.y).toBeGreaterThan(lot.y * T);
    expect(at.y).toBeLessThan(lot.yardY * T);
    // Clear of the signs on the town center's wings.
    const center = layout.center;
    for (const other of [
      townHarbourFoldAt(center, T),
      townLibraryFoldAt(center, T),
      townWarehouseFoldAt(center),
    ]) {
      const there = camera.toScreen(other.x, other.y);
      const apart =
        Math.abs(sign.x - there.x) > (69 + 50) * scale ||
        Math.abs(sign.y - there.y) > 28 * scale;
      expect(apart).toBe(true);
    }
  },
);
