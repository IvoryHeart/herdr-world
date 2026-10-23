import { expect, test } from "bun:test";
import {
  stepTownDrag,
  townDragPhase,
  townGroundedPose,
  type TownDragMotion,
  type TownDragPose,
} from "./townDragMotion";

/** A ghost dropped at (100, 100), home at (0, 0), target centred on (300, 208). */
function dropped(): TownDragMotion {
  const motion: TownDragMotion = {
    x: 100,
    y: 100,
    home: { x: 0, y: 0 },
    target: { x: 280, y: 200, w: 40, h: 32 },
    phase: { name: "drag", t: 0 },
    shown: { ...townGroundedPose(100, 100), tilt: 0.2 },
    vx: 0,
    vy: 0,
    lean: 0,
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

const last = <T>(items: T[]) => items[items.length - 1]!;

/** A desk lifted at home (0, 0) and carried toward the pointer. */
function lifted(): TownDragMotion {
  return {
    x: 0,
    y: 0,
    home: { x: 0, y: 0 },
    target: { x: 280, y: 200, w: 40, h: 32 },
    phase: { name: "drag", t: 0 },
    shown: townGroundedPose(0, 0),
    vx: 0,
    vy: 0,
    lean: 0,
  };
}

/** Run a phase to its end at 60 fps, collecting every pose. */
function run(motion: TownDragMotion, quiet: boolean) {
  const poses: TownDragPose[] = [];
  let landings = 0;
  for (let i = 0; i < 120; i += 1) {
    const { pose, done, landed } = stepTownDrag(motion, 1 / 60, i / 60, quiet);
    poses.push(pose);
    if (landed) landings += 1;
    if (done) return { poses, landings, done };
  }
  return { poses, landings, done: false };
}

test("a picked-up desk lifts off, then follows the pointer smoothly and leans into it", () => {
  const motion = lifted();
  const first = stepTownDrag(motion, 1 / 60, 0, false).pose;
  expect(first.lift).toBeGreaterThan(0);
  expect(first.lift).toBeLessThan(1);
  for (let i = 0; i < 20; i += 1) stepTownDrag(motion, 1 / 60, i / 60, false);
  expect(motion.shown.lift).toBeCloseTo(1);
  // The pointer jumps 200 px right: the ghost follows over frames, no jump.
  motion.x = 200;
  const steps: TownDragPose[] = [];
  for (let i = 0; i < 60; i += 1)
    steps.push(stepTownDrag(motion, 1 / 60, i / 60, false).pose);
  const largest = Math.max(
    ...steps.map((pose, i) => pose.x - (i ? steps[i - 1]!.x : 0)),
  );
  expect(largest).toBeLessThan(40);
  expect(
    Math.max(...steps.slice(0, 10).map((pose) => pose.tilt)),
  ).toBeGreaterThan(0.05);
  // It settles under the pointer without swinging far past it.
  expect(Math.max(...steps.map((pose) => pose.x))).toBeLessThan(215);
  expect(last(steps).x).toBeCloseTo(200, 0);
});

test("a landing drops onto the target, touches down once, bounces and ends", () => {
  const motion = dropped();
  motion.phase = townDragPhase(motion, "land");
  const { poses, landings, done } = run(motion, false);
  expect(done).toBe(true);
  expect(landings).toBe(1);
  const touchdown = poses.findIndex((pose) => pose.lift === 0);
  expect(touchdown).toBeGreaterThan(0);
  // Squashed flat on touch-down, then back to its shape.
  expect(
    Math.max(...poses.slice(touchdown).map((p) => p.squash)),
  ).toBeGreaterThan(1.1);
  expect(last(poses).x).toBeCloseTo(300);
  expect(last(poses).y).toBeCloseTo(208);
});

test("a landing without a target touches down where it was dropped", () => {
  const motion = dropped();
  motion.target = null;
  motion.phase = townDragPhase(motion, "land");
  const { poses, landings } = run(motion, false);
  expect(landings).toBe(1);
  expect(last(poses).x).toBeCloseTo(300);
});

test("a refused move shakes where it was, then springs home without landing", () => {
  const motion = dropped();
  motion.phase = townDragPhase(motion, "back");
  const { poses, landings, done } = run(motion, false);
  expect(done).toBe(true);
  expect(landings).toBe(0);
  const shake = poses.slice(0, 12).map((pose) => pose.x - 300);
  expect(Math.max(...shake)).toBeGreaterThan(1);
  expect(Math.min(...shake)).toBeLessThan(-1);
});

test("quiet motion follows the pointer exactly and ends with a short fade", () => {
  const motion = lifted();
  motion.x = 120;
  const carried = stepTownDrag(motion, 1 / 60, 0, true).pose;
  expect(carried.x).toBe(120);
  expect(carried.tilt).toBe(0);
  motion.phase = townDragPhase(motion, "land");
  const landing = run(motion, true);
  expect(landing.done).toBe(true);
  expect(landing.poses.length).toBeLessThanOrEqual(10);
  expect(landing.landings).toBe(1);
  expect(landing.poses.every((pose) => pose.squash === 1)).toBe(true);
  expect(last(landing.poses).alpha).toBe(0);

  const refused = lifted();
  stepTownDrag(refused, 1 / 60, 0, true);
  refused.phase = townDragPhase(refused, "back");
  const back = run(refused, true);
  expect(back.done).toBe(true);
  expect(back.poses.length).toBeLessThanOrEqual(10);
  expect(back.poses.every((pose) => pose.x === 0)).toBe(true);
});
