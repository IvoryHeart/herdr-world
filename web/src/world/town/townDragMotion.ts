/**
 * How a dragged desk or agent ghost moves through its phases. Pure, so the
 * renderer only draws the returned pose.
 *
 * drag (lifts off and springs after the pointer) → park (eases onto the
 * target while the move runs) → land (drops, bounces and raises dust on the
 * target), back (shakes, then springs home) or fade (in place, for an
 * uncertain move). Every phase that ends a drag starts from the pose last
 * drawn, so the outcome continues from the parked ghost instead of jumping
 * back to the drop point.
 *
 * `quiet` (reduced motion or calm mode) keeps the ghost under the pointer and
 * ends every drag with a short fade: no spring, sway, bounce or shake.
 */

export type TownDragPose = {
  x: number;
  y: number;
  tilt: number;
  alpha: number;
  scale: number;
  /** Height off the ground: 0 standing on it, 1 carried. */
  lift: number;
  /** Width over height, around 1: above 1 squashed flat, below stretched. */
  squash: number;
};

type From = { t: number; from: TownDragPose };

export type TownDragPhase =
  | { name: "drag"; t: number }
  | ({ name: "park" } & From)
  | ({ name: "back" } & From)
  | ({ name: "fade" } & From)
  | ({ name: "land"; landed: boolean } & From);

export type TownDragMotion = {
  /** The pointer position (drop point once released). */
  x: number;
  y: number;
  home: { x: number; y: number };
  target: { x: number; y: number; w: number; h: number } | null;
  phase: TownDragPhase;
  /** The pose drawn on the last frame. */
  shown: TownDragPose;
  /** The carried ghost's velocity, px/s, and its smoothed lean. */
  vx: number;
  vy: number;
  lean: number;
};

/** A pose at rest on the ground, before any lift. */
export const townGroundedPose = (x: number, y: number): TownDragPose => ({
  x,
  y,
  tilt: 0,
  alpha: 1,
  scale: 1,
  lift: 0,
  squash: 1,
});

/** Seconds: lifting off, falling onto the target, a whole landing, shaking. */
const LIFT = 0.22;
const FALL = 0.16;
const LANDING = 0.52;
const SHAKE = 0.24;
const QUIET_FADE = 0.15;
/** The carry spring: stiff enough to keep up, damped just short of critical. */
const STIFFNESS = 240;
const DAMPING = 2 * Math.sqrt(STIFFNESS) * 0.72;

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(high, value));
const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
/** Ease out past the end and back: a little pop. */
const easeBack = (t: number) => {
  const u = clamp(t, 0, 1) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
};
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Start a phase that ends or parks the drag from the pose last drawn. */
export function townDragPhase(
  motion: TownDragMotion,
  name: "park" | "back" | "fade" | "land",
): TownDragPhase {
  const from = { ...motion.shown };
  return name === "land"
    ? { name, t: 0, from, landed: false }
    : { name, t: 0, from };
}

/** Where a parked or landing ghost rests: the target, else where it is. */
function restingPoint(motion: TownDragMotion, from: TownDragPose) {
  const target = motion.target;
  return target
    ? { x: target.x + target.w / 2, y: target.y + target.h / 2 - 8 }
    : { x: from.x, y: from.y };
}

/** Spring the carried ghost toward the pointer, in small steady steps. */
function carry(motion: TownDragMotion, dt: number) {
  let { x, y } = motion.shown;
  for (let left = dt; left > 1e-6; left -= 1 / 120) {
    const step = Math.min(left, 1 / 120);
    motion.vx += (STIFFNESS * (motion.x - x) - DAMPING * motion.vx) * step;
    motion.vy += (STIFFNESS * (motion.y - y) - DAMPING * motion.vy) * step;
    x += motion.vx * step;
    y += motion.vy * step;
  }
  return { x, y };
}

/**
 * Advance one frame. Returns the pose to draw, whether the drag is over, and
 * whether a landing touched down this frame (the moment for its dust).
 */
export function stepTownDrag(
  motion: TownDragMotion,
  dt: number,
  clock: number,
  quiet: boolean,
): { pose: TownDragPose; done: boolean; landed: boolean } {
  const phase = motion.phase;
  let pose: TownDragPose = { ...motion.shown };
  let done = false;
  let landed = false;
  if (phase.name === "drag") {
    phase.t += dt;
    if (quiet) {
      motion.vx = 0;
      motion.vy = 0;
      motion.lean = 0;
      pose = { ...townGroundedPose(motion.x, motion.y), lift: 1 };
    } else {
      const { x, y } = carry(motion, dt);
      const k = phase.t / LIFT;
      // Lean into the motion, sway a little with speed, and wobble once on
      // pick-up.
      const speed = Math.hypot(motion.vx, motion.vy);
      const lean = clamp(motion.vx * 0.0011, -0.3, 0.3);
      const sway = Math.sin(clock * 7) * 0.04 * Math.min(1, speed / 300);
      const wobble = 0.1 * Math.sin(phase.t * 24) * Math.exp(-phase.t * 8);
      motion.lean = lerp(motion.lean, lean + sway, Math.min(1, dt * 12));
      pose = {
        x,
        y,
        tilt: wobble + motion.lean,
        alpha: 1,
        scale: 1 + 0.06 * easeBack(k),
        lift: easeBack(k),
        // Stretch tall on the way up, then settle.
        squash: 1 - 0.1 * Math.sin(clamp(k, 0, 1) * Math.PI),
      };
    }
  } else if (phase.name === "park") {
    phase.t += dt * (quiet ? 20 : 1);
    const k = ease(phase.t / 0.35);
    const rest = restingPoint(motion, phase.from);
    const bob = quiet ? 0 : Math.sin(clock * 5) * 2;
    pose = {
      x: lerp(phase.from.x, rest.x, k),
      y: lerp(phase.from.y, rest.y, k) + bob * k,
      tilt: phase.from.tilt * (1 - k),
      alpha: lerp(phase.from.alpha, 0.7, k),
      scale: lerp(phase.from.scale, 1.03, k),
      lift: lerp(phase.from.lift, quiet ? 1 : 0.6, k),
      squash: lerp(phase.from.squash, 1, k),
    };
  } else if (phase.name === "land") {
    phase.t += dt;
    const rest = restingPoint(motion, phase.from);
    if (quiet) {
      // Set it down and fade: no fall, bounce or dust.
      const k = phase.t / QUIET_FADE;
      pose = {
        ...townGroundedPose(rest.x, rest.y),
        alpha: phase.from.alpha * Math.max(0, 1 - k),
      };
      landed = !phase.landed;
      phase.landed = true;
      done = k >= 1;
    } else {
      const fall = clamp(phase.t / FALL, 0, 1);
      const since = phase.t - FALL;
      // Falls faster as it drops, then squashes on touch-down and springs
      // back to its shape before fading into the desk drawn there.
      pose = {
        x: lerp(phase.from.x, rest.x, ease(fall)),
        y: lerp(phase.from.y, rest.y, ease(fall)),
        tilt: phase.from.tilt * (1 - fall),
        alpha:
          phase.t < LANDING - 0.14
            ? lerp(phase.from.alpha, 1, fall)
            : Math.max(0, (LANDING - phase.t) / 0.14),
        scale: lerp(phase.from.scale, 1, fall),
        lift: phase.from.lift * (1 - fall * fall),
        squash:
          since < 0
            ? 0.94
            : 1 + 0.24 * Math.exp(-since * 9) * Math.cos(since * 26),
      };
      if (since >= 0 && !phase.landed) {
        phase.landed = true;
        landed = true;
      }
      done = phase.t >= LANDING;
    }
  } else if (phase.name === "back") {
    phase.t += dt;
    if (quiet) {
      const k = phase.t / QUIET_FADE;
      pose = { ...phase.from, alpha: phase.from.alpha * Math.max(0, 1 - k) };
      done = k >= 1;
    } else if (phase.t < SHAKE) {
      // A quick head-shake where it was refused.
      const shake = Math.sin(phase.t * 48) * (1 - phase.t / SHAKE);
      pose = {
        ...phase.from,
        x: phase.from.x + 5 * shake,
        tilt: phase.from.tilt + 0.06 * shake,
      };
    } else {
      const k = (phase.t - SHAKE) / 0.32;
      const home = easeBack(k);
      pose = {
        x: lerp(phase.from.x, motion.home.x, home),
        y: lerp(phase.from.y, motion.home.y, home),
        tilt: phase.from.tilt * (1 - ease(k)),
        alpha: lerp(phase.from.alpha, 1, ease(k)),
        scale: lerp(phase.from.scale, 1, ease(k)),
        lift: phase.from.lift * (1 - ease(k)),
        squash: 1,
      };
      done = k >= 1;
    }
  } else if (phase.name === "fade") {
    phase.t += (dt / 0.35) * (quiet ? 2 : 1);
    pose = {
      ...phase.from,
      alpha: phase.from.alpha * Math.max(0, 1 - phase.t),
    };
    done = phase.t >= 1;
  }
  motion.shown = pose;
  return { pose, done, landed };
}
