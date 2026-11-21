import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import {
  TOWN_DAYLIGHT_KEY,
  TOWN_DAYLIGHT_MODES,
  TOWN_NO_WEATHER,
  resetTownDaylightForTest,
  setTownDaylightMode,
  subscribeTownDaylight,
  townDaylightHour,
  townDaylightMode,
  townSky,
  townSkyIsClear,
  townSkyToward,
} from "./townDaylight";
import { worldLocalStorage } from "../../browserStorage";

const hadStorage = "localStorage" in globalThis;
beforeAll(() => {
  if (!hadStorage)
    Object.assign(globalThis, { localStorage: new Window().localStorage });
});
afterEach(() => {
  worldLocalStorage.removeItem(TOWN_DAYLIGHT_KEY);
  resetTownDaylightForTest();
});
afterAll(() => {
  if (!hadStorage) Reflect.deleteProperty(globalThis, "localStorage");
});

test("the sky menu offers clock, day, dusk and night; clock by default", () => {
  expect(townDaylightMode()).toBe("clock");
  expect(TOWN_DAYLIGHT_MODES).toEqual(["clock", "day", "dusk", "night"]);
});

test("the time of day's sky carries no weather", () => {
  for (const hour of [3, 9, 12, 18, 23]) {
    const sky = townSky(hour);
    expect(sky).toMatchObject(TOWN_NO_WEATHER);
    // Cloud shadows show as strongly as the sun.
    expect(sky.clouds).toBe(sky.sun);
  }
});

test("the chosen time of day persists across a reload", () => {
  let changes = 0;
  subscribeTownDaylight(() => (changes += 1));
  setTownDaylightMode("dusk");
  setTownDaylightMode("dusk");
  expect(changes).toBe(1);
  resetTownDaylightForTest();
  expect(townDaylightMode()).toBe("dusk");
  worldLocalStorage.setItem(TOWN_DAYLIGHT_KEY, "noon");
  resetTownDaylightForTest();
  expect(townDaylightMode()).toBe("clock");
});

test("clock follows this device's time; the other modes hold their hour", () => {
  const evening = new Date(2026, 10, 17, 21, 30);
  expect(townDaylightHour("clock", evening)).toBe(21.5);
  expect(townDaylightHour("day", evening)).toBe(12);
  expect(townDaylightHour("night", new Date(2026, 10, 17, 12))).toBe(23);
});

test("clock reads time through Date.now, so an installed test clock governs it", () => {
  const realNow = Date.now;
  Date.now = () => new Date(2026, 10, 17, 6, 15).getTime();
  try {
    expect(townDaylightHour("clock")).toBe(6.25);
  } finally {
    Date.now = realNow;
  }
});

test("day leaves the town as painted; night darkens it and lights its lamps", () => {
  const day = townSky(townDaylightHour("day"));
  expect(townSkyIsClear(day)).toBe(true);
  const dusk = townSky(townDaylightHour("dusk"));
  const night = townSky(townDaylightHour("night"));
  expect(townSkyIsClear(dusk)).toBe(false);
  expect(night.lights).toBe(1);
  expect(dusk.lights).toBeGreaterThan(0.3);
  expect(dusk.lights).toBeLessThan(1);
  // Night is darker than dusk, and blue.
  expect(night.r + night.g + night.b).toBeLessThan(dusk.r + dusk.g + dusk.b);
  expect(night.b).toBeGreaterThan(night.r);
  // The sky wraps at midnight without a seam.
  expect(townSky(0)).toEqual(townSky(24));
});

test("a change of mode eases the sky to its target and then rests", () => {
  const target = townSky(23);
  let sky = townSky(13);
  let frames = 0;
  for (let moving = true; moving; frames += 1)
    ({ sky, moving } = townSkyToward(sky, target, 1 / 60));
  expect(sky).toEqual(target);
  expect(frames).toBeGreaterThan(10);
  // The sun's shadows ease with the sky rather than jumping.
  ({ sky } = townSkyToward(townSky(8), townSky(18), 1 / 60));
  expect(sky.shadowX).toBeGreaterThan(townSky(8).shadowX);
  expect(sky.shadowX).toBeLessThan(townSky(18).shadowX);
  expect(frames).toBeLessThan(200);
});
