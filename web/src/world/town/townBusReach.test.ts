import { expect, test } from "bun:test";
import { freeScreenArea, insideScreenArea } from "./townBusReach";

const phone = { left: 0, top: 0, right: 390, bottom: 844 };

test("a phone's free town is above the asks rail and left of the zoom column", () => {
  const rail = { left: 10, top: 518, right: 318, bottom: 832 };
  const zoom = { left: 318, top: 365, right: 374, bottom: 476 };
  const free = freeScreenArea(phone, [rail, zoom]);
  expect(free).toEqual({ left: 0, top: 0, right: 318, bottom: 518 });
  // A stop drawn half under the rail is not within reach.
  const stop = { left: 100, top: 400, right: 240, bottom: 531 };
  expect(insideScreenArea(free, stop)).toBe(false);
  expect(insideScreenArea(free, { ...stop, top: 300, bottom: 431 })).toBe(true);
});

test("a desktop side rail keeps the town beside it; panels elsewhere change nothing", () => {
  const wide = { left: 0, top: 0, right: 1512, bottom: 982 };
  const rail = { left: 1180, top: 0, right: 1512, bottom: 982 };
  expect(freeScreenArea(wide, [rail])).toEqual({ ...wide, right: 1180 });
  const offscreen = { left: 2000, top: 0, right: 2100, bottom: 50 };
  expect(freeScreenArea(wide, [offscreen])).toEqual(wide);
});
