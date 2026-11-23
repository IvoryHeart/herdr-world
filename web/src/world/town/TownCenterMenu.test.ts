import { expect, test } from "bun:test";
import {
  townCenterAngle,
  townCenterMenuPoint,
  townCenterRing,
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
  // A view too small for the ring centres it between its reaches.
  const small = townCenterRing(200).reach;
  expect(townCenterMenuPoint({ x: 0, y: 0 }, 200, 200)).toEqual({
    x: 100,
    y: (small.top + 200 - small.bottom) / 2,
  });
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
