import { expect, test } from "bun:test";
import {
  normalizeWeatherSettings,
  parseWeatherSnapshot,
  WEATHER_MAX_AGE_MS,
} from "./weather";
const at = 1795089600000;
const point = {
  at,
  condition: "clear",
  intensity: 0,
  temperatureC: 10,
  isDay: false,
};
const snapshot = {
  state: "available",
  location: { latitude: 1, longitude: 2, label: "Example" },
  current: point,
  nextHours: [],
  readAt: at,
  expiresAt: at + 1000,
};
test("small weather wire value drops malformed, unknown, overlong and partial observations", () => {
  expect(parseWeatherSnapshot(snapshot).current).toEqual(point);
  for (const changed of [
    { current: { ...point, condition: "hail" } },
    { current: { ...point, intensity: 2 } },
    { current: { ...point, temperatureC: null } },
    { current: null },
    { expiresAt: at + WEATHER_MAX_AGE_MS + 1 },
    { location: { latitude: 91, longitude: 1, label: "Bad" } },
  ])
    expect(parseWeatherSnapshot({ ...snapshot, ...changed }).state).toBe(
      "unavailable",
    );
  const future = { ...point, at: at + 3600000 };
  expect(
    parseWeatherSnapshot({
      ...snapshot,
      nextHours: [point, future, { ...future, at: at + 7 * 3600000 }],
    }).nextHours,
  ).toEqual([future]);
  expect(parseWeatherSnapshot(undefined).state).toBe("unavailable");
});
test("only explicit true enables Weather and unknown configuration keys refuse", () => {
  expect(normalizeWeatherSettings(undefined).enabled).toBe(false);
  for (const p of [
    { enabled: 1 },
    { provider: "other" },
    { location: "invalid\nplace" },
    { location: "1,2,3" },
    { browserLocation: { latitude: 1, longitude: -181 } },
  ])
    expect(() => normalizeWeatherSettings(p)).toThrow();
});
