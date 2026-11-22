import { describe, expect, test } from "bun:test";
import {
  TOWN_HARBOUR_BERTHS,
  TOWN_HARBOUR_SEA,
  TOWN_SHIP,
  townBerthAt,
  townHarbourLot,
  townHarbourPlaced,
  townHarbourReserve,
  townHarbourSignRow,
  townLanePierAt,
  townLaneSignAt,
  townLanesShown,
  townLighthouseAt,
  townProjectColor,
  TOWN_PROJECT_COLORS,
} from "./townHarbour";
import { townWarehouseReserve } from "./townHarbourLot";
import { layoutTown, TOWN_SHAPES, TOWN_TILE as T } from "./townLayout";
import { townPostLotBeside, townPostReserve } from "./townPostLot";

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

type Box = { x0: number; y0: number; x1: number; y1: number };
const overlaps = (a: Box, b: Box) =>
  a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

const SIZES = [
  [1, 1],
  [2, 4],
  [4, 6],
] as const;

describe("town harbour", () => {
  for (const shape of Object.keys(TOWN_SHAPES) as (keyof typeof TOWN_SHAPES)[])
    test(`${shape}: the right-most edge, on open sea, clear of all else`, () => {
      for (const [hosts, rooms] of SIZES) {
        const layout = town(shape, hosts, rooms);
        const lot = townHarbourLot(layout);
        // Every form factor: a phone's stacked town has its harbour too.
        // The sea is the map's last columns and runs off its right edge.
        expect(lot.right).toBe(layout.width);
        expect(lot.coast).toBe(layout.width - TOWN_HARBOUR_SEA);
        expect(lot.top).toBe(0);
        expect(lot.bottom).toBe(layout.height);
        // Everything of the town lies left of the shore.
        const { center } = layout;
        expect(lot.x).toBeGreaterThanOrEqual(center.x + center.w);
        const reserve = townHarbourReserve(lot);
        const warehouse = townWarehouseReserve(lot.warehouse);
        expect(warehouse.x0).toBeGreaterThanOrEqual(0);
        expect(warehouse.y0).toBeGreaterThanOrEqual(0);
        expect(warehouse.x1).toBeLessThanOrEqual(lot.streetEnd + 1);
        // The yard's front edge is the first street's pavement.
        expect(lot.warehouse.yardY + 4).toBe(center.street);
        const post = townPostReserve(townPostLotBeside(center));
        expect(overlaps(warehouse, post)).toBe(false);
        for (const building of layout.buildings) {
          const box = {
            x0: building.x,
            y0: building.y,
            x1: building.x + building.w,
            y1: building.y + building.h,
          };
          expect(overlaps(reserve, box)).toBe(false);
          expect(overlaps(warehouse, box)).toBe(false);
        }
      }
    });

  test("lanes, piers and berths stay on the sea, one below the other", () => {
    const layout = town("wide", 2, 4);
    const lot = townHarbourLot(layout);
    if (!lot) throw new Error("no harbour");
    expect(lot.lanes).toBeGreaterThanOrEqual(1);
    let below = -Infinity;
    for (let lane = 0; lane < lot.lanes; lane += 1) {
      const pier = townLanePierAt(lot, lane);
      expect(pier.x).toBe(lot.coast * T);
      expect(pier.x + pier.w).toBeLessThanOrEqual(lot.right * T);
      expect(pier.y).toBeLessThan(lot.bottom * T);
      const sign = townLaneSignAt(lot, lane);
      expect(sign.x).toBeGreaterThan(pier.x);
      for (let berth = 0; berth <= TOWN_HARBOUR_BERTHS; berth += 1) {
        const ship = townBerthAt(lot, lane, berth);
        expect(ship.x).toBeGreaterThanOrEqual(pier.x);
        expect(ship.x + TOWN_SHIP.w).toBeLessThanOrEqual(pier.x + pier.w);
        // Ships lie along the pier's north side, clear of the lane above.
        expect(ship.y).toBeGreaterThan(below);
        expect(ship.y + TOWN_SHIP.h).toBeGreaterThan(pier.y);
        if (berth > 0)
          expect(ship.x).toBeGreaterThan(townBerthAt(lot, lane, berth - 1).x);
      }
      below = pier.y + 8;
    }
  });

  for (const shape of Object.keys(TOWN_SHAPES) as (keyof typeof TOWN_SHAPES)[])
    test(`${shape}: no ship ever lies in front of a lighthouse (#1148)`, () => {
      for (const [hosts, rooms] of SIZES) {
        const lot = townHarbourLot(town(shape, hosts, rooms));
        const ships: Box[] = [];
        for (let lane = 0; lane < lot.lanes; lane += 1)
          for (let berth = 0; berth <= TOWN_HARBOUR_BERTHS; berth += 1) {
            const at = townBerthAt(lot, lane, berth);
            // The ship and its tag below it, a bob's pixel included.
            ships.push({
              x0: at.x,
              y0: at.y - 1,
              x1: at.x + TOWN_SHIP.w,
              y1: at.y + TOWN_SHIP.h + 14,
            });
          }
        for (let lane = 0; lane < lot.lanes; lane += 1) {
          const light = townLighthouseAt(lot, lane);
          const tower = {
            x0: light.x,
            y0: light.y,
            x1: light.x + light.w,
            y1: light.y + light.h,
          };
          // On its own pier's head, inside the map: reachable on every
          // form factor, a phone's included.
          const pier = townLanePierAt(lot, lane);
          expect(tower.x0).toBeGreaterThan(pier.x);
          expect(tower.x1).toBeLessThanOrEqual(pier.x + pier.w);
          expect(tower.x1).toBeLessThanOrEqual(lot.right * T);
          expect(tower.y0).toBeGreaterThanOrEqual(0);
          expect(tower.y1).toBeLessThanOrEqual(lot.bottom * T);
          // The lamp is in the tower's glass.
          expect(light.lamp.x).toBeGreaterThan(tower.x0);
          expect(light.lamp.x + light.lamp.w).toBeLessThan(tower.x1);
          expect(light.lamp.y).toBeGreaterThan(tower.y0);
          for (const ship of ships) expect(overlaps(ship, tower)).toBe(false);
        }
      }
    });

  test("many projects: shown lanes leave room for the +N lane", () => {
    const lot = townHarbourLot(town("wide", 1, 1));
    if (!lot) throw new Error("no harbour");
    expect(townLanesShown(lot, 0)).toBe(0);
    expect(townLanesShown(lot, lot.lanes)).toBe(lot.lanes);
    expect(townLanesShown(lot, lot.lanes + 3)).toBe(lot.lanes - 1);
  });

  for (const shape of Object.keys(TOWN_SHAPES) as (keyof typeof TOWN_SHAPES)[])
    test(`${shape}: the Shipyard sits vertically centred on its side`, () => {
      for (const [hosts, rooms] of SIZES) {
        const lot = townHarbourLot(town(shape, hosts, rooms));
        expect(lot.shift).toBe(0);
        for (let drawn = 0; drawn <= lot.lanes; drawn += 1) {
          const placed = townHarbourPlaced(lot, drawn);
          // The sign above the drawn lanes, as one block: the sea above it
          // and below it differ by at most a row.
          const top = townHarbourSignRow(placed);
          const last = drawn ? townLanePierAt(placed, drawn - 1).y / T : top;
          const bottom = drawn ? last + 2 : top + 5;
          expect(top).toBeGreaterThanOrEqual(townHarbourSignRow(lot));
          expect(Math.abs(top - (lot.bottom - bottom))).toBeLessThanOrEqual(1);
          // Placing moves only rows: the lanes the sea holds stay.
          expect(placed.lanes).toBe(lot.lanes);
          expect(placed.coast).toBe(lot.coast);
          // Every lighthouse is still on the map.
          for (let lane = 0; lane < drawn; lane += 1)
            expect(townLighthouseAt(placed, lane).y).toBeGreaterThanOrEqual(0);
          if (drawn)
            expect(townLanePierAt(placed, drawn - 1).y).toBeLessThan(
              placed.bottom * T,
            );
        }
      }
    });

  test("project colours are distinct and cycle", () => {
    expect(new Set(TOWN_PROJECT_COLORS).size).toBe(TOWN_PROJECT_COLORS.length);
    expect(townProjectColor(0)).toBe(TOWN_PROJECT_COLORS[0]);
    expect(townProjectColor(TOWN_PROJECT_COLORS.length)).toBe(
      TOWN_PROJECT_COLORS[0],
    );
  });
});
