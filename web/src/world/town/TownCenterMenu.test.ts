import { expect, test } from "bun:test";
import {
  townCenterAngle,
  townCenterLabel,
  townCenterMenuPoint,
  townCenterRing,
  townCenterSpot,
  townCenterStep,
} from "./TownCenterMenu";

test("the ring centres on the center's doors when every action fits", () => {
  expect(townCenterMenuPoint({ x: 700, y: 400 }, 1440, 900)).toEqual({
    x: 700,
    y: 400,
  });
});

test("the ring moves just enough to keep every action and label on screen", () => {
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    const { reach } = townCenterRing(width);
    // The center scrolled above the top-left corner, then past the bottom right.
    const high = townCenterMenuPoint({ x: -50, y: -200 }, width, height);
    expect(high).toEqual({ x: reach.x, y: reach.top });
    const low = townCenterMenuPoint(
      { x: width + 50, y: height + 200 },
      width,
      height,
    );
    expect(low).toEqual({ x: width - reach.x, y: height - reach.bottom });
  }
});

test("a phone's ring fits its width with 44 px medallions or larger", () => {
  const ring = townCenterRing(390);
  expect(ring.item).toBeGreaterThanOrEqual(44);
  expect(ring.reach.x * 2).toBeLessThanOrEqual(390);
  // A phone's labels keep to its width, so only a view too short for the
  // ring centres it between its reaches.
  const small = townCenterRing(200).reach;
  expect(townCenterMenuPoint({ x: 0, y: 0 }, 200, 200)).toEqual({
    x: small.x,
    y: (small.top + 200 - small.bottom) / 2,
  });
});

test("each label sits outside the ring, beyond its icon, within its reach", () => {
  for (const width of [360, 390, 1440])
    for (const count of [3, 5, 8]) {
      const ring = townCenterRing(width);
      for (let index = 0; index < count; index += 1) {
        const spot = townCenterSpot(index, count, ring.radius);
        const label = townCenterLabel(index, count, ring);
        // Beyond the medallion's edge, along the entry's own direction.
        expect(Math.hypot(label.at.x, label.at.y)).toBeGreaterThan(
          ring.item / 2,
        );
        expect(label.at.x * spot.x).toBeGreaterThanOrEqual(0);
        expect(label.at.y * spot.y).toBeGreaterThanOrEqual(0);
        // It grows away from the ring.
        expect(label.align.x * spot.x).toBeGreaterThanOrEqual(0);
        expect(label.align.y * spot.y).toBeGreaterThanOrEqual(0);
        // Its edges stay inside the ring's reach.
        const from = spot.x + ring.beyond * spot.out.x;
        const left = from - ((1 - label.align.x) / 2) * label.width;
        const right = from + ((1 + label.align.x) / 2) * label.width;
        expect(left).toBeGreaterThanOrEqual(-ring.reach.x - 0.5);
        expect(right).toBeLessThanOrEqual(ring.reach.x + 0.5);
      }
    }
  // The side entries of a phone's ring get the room its width leaves.
  const phone = townCenterRing(390);
  expect(townCenterLabel(2, 8, phone).width).toBe(
    Math.floor(
      phone.reach.x - townCenterSpot(2, 8, phone.radius).x - phone.beyond,
    ),
  );
  expect(townCenterLabel(2, 8, phone).width).toBeGreaterThanOrEqual(88);
  expect(townCenterLabel(0, 8, phone).width).toBe(phone.labelWidth);
});

test("actions run clockwise from the top", () => {
  const at = (index: number) => {
    const angle = townCenterAngle(index, 6);
    return {
      x: Math.round(Math.cos(angle) * 10),
      y: Math.round(Math.sin(angle) * 10),
    };
  };
  expect(at(0)).toEqual({ x: 0, y: -10 });
  expect(at(1).x).toBeGreaterThan(0);
  expect(at(3)).toEqual({ x: 0, y: 10 });
  expect(at(5).x).toBeLessThan(0);
});

test("a later ring centres on the entry that opened it, at every depth, fitted", () => {
  const { radius } = townCenterRing(1440);
  // Buildings, third of six on the first ring; then a third-level entry.
  const buildings = townCenterStep(2, 6, radius);
  const library = townCenterStep(0, 5, radius);
  const doors = { x: 700, y: 400 };
  expect(townCenterMenuPoint(doors, 1440, 900, [buildings])).toEqual({
    x: doors.x + buildings.x,
    y: doors.y + buildings.y,
  });
  expect(townCenterMenuPoint(doors, 1440, 900, [buildings, library])).toEqual({
    x: doors.x + buildings.x + library.x,
    y: doors.y + buildings.y + library.y,
  });
  // On a phone the ring opened from an entry near the edge moves back in.
  const phone = townCenterRing(390);
  const right = townCenterStep(1, 4, phone.radius);
  expect(townCenterMenuPoint({ x: 195, y: 422 }, 390, 844, [right])).toEqual({
    x: 390 - phone.reach.x,
    y: 422,
  });
});

test("a narrow phone's oval ring keeps its medallions apart and full size", () => {
  for (const width of [320, 360, 390, 430, 600, 1440]) {
    const ring = townCenterRing(width);
    expect(ring.item).toBeGreaterThanOrEqual(width < 640 ? 56 : 52);
    expect(ring.radius.y).toBeGreaterThanOrEqual(ring.radius.x);
    for (let count = 2; count <= 8; count += 1)
      for (let index = 0; index < count; index += 1) {
        const a = townCenterStep(index, count, ring.radius);
        const b = townCenterStep((index + 1) % count, count, ring.radius);
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(
          ring.item + 9,
        );
      }
  }
  // Round where the width allows: a desktop and a wide phone.
  expect(townCenterRing(1440).radius).toEqual({ x: 96, y: 96 });
  expect(townCenterRing(430).radius.x).toBe(townCenterRing(430).radius.y);
  expect(townCenterRing(390).radius.y).toBeGreaterThan(
    townCenterRing(390).radius.x,
  );
});
