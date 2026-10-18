import { expect, test } from "bun:test";
import {
  stepTownDrag,
  townDragPhase,
  type TownDragMotion,
} from "./townDragMotion";

/** A ghost dropped at (100, 100), home at (0, 0), target centred on (300, 208). */
function dropped(): TownDragMotion {
  const motion: TownDragMotion = {
    x: 100,
    y: 100,
    tilt: 0.2,
    home: { x: 0, y: 0 },
    target: { x: 280, y: 200, w: 40, h: 32 },
    phase: { name: "drag" },
    shown: { x: 100, y: 100, tilt: 0.2, alpha: 1, scale: 1 },
  };
  stepTownDrag(motion, 0.016, 0, true);
  motion.phase = townDragPhase(motion, "park");
  // Park long enough to settle on the target.
  for (let i = 0; i < 60; i += 1) stepTownDrag(motion, 0.016, 0, true);
  return motion;
}

test("parking settles the ghost on the target, dimmed", () => {
  const { shown } = dropped();
  expect(shown.x).toBeCloseTo(300);
  expect(shown.y).toBeCloseTo(208);
  expect(shown.alpha).toBeCloseTo(0.7);
});

test("an uncertain move fades from the parked ghost, never the drop point", () => {
  const motion = dropped();
  motion.phase = townDragPhase(motion, "fade");
  const { pose } = stepTownDrag(motion, 0.001, 0, false);
  expect(pose.x).toBeCloseTo(300);
  expect(pose.y).toBeCloseTo(208);
  // Fading only darkens: it starts below the parked alpha, never brighter.
  expect(pose.alpha).toBeLessThanOrEqual(0.7);
  expect(pose.alpha).toBeGreaterThan(0.6);
});

test("a move confirmed back springs home from the parked ghost", () => {
  const motion = dropped();
  motion.phase = townDragPhase(motion, "back");
  // The first frame starts at the parked ghost (the drop point is 200 px away).
  const first = stepTownDrag(motion, 0.0001, 0, false).pose;
  expect(Math.abs(first.x - 300)).toBeLessThan(1);
  expect(Math.abs(first.y - 208)).toBeLessThan(1);
  let done = false;
  for (let i = 0; i < 60 && !done; i += 1)
    done = stepTownDrag(motion, 0.016, 0, false).done;
  expect(done).toBe(true);
  expect(motion.shown.x).toBeCloseTo(0);
  expect(motion.shown.y).toBeCloseTo(0);
});
