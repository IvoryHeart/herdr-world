import { describe, expect, test } from "bun:test";
import {
  TOWN_HARBOUR_BASIN_ROWS,
  TOWN_HARBOUR_BERTHS,
  TOWN_HARBOUR_CRATES,
  TOWN_HARBOUR_QUAY_ROWS,
  townHarbourBerth,
  townHarbourCrate,
  townHarbourLot,
  townHarbourReserve,
} from "./townHarbour";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import { townPostLot } from "./townPost";
import { townPostReserve } from "./townPostLot";

function town(shape: keyof typeof TOWN_SHAPES, hosts = 1, rooms = 2) {
  const hostList = Array.from({ length: hosts }, (_, index) => ({
    key: `h${index}`,
    displayOrder: index,
  }));
  return layoutTown(
    {
      hosts: hostList,
      rooms: hostList.flatMap((host) =>
        Array.from({ length: rooms }, (_, order) => ({
          key: `${host.key}/${order}`,
          hostKey: host.key,
          order,
          deskKeys: [`${host.key}/${order}/0`],
        })),
      ),
    },
    TOWN_SHAPES[shape],
  ).layout;
}

const overlaps = (
  a: { x0: number; y0: number; x1: number; y1: number },
  b: { x0: number; y0: number; x1: number; y1: number },
) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe("town harbour", () => {
  for (const shape of Object.keys(TOWN_SHAPES) as (keyof typeof TOWN_SHAPES)[])
    test(`${shape}: right of the center, inside the town, clear of all else`, () => {
      for (const [hosts, rooms] of [
        [1, 1],
        [2, 4],
        [4, 6],
      ] as const) {
        const layout = town(shape, hosts, rooms);
        const lot = townHarbourLot(layout);
        if (layout.formFactor === "narrow") {
          expect(lot).toBeNull();
          continue;
        }
        if (!lot) throw new Error("no harbour on a wide town");
        const { center } = layout;
        expect(lot.x).toBeGreaterThanOrEqual(center.x + center.w);
        expect(lot.quayY + TOWN_HARBOUR_QUAY_ROWS).toBe(center.street);
        expect(lot.y).toBe(lot.quayY - TOWN_HARBOUR_BASIN_ROWS);
        const reserve = townHarbourReserve(lot);
        expect(reserve.x0).toBeGreaterThanOrEqual(0);
        expect(reserve.y0).toBeGreaterThanOrEqual(0);
        expect(reserve.x1).toBeLessThanOrEqual(layout.width);
        const post = townPostLot(layout);
        if (post) expect(overlaps(reserve, townPostReserve(post))).toBe(false);
        for (const building of layout.buildings)
          expect(
            overlaps(reserve, {
              x0: building.x,
              y0: building.y,
              x1: building.x + building.w,
              y1: building.y + building.h,
            }),
          ).toBe(false);
      }
    });

  test("berths and crates stay on the lot", () => {
    const width = 16 * T;
    for (let index = 0; index < TOWN_HARBOUR_BERTHS; index += 1) {
      const berth = townHarbourBerth(index);
      expect(berth.x).toBeGreaterThan(0);
      expect(berth.x + 56).toBeLessThan(width);
      expect(berth.y + 44).toBeLessThanOrEqual(TOWN_HARBOUR_BASIN_ROWS * T);
    }
    // The newest release moors by the crane, on the right.
    expect(townHarbourBerth(0).x).toBeGreaterThan(townHarbourBerth(1).x);
    for (let index = 0; index < TOWN_HARBOUR_CRATES; index += 1) {
      const crate = townHarbourCrate(index);
      expect(crate.x).toBeGreaterThan(0);
      expect(crate.x + 15).toBeLessThan(112);
      expect(crate.y + 11).toBeLessThan(TOWN_HARBOUR_QUAY_ROWS * T);
    }
  });
});
