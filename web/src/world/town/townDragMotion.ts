/**
 * How a dragged desk or agent ghost moves through its phases. Pure, so the
 * renderer only draws the returned pose.
 *
 * drag → park (eases onto the target while the move runs) → land (pop on the
 * target), back (spring home) or fade (in place, for an uncertain move).
 * Every phase that ends a drag starts from the pose last drawn, so the
 * outcome continues from the parked ghost instead of jumping back to the
 * drop point.
 */

export type TownDragPose = {
  x: number;
  y: number;
  tilt: number;
  alpha: number;
  scale: number;
};

type From = { t: number; from: TownDragPose };

export type TownDragPhase =
  | { name: "drag" }
  | ({ name: "park" } & From)
  | ({ name: "back" } & From)
  | ({ name: "fade" } & From)
  | { name: "land"; t: number };

export type TownDragMotion = {
  /** The pointer position (drop point once released) and its tilt. */
  x: number;
  y: number;
  tilt: number;
  home: { x: number; y: number };
  target: { x: number; y: number; w: number; h: number } | null;
  phase: TownDragPhase;
  /** The pose drawn on the last frame. */
  shown: TownDragPose;
};

const ease = (t: number) => 1 - Math.pow(1 - Math.min(1, t), 3);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Start a phase that ends or parks the drag from the pose last drawn. */
export function townDragPhase(
  motion: TownDragMotion,
  name: "park" | "back" | "fade",
): TownDragPhase {
  return { name, t: 0, from: { ...motion.shown } };
}

/**
 * Advance one frame. Returns the pose to draw and whether the drag is over.
 * `quiet` (reduced motion or calm mode) runs the transitions almost at once.
 */
export function stepTownDrag(
  motion: TownDragMotion,
  dt: number,
  clock: number,
  quiet: boolean,
): { pose: TownDragPose; done: boolean } {
  const fast = quiet ? 20 : 1;
  const phase = motion.phase;
  let pose: TownDragPose = {
    x: motion.x,
    y: motion.y,
    tilt: motion.tilt,
    alpha: 1,
    scale: 1,
  };
  let done = false;
  const target = motion.target;
  if (phase.name === "back") {
    phase.t += (dt / 0.28) * fast;
    const k = ease(phase.t);
    pose = {
      x: lerp(phase.from.x, motion.home.x, k),
      y: lerp(phase.from.y, motion.home.y, k),
      tilt: phase.from.tilt * (1 - k),
      alpha: lerp(phase.from.alpha, 1, k),
      scale: 1,
    };
    done = phase.t >= 1;
  } else if (phase.name === "park" && target) {
    phase.t += dt * fast;
    const k = ease(phase.t / 0.35);
    const bob = quiet ? 0 : Math.sin(clock * 5) * 2;
    pose = {
      x: lerp(phase.from.x, target.x + target.w / 2, k),
      y: lerp(phase.from.y, target.y + target.h / 2 - 8, k) + bob * k,
      tilt: phase.from.tilt * (1 - k),
      alpha: lerp(phase.from.alpha, 0.7, k),
      scale: 1,
    };
  } else if (phase.name === "fade") {
    phase.t += (dt / 0.35) * fast;
    pose = {
      ...phase.from,
      alpha: phase.from.alpha * Math.max(0, 1 - phase.t),
    };
    done = phase.t >= 1;
  } else if (phase.name === "land" && target) {
    phase.t += (dt / 0.35) * fast;
    pose = {
      x: target.x + target.w / 2,
      y: target.y + target.h / 2 - 8 * (1 - phase.t),
      tilt: 0,
      alpha: Math.max(0, 1 - phase.t),
      scale: 1 + 0.15 * Math.sin(Math.min(1, phase.t) * Math.PI),
    };
    done = phase.t >= 1;
  }
  motion.shown = pose;
  return { pose, done };
}
