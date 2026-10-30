import { describe, expect, test } from "bun:test";
import type { BinEntry } from "../../../../shared/bin";
import {
  BUS_DEPART_MS,
  BusHold,
  busParking,
  busPhase,
  busTrips,
  busX,
  catchableTrip,
  departX,
} from "./townBus";

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

  test("a held bus follows the service, even when a resume overtakes the pause", () => {
    const hold = new BusHold();
    hold.hold(100, false);
    // Before the service answers, an unpaused state keeps the bus frozen.
    hold.observe(false, false);
    expect(hold.at).toBe(100);
    hold.observe(true, false);
    // Another World resumes: the bus drives on here too.
    hold.observe(false, false);
    expect(hold.held(false)).toBe(false);
    // React batched the pause and a resume: the pause's answer is the resume.
    hold.hold(200, false);
    hold.answered(false);
    expect(hold.held(false)).toBe(false);
    // A pause that held: the bus stays until the service resumes.
    hold.hold(300, false);
    hold.answered(true);
    hold.observe(true, false);
    expect(hold.at).toBe(300);
    hold.observe(false, false);
    expect(hold.at).toBeNull();
    // An emptied bin always lets it go.
    hold.hold(400, false);
    hold.observe(false, true);
    expect(hold.at).toBeNull();
  });

  test("every parked bus stays on screen, at a phone's widest zoom too", () => {
    const sizes = { busW: 62, busH: 42 };
    for (const [width, zoom, count] of [
      [390, 4, 2],
      [390, 4, 13],
      [390, 1.5, 13],
      [1440, 2, 3],
      [1440, 4, 13],
    ] as const) {
      const area = { left: 8, right: width - 60, top: 40, bottom: 700 };
      const { scale, slots } = busParking({ ...sizes, ...area, count, zoom });
      for (const [i, slot] of slots.entries()) {
        expect(slot.x).toBeGreaterThanOrEqual(area.left - 0.01);
        expect(slot.x + sizes.busW * scale).toBeLessThanOrEqual(
          area.right + 0.01,
        );
        expect(slot.bottom - sizes.busH * scale).toBeGreaterThanOrEqual(
          area.top - 0.01,
        );
        expect(slot.bottom).toBeLessThanOrEqual(area.bottom + 0.01);
        for (const other of slots.slice(i + 1))
          expect(
            other.bottom !== slot.bottom ||
              other.x >= slot.x + sizes.busW * scale ||
              slot.x >= other.x + sizes.busW * scale,
          ).toBe(true);
      }
    }
    // One bus that fits stands right next to the stop, at full size.
    expect(
      busParking({
        ...sizes,
        count: 1,
        zoom: 2,
        left: 8,
        right: 1300,
        top: 40,
        bottom: 700,
      }),
    ).toEqual({ scale: 2, slots: [{ x: 1300 - 124, bottom: 40 + 84 }] });
  });
});
