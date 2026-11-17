/**
 * Town's atmosphere: depth that follows the time of day (townDaylight.ts).
 * By day each building casts a sun shadow that swings with the hour, and
 * cloud shadows drift across the land; at night street lamps glow at their
 * heads (their pools of light are townLighting.ts's) and fireflies wander
 * over the grass.
 *
 * It stays quiet. Shadows and clouds lie on the ground under the buildings,
 * so they never shade a room, a desk or a status mark; fireflies keep to open
 * grass away from buildings and are small and dim. Under calm or reduced
 * motion nothing drifts. While it moves, the town is redrawn only as often as
 * the drift moves a screen pixel, and never above TOWN_ATMOSPHERE_MAX_RATE.
 *
 * `townAtmospherePlan` and the motion functions are pure; the Pixi side only
 * draws them.
 */

import {
  CanvasSource,
  Container,
  NineSliceSprite,
  Sprite,
  Texture,
} from "pixi.js";
import type { TownSky } from "./townDaylight";
import { TownLand, townLandscape } from "./townLandscape";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  TownGround,
  type TownLayout,
  type TownPoint,
} from "./townLayout";
import {
  radialTexture,
  softRectTexture,
  TOWN_LIGHT_FEATHER,
} from "./townLighting";
import { townHash, townCanvas } from "./townSprites";
import type { TownRect } from "./townTransition";

export type TownFirefly = TownPoint & { seed: number };
export type TownCloud = TownPoint & {
  /** Its stretch, so no two clouds look alike. */
  sx: number;
  sy: number;
  /** Drift east, in world pixels a second. */
  speed: number;
};
export type TownAtmospherePlan = {
  /** Building footprints (with their facades), in world pixels. */
  shadows: TownRect[];
  lampHeads: TownPoint[];
  flies: TownFirefly[];
  /** Clouds drift east across `span` and wrap round it. */
  clouds: TownCloud[];
  span: TownRect;
};

/** At most this many redraws a second for drifting atmosphere alone. */
export const TOWN_ATMOSPHERE_MAX_RATE = 12;
/** How far past the town the clouds' span reaches, in world pixels. */
const CLOUD_MARGIN = 600;
/** A cloud fades in and out over this many pixels at the span's edges. */
const CLOUD_FADE = 300;
const CLOUD_WIDTH = 256;
/** One firefly per this many grass tiles at most, and never more than FLIES. */
const FLY_SPACING = 53;
const FLIES = 160;
/** Fireflies wander this fast at most, in world pixels a second. */
const FLY_SPEED = 13;

const fraction = (seed: number) => (townHash(String(seed)) % 1000) / 1000;

/** What the atmosphere draws for a layout. Pure; one plan per layout. */
export function townAtmospherePlan(layout: TownLayout): TownAtmospherePlan {
  const shadows = layout.buildings.map((b) => ({
    x: b.x * T,
    y: b.y * T,
    w: b.w * T,
    h: (b.h + TOWN_FACADE) * T,
  }));
  const lampHeads = layout.lamps.map((lamp) => ({
    x: lamp.x * T + 8,
    y: lamp.y * T - 19,
  }));
  // Fireflies: open grass, in town and out to the land around it, never
  // within two tiles of a building.
  const land = townLandscape(layout);
  const near = (tx: number, ty: number) =>
    layout.buildings.some(
      (b) =>
        tx > b.x - 3 &&
        tx < b.x + b.w + 2 &&
        ty > b.y - 3 &&
        ty < b.y + b.h + TOWN_FACADE + 2,
    );
  const flies: TownFirefly[] = [];
  const reach = 12;
  for (let ty = -reach; ty < layout.height + reach; ty += 1)
    for (let tx = -reach; tx < layout.width + reach; tx += 1) {
      if (flies.length >= FLIES) break;
      const hash = townHash(`fly:${tx}:${ty}`);
      if (hash % FLY_SPACING) continue;
      const inside =
        tx >= 0 && ty >= 0 && tx < layout.width && ty < layout.height;
      if (inside && layout.ground[ty * layout.width + tx] !== TownGround.grass)
        continue;
      const surface = land.surface(tx, ty);
      if (surface !== TownLand.meadow && surface !== TownLand.lawn) continue;
      if (near(tx, ty)) continue;
      flies.push({
        x: tx * T + (hash % 13),
        y: ty * T + ((hash >>> 4) % 13),
        seed: (hash % 997) / 10,
      });
    }
  const span = {
    x: -CLOUD_MARGIN,
    y: -CLOUD_MARGIN,
    w: layout.width * T + CLOUD_MARGIN * 2,
    h: layout.height * T + CLOUD_MARGIN * 2,
  };
  const count = Math.round(
    Math.min(30, Math.max(4, (span.w * span.h) / 360_000)),
  );
  const clouds = Array.from({ length: count }, (_, i) => ({
    x: fraction(i * 7 + 1) * span.w,
    y: span.y + ((i + fraction(i * 7 + 2)) / count) * span.h,
    sx: 2.2 + fraction(i * 7 + 3) * 1.4,
    sy: 2 + fraction(i * 7 + 4) * 0.8,
    speed: 5 + fraction(i * 7 + 5) * 4,
  }));
  return { shadows, lampHeads, flies, clouds, span };
}

/** How strongly fireflies show: none until the sky is nearly dark. */
export const townFireflyNight = (sky: TownSky) =>
  Math.min(1, Math.max(0, (sky.lights - 0.7) / 0.3));

/** A cloud's shadow `drift` seconds on: where it is and how much it shows. */
export function townCloudAt(cloud: TownCloud, drift: number, span: TownRect) {
  const along = (((cloud.x + drift * cloud.speed) % span.w) + span.w) % span.w;
  return {
    x: span.x + along,
    y: cloud.y,
    // Fading at both ends of the span, a wrapping cloud never pops.
    fade: Math.min(1, along / CLOUD_FADE, (span.w - along) / CLOUD_FADE),
  };
}

/** A firefly `drift` seconds on: a slow wander and a blink; still, a glow. */
export function townFireflyAt(fly: TownFirefly, drift: number, still: boolean) {
  if (still) return { x: fly.x, y: fly.y, glow: 0.55 };
  const t = drift * 0.5 + fly.seed;
  return {
    x: fly.x + Math.sin(t * 1.3) * 14 + Math.sin(t * 0.37) * 22,
    y: fly.y + Math.cos(t * 1.1) * 9 + Math.sin(t * 0.51) * 12,
    glow: Math.max(0, Math.sin(t * 2.3 + fly.seed)) ** 2,
  };
}

/**
 * How often drifting atmosphere wants the town redrawn, in frames a second:
 * once per screen pixel of drift at zoom `z`, at most
 * TOWN_ATMOSPHERE_MAX_RATE. 0 when nothing drifts: calm or reduced motion, or
 * no clouds or fireflies in this sky.
 */
export function townAtmosphereRate(sky: TownSky, z: number, animated: boolean) {
  if (!animated) return 0;
  const speed = Math.max(
    sky.sun > 0.02 ? 9 : 0,
    townFireflyNight(sky) > 0.02 ? FLY_SPEED : 0,
  );
  return speed
    ? Math.min(TOWN_ATMOSPHERE_MAX_RATE, Math.max(1, Math.ceil(speed * z)))
    : 0;
}

/* ---------- drawing ---------- */

/** A puffy cloud, white so it can be tinted as a shadow. */
function cloudTexture() {
  const [canvas, g] = townCanvas(CLOUD_WIDTH, 160);
  for (const [x, y, r] of [
    [84, 84, 70],
    [150, 70, 66],
    [196, 96, 54],
    [120, 104, 52],
  ] as const) {
    const gradient = g.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, "rgba(255,255,255,.9)");
    gradient.addColorStop(0.55, "rgba(255,255,255,.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return new Texture({
    source: new CanvasSource({ resource: canvas, scaleMode: "linear" }),
  });
}

const SHADOW = 0x0a1026;
const SHADOW_FEATHER = 14;

export type TownAtmosphere = ReturnType<typeof createTownAtmosphere>;

export function createTownAtmosphere(options: {
  /** On the ground, under the buildings: sun and cloud shadows. */
  ground: Container;
  /** Over the lit world, in world coordinates: what glows by itself. */
  glow: Container;
}) {
  const { ground, glow } = options;
  const radial = radialTexture();
  const soft = softRectTexture();
  const cloud = cloudTexture();
  const shadowLayer = ground.addChild(new Container());
  const cloudLayer = ground.addChild(new Container());
  let plan: TownAtmospherePlan | null = null;
  const shadows: NineSliceSprite[] = [];
  const clouds: Sprite[] = [];
  const lamps: Sprite[] = [];
  const flies: Sprite[] = [];
  /** Seconds the atmosphere has drifted: it holds still without motion. */
  let drift = 0;
  let lastClock: number | null = null;

  const glowAt = (x: number, y: number, radius: number, tint: number) => {
    const sprite = glow.addChild(new Sprite(radial));
    sprite.anchor.set(0.5);
    sprite.position.set(x, y);
    sprite.width = sprite.height = radius * 2;
    sprite.tint = tint;
    sprite.blendMode = "add";
    return sprite;
  };
  const clear = () => {
    for (const layer of [shadowLayer, cloudLayer, glow])
      for (const child of layer.removeChildren()) child.destroy();
    shadows.length = clouds.length = lamps.length = flies.length = 0;
  };

  return {
    /** Rebuild from a layout's plan. */
    sync(next: TownAtmospherePlan) {
      clear();
      plan = next;
      const k = SHADOW_FEATHER / TOWN_LIGHT_FEATHER;
      for (const rect of next.shadows) {
        const sprite = new NineSliceSprite({
          texture: soft,
          leftWidth: TOWN_LIGHT_FEATHER,
          rightWidth: TOWN_LIGHT_FEATHER,
          topHeight: TOWN_LIGHT_FEATHER,
          bottomHeight: TOWN_LIGHT_FEATHER,
        });
        sprite.scale.set(k);
        sprite.width = (rect.w + SHADOW_FEATHER) / k;
        sprite.height = (rect.h + SHADOW_FEATHER) / k;
        sprite.tint = SHADOW;
        shadows.push(shadowLayer.addChild(sprite));
      }
      for (const shape of next.clouds) {
        const sprite = cloudLayer.addChild(new Sprite(cloud));
        sprite.anchor.set(0.5);
        sprite.scale.set(shape.sx, shape.sy);
        sprite.tint = SHADOW;
        clouds.push(sprite);
      }
      for (const head of next.lampHeads)
        lamps.push(glowAt(head.x, head.y, 13, 0xffe6a8));
      for (const fly of next.flies)
        flies.push(glowAt(fly.x, fly.y, 5, 0xe9ff9a));
    },
    /**
     * Place this frame's atmosphere under `sky`, with `world`'s camera.
     * Returns how often it wants redrawing (townAtmosphereRate).
     */
    update(sky: TownSky, clock: number, animated: boolean, world: Container) {
      if (animated && lastClock !== null) drift += clock - lastClock;
      lastClock = clock;
      glow.scale.copyFrom(world.scale);
      glow.position.copyFrom(world.position);
      if (!plan) return 0;
      plan.shadows.forEach((rect, i) => {
        const sprite = shadows[i]!;
        sprite.visible = sky.sun > 0.01;
        sprite.alpha = 0.3 * sky.sun;
        sprite.position.set(
          rect.x - SHADOW_FEATHER / 2 + sky.shadowX,
          rect.y - SHADOW_FEATHER / 2 + sky.shadowY,
        );
      });
      cloudLayer.visible = sky.sun > 0.02;
      if (cloudLayer.visible)
        plan.clouds.forEach((shape, i) => {
          const at = townCloudAt(shape, drift, plan!.span);
          clouds[i]!.position.set(at.x, at.y);
          clouds[i]!.alpha = 0.13 * sky.sun * at.fade;
        });
      for (const lamp of lamps) {
        lamp.visible = sky.lights > 0.01;
        lamp.alpha = 0.9 * sky.lights;
      }
      const night = townFireflyNight(sky);
      plan.flies.forEach((fly, i) => {
        const sprite = flies[i]!;
        sprite.visible = night > 0.02;
        if (!sprite.visible) return;
        const at = townFireflyAt(fly, drift, !animated);
        sprite.position.set(at.x, at.y);
        sprite.alpha = 0.85 * night * at.glow;
      });
      return townAtmosphereRate(sky, world.scale.x, animated);
    },
    destroy() {
      clear();
      shadowLayer.destroy();
      cloudLayer.destroy();
      radial.destroy(true);
      soft.destroy(true);
      cloud.destroy(true);
    },
  };
}
