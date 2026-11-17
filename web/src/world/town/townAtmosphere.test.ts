import { expect, test } from "bun:test";
import {
  TOWN_ATMOSPHERE_MAX_RATE,
  townAtmospherePlan,
  townAtmosphereRate,
  townCloudAt,
  townFireflyAt,
  townFireflyNight,
} from "./townAtmosphere";
import { townDaylightHour, townSky } from "./townDaylight";
import { TownLand, townLandscape } from "./townLandscape";
import { layoutTown, TOWN_FACADE, TOWN_TILE as T } from "./townLayout";
import { townModelFromProjection } from "./townModel";
import { office } from "./scene/townScene.fixture";

const layout = layoutTown(
  townModelFromProjection(
    office({ a: ["working", "idle"], b: ["idle"], c: ["done", "blocked"] }),
  ).input,
  "wide",
).layout;
const plan = townAtmospherePlan(layout);
const day = townSky(townDaylightHour("day"));
const dusk = townSky(townDaylightHour("dusk"));
const night = townSky(townDaylightHour("night"));

test("every building casts a shadow from its whole footprint", () => {
  expect(plan.shadows).toEqual(
    layout.buildings.map((b) => ({
      x: b.x * T,
      y: b.y * T,
      w: b.w * T,
      h: (b.h + TOWN_FACADE) * T,
    })),
  );
  expect(plan.lampHeads).toHaveLength(layout.lamps.length);
});

test("sun shadows swing with the hour and lengthen toward dawn and dusk", () => {
  const morning = townSky(8);
  const noon = townSky(12);
  const evening = townSky(18);
  // Morning shadows fall left, evening shadows right; noon's are short.
  expect(morning.shadowX).toBeLessThan(0);
  expect(evening.shadowX).toBeGreaterThan(0);
  expect(Math.abs(noon.shadowX)).toBeLessThan(Math.abs(morning.shadowX));
  expect(noon.shadowY).toBeLessThan(evening.shadowY);
  // They always fall a little toward the viewer.
  for (const sky of [morning, noon, evening])
    expect(sky.shadowY).toBeGreaterThan(0);
  // The sun is strongest at noon, low at dusk and gone at night.
  expect(day.sun).toBe(1);
  expect(dusk.sun).toBeGreaterThan(0.2);
  expect(dusk.sun).toBeLessThan(0.7);
  expect(night.sun).toBe(0);
});

test("fireflies keep to open grass, away from every building", () => {
  expect(plan.flies.length).toBeGreaterThan(10);
  const land = townLandscape(layout);
  for (const fly of plan.flies) {
    const tx = Math.floor(fly.x / T);
    const ty = Math.floor(fly.y / T);
    expect([TownLand.meadow, TownLand.lawn]).toContain(
      land.surface(tx, ty) as never,
    );
    for (const b of layout.buildings) {
      const clear =
        tx < b.x - 2 ||
        tx > b.x + b.w + 1 ||
        ty < b.y - 2 ||
        ty > b.y + b.h + TOWN_FACADE + 1;
      expect(clear).toBe(true);
    }
  }
  // The same layout always plans the same fireflies and clouds.
  expect(townAtmospherePlan(layout)).toEqual(plan);
});

test("fireflies come out only at night", () => {
  expect(townFireflyNight(day)).toBe(0);
  expect(townFireflyNight(dusk)).toBe(0);
  expect(townFireflyNight(night)).toBe(1);
});

test("clouds drift east and wrap round their span without popping", () => {
  const cloud = plan.clouds[0]!;
  const a = townCloudAt(cloud, 0, plan.span);
  const b = townCloudAt(cloud, 10, plan.span);
  const moved = (b.x - a.x + plan.span.w) % plan.span.w;
  expect(moved).toBeCloseTo(cloud.speed * 10, 5);
  expect(b.y).toBe(a.y);
  // At the span's edges a cloud has faded out.
  const edge = townCloudAt({ ...cloud, x: 0 }, 0, plan.span);
  expect(edge.fade).toBe(0);
  const middle = townCloudAt({ ...cloud, x: plan.span.w / 2 }, 0, plan.span);
  expect(middle.fade).toBe(1);
});

test("without motion a firefly holds still and glows steadily", () => {
  const fly = plan.flies[0]!;
  expect(townFireflyAt(fly, 3, true)).toEqual(townFireflyAt(fly, 30, true));
  expect(townFireflyAt(fly, 3, false)).not.toEqual(
    townFireflyAt(fly, 30, false),
  );
});

test("drift redraws once per screen pixel, capped, and never without motion", () => {
  // Calm or reduced motion: nothing drifts, so nothing redraws.
  expect(townAtmosphereRate(day, 1, false)).toBe(0);
  expect(townAtmosphereRate(night, 1, false)).toBe(0);
  // A clear dusk between clouds and fireflies still has its fading clouds.
  expect(townAtmosphereRate(dusk, 1, true)).toBeGreaterThan(0);
  // Zoomed out, a few frames a second; zoomed in, never above the cap.
  const far = townAtmosphereRate(day, 0.3, true);
  expect(far).toBeGreaterThanOrEqual(1);
  expect(far).toBeLessThanOrEqual(3);
  expect(townAtmosphereRate(night, 5, true)).toBe(TOWN_ATMOSPHERE_MAX_RATE);
  // Nothing drifts in a sky with neither sun nor full night.
  expect(townAtmosphereRate({ ...night, sun: 0, lights: 0.5 }, 1, true)).toBe(
    0,
  );
});
