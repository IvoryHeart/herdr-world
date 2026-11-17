/**
 * Town's time of day. It follows this device's clock, or holds the day, dusk
 * or night the user picked with the button under the zoom controls; the
 * choice is kept per browser. The renderer's lighting (townLighting.ts) reads
 * the sky: how the scene is tinted and how strongly lamps and rooms light it.
 */

import { worldLocalStorage } from "../../browserStorage";

export type TownDaylightMode = "clock" | "day" | "dusk" | "night";

/** The button's cycle, in order. */
export const TOWN_DAYLIGHT_MODES: readonly TownDaylightMode[] = [
  "clock",
  "day",
  "dusk",
  "night",
];

export const TOWN_DAYLIGHT_KEY = "townDaylight.v1";

/** The hour each held mode shows. */
const HELD_HOUR: Record<Exclude<TownDaylightMode, "clock">, number> = {
  day: 12,
  dusk: 18.9,
  night: 23,
};

const isMode = (value: unknown): value is TownDaylightMode =>
  (TOWN_DAYLIGHT_MODES as readonly unknown[]).includes(value);

let mode: TownDaylightMode | null = null;
const listeners = new Set<() => void>();

export function townDaylightMode(): TownDaylightMode {
  if (mode === null) {
    const saved = worldLocalStorage.getItem(TOWN_DAYLIGHT_KEY);
    mode = isMode(saved) ? saved : "clock";
  }
  return mode;
}

export function setTownDaylightMode(next: TownDaylightMode) {
  if (next === townDaylightMode()) return;
  mode = next;
  try {
    worldLocalStorage.setItem(TOWN_DAYLIGHT_KEY, next);
  } catch {
    // Storage refused (a private window): the choice lasts for this page.
  }
  for (const listener of listeners) listener();
}

/** The mode after `current` in the button's cycle. */
export const townNextDaylightMode = (current: TownDaylightMode) =>
  TOWN_DAYLIGHT_MODES[
    (TOWN_DAYLIGHT_MODES.indexOf(current) + 1) % TOWN_DAYLIGHT_MODES.length
  ]!;

export function subscribeTownDaylight(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: forget the mode so the next read loads it from storage again. */
export function resetTownDaylightForTest() {
  mode = null;
  listeners.clear();
}

/** The hour the town shows, 0–24. */
export function townDaylightHour(
  current: TownDaylightMode = townDaylightMode(),
  now = new Date(),
) {
  return current === "clock"
    ? now.getHours() + now.getMinutes() / 60
    : HELD_HOUR[current];
}

export type TownSky = {
  /** What the whole scene is multiplied by, 0–1 per channel. */
  r: number;
  g: number;
  b: number;
  /** How strongly lamps and lit rooms light the town: 0 by day, 1 at night. */
  lights: number;
};

/** [hour, ambient colour, lights]; the sky eases between neighbours. */
const KEYS: readonly (readonly [number, number, number])[] = [
  [0, 0x48538f, 1],
  [5, 0x4a5590, 1],
  [6.4, 0xc59aa6, 0.55],
  [8, 0xfff0dc, 0],
  [12, 0xffffff, 0],
  [16.5, 0xfff3de, 0],
  [18.4, 0xffc08a, 0.3],
  [19.4, 0xa87aa0, 0.85],
  [20.6, 0x525a96, 1],
  [24, 0x48538f, 1],
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The sky at an hour: the ambient colour and how much artificial light shows. */
export function townSky(hour: number): TownSky {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1]![0] <= h) i += 1;
  const a = KEYS[i]!;
  const b = KEYS[i + 1]!;
  const t = Math.min(1, Math.max(0, (h - a[0]) / (b[0] - a[0])));
  const s = t * t * (3 - 2 * t);
  const channel = (shift: number) =>
    mix((a[1] >> shift) & 255, (b[1] >> shift) & 255, s) / 255;
  return {
    r: channel(16),
    g: channel(8),
    b: channel(0),
    lights: mix(a[2], b[2], s),
  };
}

/** Whether the sky leaves the scene exactly as painted (full daylight). */
export const townSkyIsClear = (sky: TownSky) =>
  sky.lights <= 0.001 && sky.r >= 0.999 && sky.g >= 0.999 && sky.b >= 0.999;

/**
 * One frame of the sky easing toward `target` after a change of mode;
 * `moving` while it is still visibly on its way.
 */
export function townSkyToward(current: TownSky, target: TownSky, dt: number) {
  const k = 1 - Math.exp(-dt * 4);
  const next = { ...current };
  let far = 0;
  for (const key of ["r", "g", "b", "lights"] as const) {
    next[key] = current[key] + (target[key] - current[key]) * k;
    far = Math.max(far, Math.abs(target[key] - next[key]));
  }
  return far < 0.004
    ? { sky: target, moving: false }
    : { sky: next, moving: true };
}
