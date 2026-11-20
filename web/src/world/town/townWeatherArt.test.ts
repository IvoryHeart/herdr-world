import { expect, test } from "bun:test";
import {
  TOWN_GUSTS_MAX,
  TOWN_RAIN_MAX,
  TOWN_SNOW_MAX,
  townFallCount,
  townGustAt,
  townPuddles,
  townRainAt,
  townRainSlant,
  townSnowAt,
} from "./townWeatherArt";
import { layoutTown, TOWN_TILE as T, TownGround } from "./townLayout";
import { townModelFromProjection } from "./townModel";
import { office } from "./scene/townScene.fixture";

const layout = layoutTown(
  townModelFromProjection(
    office({ a: ["working", "idle"], b: ["idle"], c: ["done", "blocked"] }),
  ).input,
  "wide",
).layout;

test("puddles lie only on roads and squares, and few of them", () => {
  const puddles = townPuddles(layout);
  expect(puddles.length).toBeGreaterThan(0);
  expect(puddles.length).toBeLessThanOrEqual(36);
  for (const p of puddles) {
    const ground =
      layout.ground[Math.floor(p.y / T) * layout.width + Math.floor(p.x / T)];
    expect([TownGround.road, TownGround.plaza]).toContain(ground!);
  }
  expect(townPuddles(layout)).toEqual(puddles);
});

test("as many drops as the screen holds, never more than the cap", () => {
  // A laptop's screen shows the full cap; a phone's, fewer.
  expect(townFallCount(1, 1512, 982, TOWN_RAIN_MAX)).toBe(TOWN_RAIN_MAX);
  expect(townFallCount(1, 3840, 2160, TOWN_RAIN_MAX)).toBe(TOWN_RAIN_MAX);
  const phone = townFallCount(1, 390, 844, TOWN_RAIN_MAX);
  expect(phone).toBeGreaterThan(20);
  expect(phone).toBeLessThan(TOWN_RAIN_MAX / 3);
  // Lighter weather, fewer; none for a trace.
  expect(townFallCount(0.4, 1512, 982, TOWN_SNOW_MAX)).toBeLessThan(
    TOWN_SNOW_MAX / 2,
  );
  expect(townFallCount(0.01, 1512, 982, TOWN_GUSTS_MAX)).toBe(0);
});

test("rain, snow and gusts stay on the screen and move on", () => {
  const [w, h] = [800, 600];
  for (let i = 0; i < 40; i += 1)
    for (const t of [0, 1.3, 17, 600]) {
      const rain = townRainAt(i, t, w, h, 2);
      expect(rain.x).toBeGreaterThanOrEqual(0);
      expect(rain.x).toBeLessThan(w);
      expect(rain.y).toBeGreaterThanOrEqual(-20);
      expect(rain.y).toBeLessThan(h + 20);
      const flake = townSnowAt(i, t, w, h, 1.2);
      expect(flake.x).toBeGreaterThanOrEqual(0);
      expect(flake.x).toBeLessThan(w);
      expect(flake.size).toBeGreaterThan(0.6);
      const gust = townGustAt(i, t, w, h);
      expect(gust.fade).toBeGreaterThanOrEqual(0);
      expect(gust.fade).toBeLessThanOrEqual(1);
    }
  // Rain falls fast, snow slowly.
  const fell = (at: (t: number) => { y: number }) => at(0.1).y - at(0).y;
  expect(fell((t) => townRainAt(3, t, w, h, 1))).toBeGreaterThan(10);
  const flakeFall = fell((t) => townSnowAt(3, t, w, h, 1));
  expect(flakeFall).toBeGreaterThan(0);
  expect(flakeFall).toBeLessThan(5);
  // Wind slants the rain, but never flat.
  expect(townRainSlant(0.6)).toBe(0);
  expect(townRainSlant(2.6)).toBeGreaterThan(0.05);
  expect(townRainSlant(20)).toBeLessThanOrEqual(0.5);
});
