import { describe, expect, test } from "bun:test";
import type { BinEntry } from "../../../../shared/bin";
import {
  BUS_DEPART_MS,
  busPhase,
  busTrips,
  busX,
  catchableTrip,
  departX,
  townBusStop,
} from "./townBus";
import type { TownLayout } from "./townLayout";

const entry = (id: string, left: number, duration = 30_000): BinEntry => ({
  id,
  connection_id: "local",
  connection_generation: 1,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: id,
  terminal_id: `term-${id}`,
  label: id,
  view: "town",
  duration_ms: duration,
  remaining_ms: left,
});

describe("Town bus", () => {
  test("arrives, waits at the stop, then leaves as the countdown ends", () => {
    expect(busPhase(30_000, 30_000)).toEqual({ phase: "arrive", t: 0 });
    expect(busPhase(30_000, 28_000)).toEqual({ phase: "arrive", t: 0.5 });
    expect(busPhase(30_000, 20_000).phase).toBe("wait");
    expect(busPhase(30_000, 2_500)).toEqual({ phase: "leave", t: 0.5 });
    expect(busPhase(30_000, 0)).toEqual({ phase: "leave", t: 1 });
    // A short countdown keeps every phase.
    expect(busPhase(10_000, 6_000).phase).toBe("wait");
  });

  test("moves continuously by time left: eased in, still at the stop, eased out", () => {
    const at = (left: number) => busX(busPhase(30_000, left), -100, 400, 1000);
    expect(at(30_000)).toBe(-100);
    expect(at(26_000)).toBe(400);
    expect(at(10_000)).toBe(400);
    expect(at(0)).toBe(1000);
    // Easing: the bus covers more than half the way in the first half of arriving.
    expect(at(28_000)).toBeGreaterThan(150);
    // ...and less than half the way out in the first half of leaving.
    expect(at(2_500)).toBeLessThan(700);
    // Monotonic: never jumps back.
    let last = -Infinity;
    for (let left = 30_000; left >= 0; left -= 37) {
      const x = at(left);
      expect(x).toBeGreaterThanOrEqual(last);
      last = x;
    }
  });

  test("an empty bus pulls away from wherever it stopped", () => {
    expect(departX(400, 1000, 0)).toBe(400);
    expect(departX(400, 1000, BUS_DEPART_MS)).toBe(1000);
    expect(departX(400, 1000, BUS_DEPART_MS * 2)).toBe(1000);
  });

  test("everyone with the same deadline rides one bus; a later agent waits for the next", () => {
    const left = (e: BinEntry) => e.remaining_ms;
    const trips = busTrips(
      [entry("b", 12_100), entry("a", 12_000), entry("c", 29_000)],
      left,
    );
    expect(trips.map((trip) => trip.entries.map((e) => e.id))).toEqual([
      ["a", "b"],
      ["c"],
    ]);
    expect(catchableTrip(trips)?.entries[0]?.id).toBe("a");
    expect(catchableTrip(busTrips([entry("a", 4_000)], left))).toBeUndefined();
  });

  test("the stop stands by the first building's door, clear of the lamps", () => {
    const layout = {
      width: 60,
      buildings: [
        { x: 30, y: 40, doorX: 40, roadY: 50 },
        { x: 3, y: 3, doorX: 4, roadY: 20 },
      ],
      lamps: [{ x: 12, y: 20 }],
      verticalRoads: [{ x: 13, y0: 0, y1: 40 }],
    } as unknown as TownLayout;
    expect(townBusStop(layout)).toEqual({ x: 14 * 16 + 8, y: 20 * 16 + 14 });
    expect(
      townBusStop({ ...layout, buildings: [] } as unknown as TownLayout),
    ).toBeNull();
  });
});
