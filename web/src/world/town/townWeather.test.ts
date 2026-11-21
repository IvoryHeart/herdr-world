import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  WEATHER_CONDITIONS,
  type WeatherCondition,
  type WeatherSnapshot,
  unavailableWeather,
} from "../../../../shared/weather";
import { worldLocalStorage } from "../../browserStorage";
import { TOWN_NO_WEATHER, townDaylightHour, townSky } from "./townDaylight";
import {
  resetTownWeatherForTest,
  setTownRealWeather,
  setTownWeatherMode,
  subscribeTownWeather,
  TOWN_HELD_INTENSITY,
  TOWN_STORM_FLASH_EVERY,
  TOWN_WEATHER_KEY,
  TOWN_WEATHER_MODES,
  townFlashSky,
  townRealWeather,
  townStormFlash,
  townStormFlashFrame,
  townUsableWeather,
  townWeatherLook,
  townWeatherMode,
  townWeatherShown,
  townWeatherSky,
} from "./townWeather";

const hadStorage = "localStorage" in globalThis;
beforeAll(() => {
  if (!hadStorage)
    Object.assign(globalThis, { localStorage: new Window().localStorage });
});
afterEach(() => {
  worldLocalStorage.removeItem(TOWN_WEATHER_KEY);
  resetTownWeatherForTest();
});
afterAll(() => {
  if (!hadStorage) Reflect.deleteProperty(globalThis, "localStorage");
});

const NOW = Date.UTC(2026, 10, 19, 12);
const reading = (
  condition: WeatherCondition,
  intensity = 0.8,
  expiresAt: number | null = NOW + 600_000,
): WeatherSnapshot => ({
  state: "available",
  reason: null,
  location: { label: "Example City", latitude: 0, longitude: 0 },
  current: { condition, intensity, temperatureC: 7, isDay: true, at: NOW },
  nextHours: [],
  readAt: NOW,
  expiresAt,
});

const day = townSky(townDaylightHour("day"));
const dusk = townSky(townDaylightHour("dusk"));
const night = townSky(townDaylightHour("night"));

test("the sky menu offers real weather, each condition and none; real by default", () => {
  expect(townWeatherMode()).toBe("real");
  expect(TOWN_WEATHER_MODES).toEqual(["real", ...WEATHER_CONDITIONS, "off"]);
});

test("the chosen weather persists per browser and ignores unknown values", () => {
  let changes = 0;
  subscribeTownWeather(() => (changes += 1));
  setTownWeatherMode("snow");
  setTownWeatherMode("snow");
  expect(changes).toBe(1);
  resetTownWeatherForTest();
  expect(townWeatherMode()).toBe("snow");
  worldLocalStorage.setItem(TOWN_WEATHER_KEY, "hail");
  resetTownWeatherForTest();
  expect(townWeatherMode()).toBe("real");
});

test("a repeated reading wakes nobody; a new one does", () => {
  let changes = 0;
  subscribeTownWeather(() => (changes += 1));
  const rain = reading("rain");
  setTownRealWeather(rain);
  setTownRealWeather({ ...reading("rain") });
  expect(changes).toBe(1);
  expect(townRealWeather()).toBe(rain);
  setTownRealWeather(reading("snow"));
  expect(changes).toBe(2);
});

test("real weather shows only while available and fresh", () => {
  expect(townUsableWeather(reading("rain", 0.8), NOW)).toEqual({
    condition: "rain",
    intensity: 0.8,
  });
  // Faint readings still read as themselves; strong ones are capped.
  expect(townUsableWeather(reading("fog", 0.05), NOW)?.intensity).toBe(0.3);
  expect(townUsableWeather(reading("storm", 3), NOW)?.intensity).toBe(1);
  // Expired, without expiry, or unavailable: nothing shows.
  expect(townUsableWeather(reading("rain", 0.8, NOW - 1), NOW)).toBeNull();
  expect(townUsableWeather(reading("rain", 0.8, null), NOW)).toBeNull();
  for (const reason of [
    "disabled",
    "location_required",
    "provider_error",
  ] as const)
    expect(townUsableWeather(unavailableWeather(reason), NOW)).toBeNull();
});

test("held weather ignores the reading; off shows nothing", () => {
  const rain = reading("rain");
  expect(townWeatherShown("real", rain, NOW)?.condition).toBe("rain");
  expect(townWeatherShown("snow", rain, NOW)).toEqual({
    condition: "snow",
    intensity: TOWN_HELD_INTENSITY,
  });
  expect(townWeatherShown("snow", unavailableWeather(), NOW)?.condition).toBe(
    "snow",
  );
  expect(townWeatherShown("off", rain, NOW)).toBeNull();
});

test("with weather off or unavailable the sky is exactly the time of day's", () => {
  for (const sky of [day, dusk, night])
    expect(townWeatherSky(sky, townWeatherLook(null))).toEqual(sky);
  expect(day).toMatchObject(TOWN_NO_WEATHER);
});

test("each weather looks like itself", () => {
  const look = (condition: WeatherCondition, i = 0.7) =>
    townWeatherSky(day, townWeatherLook({ condition, intensity: i }));
  const brightness = (s: typeof day) => s.r + s.g + s.b;
  // Clear: full sun, no drifting cloud shadow, nothing falls.
  expect(look("clear")).toMatchObject({ sun: 1, clouds: 0, rain: 0, snow: 0 });
  // Cloud: greyer, softer shadows, more cloud shadow.
  expect(brightness(look("cloudy"))).toBeLessThan(brightness(day));
  expect(look("cloudy").sun).toBeLessThan(day.sun);
  expect(look("cloudy").clouds).toBeGreaterThan(day.clouds);
  // Rain: rain falls on a wet street.
  expect(look("rain").rain).toBeGreaterThan(0.5);
  expect(look("rain").wet).toBeGreaterThan(0.5);
  // Snow: flakes fall and snow lies; nothing wet.
  expect(look("snow").snow).toBeGreaterThan(0.5);
  expect(look("snow").cover).toBeGreaterThan(0.5);
  expect(look("snow").rain).toBe(0);
  // Fog: lies in the streets, no cloud shadows, still air.
  expect(look("fog").fog).toBeGreaterThan(0.5);
  expect(look("fog").clouds).toBe(0);
  expect(look("fog").wind).toBeLessThan(1);
  // Storm: darkest, heavy rain, gusts, no sun.
  expect(brightness(look("storm"))).toBeLessThan(brightness(look("rain")));
  expect(look("storm").rain).toBeGreaterThan(look("rain").rain);
  expect(look("storm").gusts).toBeGreaterThan(0);
  expect(look("storm").sun).toBe(0);
  // Wind: fast clouds and gusts under a nearly clear sky.
  expect(look("wind").wind).toBeGreaterThan(3);
  expect(look("wind").gusts).toBeGreaterThan(0.5);
  expect(look("wind").sun).toBeGreaterThan(0.8);
  // Stronger weather is more of itself.
  expect(look("rain", 1).rain).toBeGreaterThan(look("rain", 0.3).rain);
  expect(look("snow", 1).cover).toBeGreaterThan(look("snow", 0.3).cover);
});

test("dark weather lights rooms and lamps by day, so status keeps reading", () => {
  for (const condition of ["rain", "storm", "fog"] as const) {
    const sky = townWeatherSky(
      day,
      townWeatherLook({ condition, intensity: 1 }),
    );
    expect(sky.lights).toBeGreaterThan(day.lights + 0.3);
  }
  // At night the lights are already full; weather never dims them.
  for (const condition of WEATHER_CONDITIONS) {
    const sky = townWeatherSky(
      night,
      townWeatherLook({ condition, intensity: 1 }),
    );
    expect(sky.lights).toBeGreaterThanOrEqual(night.lights);
  }
});

test("a storm's flash is soft, brief and rare", () => {
  let lit = 0;
  let peak = 0;
  const step = 0.02;
  for (let t = 0; t < TOWN_STORM_FLASH_EVERY * 3; t += step) {
    const flash = townStormFlash(t);
    expect(flash).toBeGreaterThanOrEqual(0);
    expect(flash).toBeLessThanOrEqual(1);
    if (flash > 0.05) lit += step;
    peak = Math.max(peak, flash);
  }
  expect(peak).toBeGreaterThan(0.9);
  // Under a second and a half of light in each flash.
  expect(lit / 3).toBeLessThan(1.5);
  // A flash brightens at most a third of the way to white.
  const dark = { ...day, r: 0.4, g: 0.4, b: 0.4 };
  expect(townFlashSky(dark, 1).r).toBeCloseTo(0.4 + 0.6 * 0.3);
  // Between flashes the storm sleeps until the next one.
  const quiet = 3;
  expect(townStormFlash(quiet)).toBe(0);
  expect(townStormFlashFrame(quiet)).toBeCloseTo(7);
  // During one it asks for frames.
  expect(townStormFlashFrame(7.2)).toBeCloseTo(7.25);
});
