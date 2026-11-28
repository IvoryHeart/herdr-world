import { clock } from "../../clock";
/**
 * Town's time of day. It follows this device's clock, or holds the day, dusk
 * or night the user picked in the sky menu under the zoom controls; the
 * choice is kept per browser. The renderer's lighting (townLighting.ts) reads
 * the sky: how the scene is tinted and how strongly lamps and rooms light it.
 * Its atmosphere (townAtmosphere.ts) reads the sun: where buildings' shadows
 * fall and how strongly, and how much cloud shadow drifts over the land.
 * Weather (townWeather.ts) changes the same sky: it greys and darkens it,
 * hides the sun, and adds rain, snow, wind, fog and wet or snowy ground.
 */

import { worldLocalStorage } from "../../browserStorage";

export type TownDaylightMode = "clock" | "day" | "dusk" | "night";

/** The sky menu's time choices, in order. */
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

/**
 * The hour the town shows, 0–24, from the injected wall clock.
 */
export function townDaylightHour(
  current: TownDaylightMode = townDaylightMode(),
  now = new Date(clock.now()),
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
  /** The sun's strength: its shadows and drifting cloud shadows, 0 at night. */
  sun: number;
  /** Where a building's shadow falls from it, in world pixels. */
  shadowX: number;
  shadowY: number;
  /** How strongly cloud shadows show on the land; the sun's, without weather. */
  clouds: number;
  /** How fast clouds drift, as a multiple of a still day's. */
  wind: number;
  /** Falling rain and snow, and wind gusts over the ground, 0–1 each. */
  rain: number;
  snow: number;
  gusts: number;
  /** Still weather on the ground: a wet street, snow lying, fog, 0–1 each. */
  wet: number;
  cover: number;
  fog: number;
};

/** A sky without weather: what each weather field is when none shows. */
export const TOWN_NO_WEATHER = {
  wind: 1,
  rain: 0,
  snow: 0,
  gusts: 0,
  wet: 0,
  cover: 0,
  fog: 0,
} as const;

/** [hour, ambient colour, lights, sun]; the sky eases between neighbours. */
const KEYS: readonly (readonly [number, number, number, number])[] = [
  [0, 0x48538f, 1, 0],
  [5, 0x4a5590, 1, 0],
  [6.4, 0xc59aa6, 0.55, 0.25],
  [8, 0xfff0dc, 0, 0.8],
  [12, 0xffffff, 0, 1],
  [16.5, 0xfff3de, 0, 0.9],
  [18.4, 0xffc08a, 0.3, 0.7],
  [19.4, 0xa87aa0, 0.85, 0.2],
  [20.6, 0x525a96, 1, 0],
  [24, 0x48538f, 1, 0],
];

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The sky at an hour: its colour, how much artificial light shows, the sun. */
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
  // The sun rises on the right and sets on the left, so shadows sweep from
  // left to right through the day: short at noon, long toward both ends, and
  // always falling a little toward the viewer.
  const day = Math.min(1, Math.max(0, (h - 6) / 14));
  const length = 9 + 30 * ((day - 0.5) * 2) ** 2;
  const sun = mix(a[3], b[3], s);
  return {
    r: channel(16),
    g: channel(8),
    b: channel(0),
    lights: mix(a[2], b[2], s),
    sun,
    shadowX: (day - 0.5) * 2 * length,
    shadowY: 5 + length * 0.35,
    clouds: sun,
    ...TOWN_NO_WEATHER,
  };
}

/** Whether the sky leaves the scene exactly as painted (full daylight). */
export const townSkyIsClear = (sky: TownSky) =>
  sky.lights <= 0.001 && sky.r >= 0.999 && sky.g >= 0.999 && sky.b >= 0.999;

/** Shadows are measured in world pixels, wind as a multiple, the rest 0–1. */
const SKY_UNIT: Partial<Record<keyof TownSky, number>> = {
  shadowX: 40,
  shadowY: 40,
  wind: 4,
};

/**
 * One frame of the sky easing toward `target` after a change of mode;
 * `moving` while it is still visibly on its way.
 */
export function townSkyToward(current: TownSky, target: TownSky, dt: number) {
  const k = 1 - Math.exp(-dt * 4);
  const next = { ...current };
  let far = 0;
  for (const key of Object.keys(target) as (keyof TownSky)[]) {
    next[key] = current[key] + (target[key] - current[key]) * k;
    far = Math.max(
      far,
      Math.abs(target[key] - next[key]) / (SKY_UNIT[key] ?? 1),
    );
  }
  return far < 0.004
    ? { sky: target, moving: false }
    : { sky: next, moving: true };
}
