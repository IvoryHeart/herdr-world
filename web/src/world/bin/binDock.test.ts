import { expect, test } from "bun:test";
import { binDock, dockReserve, onBinDock, setBinDock } from "./binDock";

const box = (left: number, right: number, top: number, bottom: number) => ({
  left,
  right,
  top,
  bottom,
});

test("controls on the dock's row fill only the width right of it", () => {
  // An 800 px page: the row spans 12–788, the dock 255–545 centred on it.
  const row = box(12, 788, 840, 886);
  expect(dockReserve(row, box(255, 545, 842, 884), 12)).toBe(545);
  expect(800 - 24 - dockReserve(row, box(255, 545, 842, 884), 12)).toBe(231);
});

test("a dock above, below or right of the row takes nothing", () => {
  const row = box(12, 788, 840, 886);
  expect(dockReserve(row, null, 12)).toBe(0);
  expect(dockReserve(row, box(255, 545, 780, 830), 12)).toBe(0);
  expect(dockReserve(row, box(255, 545, 890, 930), 12)).toBe(0);
  expect(dockReserve(row, box(800, 900, 842, 884), 12)).toBe(0);
});

test("a dock past the row's right edge takes the whole row", () => {
  expect(dockReserve(box(12, 400, 0, 40), box(200, 600, 0, 40), 12)).toBe(388);
});

test("the dock's element is shared as it comes and goes", () => {
  const seen: unknown[] = [];
  const stop = onBinDock(() => seen.push(binDock()));
  const element = {} as HTMLElement;
  setBinDock(element);
  setBinDock(element);
  setBinDock(null);
  stop();
  setBinDock(element);
  expect(seen).toEqual([element, null]);
  setBinDock(null);
});
