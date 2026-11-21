/**
 * Town's weather. By default Town follows the real weather at the place set
 * in Integrations → Weather (worldSources.ts); a person can instead hold one
 * weather, or turn weather off, in the sky menu under the zoom controls. The
 * choice is kept per browser, like the time of day (townDaylight.ts).
 *
 * Weather changes the sky the rest of Town already reads: it greys and
 * darkens the light, hides the sun's shadows, speeds the clouds, and adds
 * rain, snow, wind gusts, fog and wet or snowy ground (townAtmosphere.ts and
 * townWeatherArt.ts draw them). Light stays Town's status language: the
 * darker the weather, the more rooms, desks and lamps light up by day, so a
 * lit room or a desk's state reads as clearly in a storm as in sun, and the
 * waiting reception's amber is drawn over everything as before.
 *
 * With weather off, or the real weather unavailable or out of date, the sky
 * is exactly the time of day's: Town looks as it did without weather.
 *
 * Everything here but the small stores is pure.
 */

import { worldLocalStorage } from "../../browserStorage";
import {
  WEATHER_CONDITIONS,
  type WeatherCondition,
  type WeatherSnapshot,
  unavailableWeather,
} from "../../../../shared/weather";
import {
  subscribeTownDaylight,
  townDaylightHour,
  townDaylightMode,
  townSky,
  townSkyToward,
  type TownSky,
} from "./townDaylight";

/** Follow the real weather, hold one, or show none. */
export type TownWeatherMode = "real" | WeatherCondition | "off";

/** The sky menu's weather choices, in order. */
export const TOWN_WEATHER_MODES: readonly TownWeatherMode[] = [
  "real",
  ...WEATHER_CONDITIONS,
  "off",
];

export const TOWN_WEATHER_LABEL: Record<TownWeatherMode, string> = {
  real: "Real weather",
  clear: "Clear",
  cloudy: "Cloud",
  rain: "Rain",
  snow: "Snow",
  fog: "Fog",
  storm: "Storm",
  wind: "Wind",
  off: "No weather",
};

export const TOWN_WEATHER_KEY = "townWeather.v1";

/** How strong a held weather is (the real one says its own). */
export const TOWN_HELD_INTENSITY = 0.65;
/** Real weather never shows fainter than this, so it reads as itself. */
const REAL_MIN_INTENSITY = 0.3;

const isMode = (value: unknown): value is TownWeatherMode =>
  (TOWN_WEATHER_MODES as readonly unknown[]).includes(value);

let mode: TownWeatherMode | null = null;
let real: WeatherSnapshot = unavailableWeather("disabled");
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function townWeatherMode(): TownWeatherMode {
  if (mode === null) {
    const saved = worldLocalStorage.getItem(TOWN_WEATHER_KEY);
    mode = isMode(saved) ? saved : "real";
  }
  return mode;
}

export function setTownWeatherMode(next: TownWeatherMode) {
  if (next === townWeatherMode()) return;
  mode = next;
  try {
    worldLocalStorage.setItem(TOWN_WEATHER_KEY, next);
  } catch {
    // Storage refused (a private window): the choice lasts for this page.
  }
  notify();
}

/** The service's latest reading (worldSources.ts); Town reads it from here. */
export function townRealWeather() {
  return real;
}

const readingKey = (snapshot: WeatherSnapshot) =>
  [
    snapshot.state,
    snapshot.reason,
    snapshot.current?.condition,
    snapshot.current?.temperatureC,
    snapshot.current?.intensity,
    snapshot.expiresAt,
    snapshot.location?.label,
  ].join("|");

export function setTownRealWeather(next: WeatherSnapshot) {
  // The same reading again (each poll sends one) changes nothing.
  if (readingKey(next) === readingKey(real)) return;
  real = next;
  notify();
}

/** Called when the mode or the real reading changes. */
export function subscribeTownWeather(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests: forget the mode and reading; the next read loads from storage. */
export function resetTownWeatherForTest() {
  mode = null;
  real = unavailableWeather("disabled");
  listeners.clear();
}

export type TownWeather = { condition: WeatherCondition; intensity: number };

/**
 * The real reading, when it may be drawn: available, with current conditions
 * that have not expired.
 */
export function townUsableWeather(
  snapshot: WeatherSnapshot,
  now = Date.now(),
): TownWeather | null {
  const current = snapshot.current;
  if (snapshot.state !== "available" || !current) return null;
  if (snapshot.expiresAt === null || snapshot.expiresAt <= now) return null;
  return {
    condition: current.condition,
    intensity: Math.min(
      1,
      Math.max(REAL_MIN_INTENSITY, Number(current.intensity) || 0),
    ),
  };
}

/** The weather Town shows now, or none. */
export function townWeatherShown(
  current: TownWeatherMode = townWeatherMode(),
  snapshot: WeatherSnapshot = real,
  now = Date.now(),
): TownWeather | null {
  if (current === "off") return null;
  if (current === "real") return townUsableWeather(snapshot, now);
  return { condition: current, intensity: TOWN_HELD_INTENSITY };
}

/** How a weather changes the sky; every field is applied by townWeatherSky. */
export type TownWeatherLook = {
  /** The colour the light is multiplied toward, and how far. */
  tint: number;
  shade: number;
  /** How much of the sun's building shadows it hides, 0–1. */
  sunCut: number;
  /** Cloud shadows, as a multiple of a still day's (0: none). */
  clouds: number;
  wind: number;
  /** Artificial light it brings up by day, 0–1, so status keeps reading. */
  lift: number;
  rain: number;
  snow: number;
  gusts: number;
  wet: number;
  cover: number;
  fog: number;
};

const NONE: TownWeatherLook = {
  tint: 0xffffff,
  shade: 0,
  sunCut: 0,
  clouds: 1,
  wind: 1,
  lift: 0,
  rain: 0,
  snow: 0,
  gusts: 0,
  wet: 0,
  cover: 0,
  fog: 0,
};

/** Each weather's look at intensity `i` (0–1). */
export function townWeatherLook(weather: TownWeather | null): TownWeatherLook {
  if (!weather) return NONE;
  const i = Math.min(1, Math.max(0, weather.intensity));
  switch (weather.condition) {
    case "clear":
      // Clear sky: full sun and no drifting cloud shadow.
      return { ...NONE, clouds: 0 };
    case "cloudy":
      return {
        ...NONE,
        tint: 0xb9c0cc,
        shade: 0.25 + 0.35 * i,
        sunCut: 0.45 + 0.45 * i,
        clouds: 1.4 + 1.2 * i,
        wind: 1.4,
        lift: 0.1 + 0.15 * i,
      };
    case "rain":
      return {
        ...NONE,
        tint: 0x9aa6b8,
        shade: 0.35 + 0.3 * i,
        sunCut: 0.85,
        clouds: 0.6,
        wind: 1.6,
        lift: 0.3 + 0.15 * i,
        rain: 0.35 + 0.65 * i,
        wet: 0.5 + 0.5 * i,
      };
    case "storm":
      return {
        ...NONE,
        tint: 0x7d879c,
        shade: 0.5 + 0.25 * i,
        sunCut: 1,
        clouds: 0.5,
        wind: 2.6,
        lift: 0.5 + 0.2 * i,
        rain: 0.7 + 0.3 * i,
        gusts: 0.3,
        wet: 1,
      };
    case "snow":
      return {
        ...NONE,
        tint: 0xdfe6f2,
        shade: 0.2 + 0.15 * i,
        sunCut: 0.7,
        clouds: 0.4,
        wind: 1.2,
        lift: 0.15,
        snow: 0.35 + 0.65 * i,
        cover: 0.45 + 0.5 * i,
      };
    case "fog":
      return {
        ...NONE,
        tint: 0xc9ced6,
        shade: 0.35 + 0.2 * i,
        sunCut: 0.9,
        clouds: 0,
        wind: 0.6,
        lift: 0.3 + 0.1 * i,
        fog: 0.45 + 0.55 * i,
      };
    case "wind":
      return {
        ...NONE,
        tint: 0xe8edf4,
        shade: 0.08,
        sunCut: 0.15,
        clouds: 1.3,
        wind: 2.5 + 2.5 * i,
        gusts: 0.4 + 0.6 * i,
      };
  }
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** The time of day's sky under a weather's look. */
export function townWeatherSky(sky: TownSky, look: TownWeatherLook): TownSky {
  const channel = (value: number, shift: number) =>
    value * mix(1, ((look.tint >> shift) & 255) / 255, look.shade);
  return {
    ...sky,
    r: channel(sky.r, 16),
    g: channel(sky.g, 8),
    b: channel(sky.b, 0),
    lights: 1 - (1 - sky.lights) * (1 - look.lift),
    sun: sky.sun * (1 - look.sunCut),
    clouds: sky.clouds * look.clouds,
    wind: look.wind,
    rain: look.rain,
    snow: look.snow,
    gusts: look.gusts,
    wet: look.wet,
    cover: look.cover,
    fog: look.fog,
  };
}

/** Seconds between a storm's distant flashes. */
export const TOWN_STORM_FLASH_EVERY = 19;

/**
 * A storm's distant flash `clock` seconds on, 0–1: a soft brightening that
 * rises over a tenth of a second and fades over about a second, once every
 * TOWN_STORM_FLASH_EVERY seconds. Never a strobe.
 */
export function townStormFlash(clock: number) {
  const t =
    (((clock - 7) % TOWN_STORM_FLASH_EVERY) + TOWN_STORM_FLASH_EVERY) %
    TOWN_STORM_FLASH_EVERY;
  if (t < 0.1) return t / 0.1;
  return t < 1.3 ? Math.exp(-(t - 0.1) * 4) : 0;
}

/** When a storm next wants a frame for its flash, `clock` seconds on. */
export function townStormFlashFrame(clock: number) {
  const t =
    (((clock - 7) % TOWN_STORM_FLASH_EVERY) + TOWN_STORM_FLASH_EVERY) %
    TOWN_STORM_FLASH_EVERY;
  return t < 1.3 ? clock + 1 / 20 : clock + TOWN_STORM_FLASH_EVERY - t;
}

/** The sky lit by a flash of strength `flash`: at most a third brighter. */
export function townFlashSky(sky: TownSky, flash: number): TownSky {
  const lift = (value: number) => value + (1 - value) * 0.3 * flash;
  return { ...sky, r: lift(sky.r), g: lift(sky.g), b: lift(sky.b) };
}

/** The sky Town aims for now: the time of day under the weather shown. */
export function townSkyNow(now = new Date(Date.now())) {
  return townWeatherSky(
    townSky(townDaylightHour(townDaylightMode(), now)),
    townWeatherLook(townWeatherShown(townWeatherMode(), real, now.getTime())),
  );
}

/**
 * The renderer's sky: it eases toward a newly chosen time or weather, adds a
 * storm's flash, and asks to be looked at again while it follows the clock or
 * the real weather. `request` wakes a frame when a choice or reading changes.
 */
export function createTownSky(request: (reason: string) => void) {
  let sky = townSkyNow();
  let easing = false;
  const change = (reason: string) => () => {
    easing = true;
    request(reason);
  };
  const stops = [
    subscribeTownDaylight(change("daylight")),
    subscribeTownWeather(change("weather")),
  ];
  return {
    /**
     * This frame's sky; `moving` while it eases, `recheck` when it should be
     * looked at again (seconds from now), or null when it holds still, and
     * `flashAt`, the clock time a storm's flash next wants a frame.
     */
    frame(dt: number, clock: number, animated: boolean) {
      const target = townSkyNow();
      let moving = false;
      if (easing && animated)
        ({ sky, moving } = townSkyToward(sky, target, dt));
      else sky = target;
      easing = moving;
      const stormy = animated && townWeatherShown()?.condition === "storm";
      const storm = stormy ? townStormFlash(clock) : 0;
      const following =
        townDaylightMode() === "clock" || townWeatherMode() === "real";
      return {
        sky: storm > 0.001 ? townFlashSky(sky, storm) : sky,
        moving,
        recheck: following ? 60 : null,
        flashAt: stormy ? townStormFlashFrame(clock) : null,
      };
    },
    dispose() {
      for (const stop of stops) stop();
    },
  };
}
