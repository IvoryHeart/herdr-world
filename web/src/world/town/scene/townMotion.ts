/**
 * How Town's movers move. Every mover (vehicles now; agents and bots later)
 * has a character: its cruising speed and how hard it speeds up and slows
 * down. A run is planned from the character, a distance and how it starts
 * and ends (at rest, or already moving), and gives the distance covered at
 * any time. Runs that must end at a set time (a bus due at its stop, or off
 * the map when its close commits) take the character's acceleration and
 * deceleration and derive the cruising speed from the distance and the time.
 * World pixels and milliseconds; pure, so a scene can sample it per frame.
 */

export type MoverCharacter = {
  /** Cruising speed, px/s, for runs with no set time. */
  speed: number;
  /** Speeding up from rest, px/s². */
  accel: number;
  /** Slowing to a stop, px/s². */
  decel: number;
};

/** Town's red double-decker: unhurried, slow to pull away, gentle stops. */
export const BUS_CHARACTER: MoverCharacter = {
  speed: 80,
  accel: 30,
  decel: 40,
};

export type MoverRun = {
  /** The run's length, px. */
  distance: number;
  /** Its time, ms. */
  duration: number;
  /** Distance covered `t` ms in (clamped to the run). */
  at(t: number): number;
  /** Speed `t` ms in, px/s. */
  speedAt(t: number): number;
};

type Ends = {
  /** Starts at rest (speeds up first) or already moving at cruise. */
  from: "rest" | "moving";
  /** Ends at rest (slows down last) or still moving. */
  to: "rest" | "moving";
};

/**
 * A run of `distance` px. With `duration` the cruise speed is derived so it
 * ends exactly then; without, it cruises at the character's speed.
 */
export function moverRun(
  character: MoverCharacter,
  distance: number,
  ends: Ends,
  duration?: number,
): MoverRun {
  const d = Math.max(0, distance);
  const a = ends.from === "rest" ? character.accel : Infinity;
  const b = ends.to === "rest" ? character.decel : Infinity;
  // Time spent changing speed, per unit of cruise speed, and the distance it
  // covers per unit of speed squared.
  const ramp = (a === Infinity ? 0 : 1 / a) + (b === Infinity ? 0 : 1 / b);
  const rampDistance = ramp / 2;
  let v: number;
  let T: number;
  if (duration === undefined) {
    // Untimed: cruise at the character's speed, or less on a short run.
    v = Math.min(
      character.speed,
      ramp ? Math.sqrt(d / rampDistance) : character.speed,
    );
    T = (v ? d / v + (ramp * v) / 2 : 0) * 1000;
  } else {
    T = Math.max(0, duration);
    const s = T / 1000;
    // d = v·s − v²·ramp/2  →  the smaller root is the slower, smoother run.
    const disc = s * s - 2 * ramp * d;
    if (ramp && disc < 0)
      // Too little time to cruise: it only speeds up and slows down, in the
      // character's proportion, as hard as it takes to be on time.
      return rampOnly(d, T, a === Infinity ? 0 : 1 / a / ramp);
    v = ramp ? (s - Math.sqrt(disc)) / ramp : s ? d / s : 0;
  }
  const ta = a === Infinity ? 0 : v / a;
  const tb = b === Infinity ? 0 : v / b;
  const s = T / 1000;
  const tc = Math.max(0, s - ta - tb);
  const da = (v * ta) / 2;
  const dc = v * tc;
  const at = (ms: number) => {
    const t = Math.min(s, Math.max(0, ms / 1000));
    if (t <= ta) return ta ? (v * t * t) / (2 * ta) : 0;
    if (t <= ta + tc) return da + v * (t - ta);
    const u = t - ta - tc;
    return Math.min(d, da + dc + v * u - (tb ? (v * u * u) / (2 * tb) : 0));
  };
  const speedAt = (ms: number) => {
    const t = Math.min(s, Math.max(0, ms / 1000));
    if (t < ta) return (v * t) / ta;
    if (t <= ta + tc) return v;
    return tb ? v * Math.max(0, 1 - (t - ta - tc) / tb) : v;
  };
  return { distance: d, duration: T, at, speedAt };
}

/**
 * A run with no time to cruise: it speeds up for `share` of its time, then
 * slows down, peaking at the speed that covers `d` in time.
 */
function rampOnly(d: number, T: number, share: number): MoverRun {
  const s = T / 1000;
  const ta = s * share;
  const tb = s - ta;
  const peak = s ? (2 * d) / s : 0;
  const at = (ms: number) => {
    const t = Math.min(s, Math.max(0, ms / 1000));
    if (t <= ta) return ta ? (peak * t * t) / (2 * ta) : 0;
    const u = t - ta;
    return Math.min(
      d,
      (peak * ta) / 2 + peak * u - (tb ? (peak * u * u) / (2 * tb) : 0),
    );
  };
  const speedAt = (ms: number) => {
    const t = Math.min(s, Math.max(0, ms / 1000));
    if (t < ta) return (peak * t) / ta;
    return tb ? peak * Math.max(0, 1 - (t - ta) / tb) : peak;
  };
  return { distance: d, duration: T, at, speedAt };
}
