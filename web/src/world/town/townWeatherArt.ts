/**
 * Town's weather, drawn (the sky it reads is townWeather.ts's), in three
 * layers:
 *
 * - On the ground, under the sun's shadows: a wet street (a darker, cooler
 *   ground with puddles catching the sky) and snow lying on it.
 * - Over the shadows, under the buildings: fog lying in the streets with slow
 *   banks, so no veil ever dims a room, a desk or the post office.
 * - In the air over the whole town, buildings and trees included: falling
 *   rain and snow and pale wind gusts. They are thin and faint, and the
 *   status light, the amber reception pulse and every mark stay above them.
 *
 * Rain, snow and gusts fall through the screen, not the world, so there are
 * as many at every zoom and never more than the screen holds: each drop is
 * placed in screen pixels and drawn in the world at that point, a constant
 * size on screen. Under calm or reduced motion nothing falls or blows; the
 * weather holds still as a wet street, snow lying, fog or a grey sky.
 *
 * The motion functions are pure; the Pixi side only draws them.
 */

import { CanvasSource, Container, Sprite, Texture } from "pixi.js";
import type { TownSky } from "./townDaylight";
import { TOWN_TILE as T, TownGround, type TownLayout } from "./townLayout";
import { townCanvas, townHash } from "./townSprites";
import type { TownRect } from "./townTransition";

export type TownPuddle = { x: number; y: number; sx: number; sy: number };

/** At most this many drops, flakes and gusts, on the largest screen. */
export const TOWN_RAIN_MAX = 240;
export const TOWN_SNOW_MAX = 170;
export const TOWN_GUSTS_MAX = 18;
/** At most this many puddles, one per this many road or plaza tiles. */
const PUDDLES = 36;
const PUDDLE_SPACING = 23;
/** The screen area the maxima are for: a laptop's. */
const FULL_SCREEN = 1512 * 982;
/** The least share of the maxima a small screen shows. */
const SMALL_SCREEN = 0.36;
/** Screen pixels a second. */
const RAIN_SPEED = 190;
const SNOW_SPEED = 26;
const GUST_SPEED = 160;
const GUST_LENGTH = 48;

const unit = (seed: string) => (townHash(seed) % 10_000) / 10_000;

/**
 * Where drop `i` starts across and down the screen, as fractions: an even
 * spread (the R2 sequence) rather than hashed, so any number of drops reaches
 * every part of a screen, a phone's few included, with no dry patches.
 */
export const townFallSpread = (i: number) => ({
  x: (0.5 + i * 0.7548776662466927) % 1,
  y: (0.5 + i * 0.5698402909980532) % 1,
});

/** Puddles on the town's roads and squares: where a wet street shines. */
export function townPuddles(layout: TownLayout): TownPuddle[] {
  const puddles: TownPuddle[] = [];
  for (let ty = 0; ty < layout.height; ty += 1)
    for (let tx = 0; tx < layout.width; tx += 1) {
      if (puddles.length >= PUDDLES) return puddles;
      const ground = layout.ground[ty * layout.width + tx];
      if (ground !== TownGround.road && ground !== TownGround.plaza) continue;
      const hash = townHash(`puddle:${tx}:${ty}`);
      if (hash % PUDDLE_SPACING) continue;
      puddles.push({
        x: tx * T + (hash % 11),
        y: ty * T + ((hash >>> 5) % 11),
        sx: 34 + ((hash >>> 9) % 22),
        sy: 12 + ((hash >>> 13) % 8),
      });
    }
  return puddles;
}

/**
 * How many of `max` show for a `density` on a `width` × `height` screen: in
 * proportion to the screen's area, but a small screen keeps at least
 * SMALL_SCREEN of them, so a phone's weather never looks patchy.
 */
export function townFallCount(
  density: number,
  width: number,
  height: number,
  max: number,
) {
  if (density <= 0.02) return 0;
  const area = Math.min(
    1,
    Math.max(SMALL_SCREEN, (width * height) / FULL_SCREEN),
  );
  return Math.min(max, Math.round(max * Math.min(1, density) * area));
}

/**
 * Drop `i` of the rain `drift` seconds on, in screen pixels: falling at its
 * own speed, slanted by the wind, wrapping round the screen.
 */
export function townRainAt(
  i: number,
  drift: number,
  width: number,
  height: number,
  wind: number,
) {
  const speed = RAIN_SPEED * (0.8 + 0.4 * unit(`rain-v:${i}`));
  const span = height + 40;
  const start = townFallSpread(i);
  const fall = (start.y * span + drift * speed) % span;
  const slant = townRainSlant(wind);
  const x = start.x * width + fall * slant;
  return { x: ((x % width) + width) % width, y: fall - 20 };
}

/** How far a drop moves sideways for each pixel it falls. */
export const townRainSlant = (wind: number) =>
  Math.min(0.5, 0.06 * Math.max(0, wind - 0.6));

/** Flake `i` of the snow `drift` seconds on: a slow fall and a sway. */
export function townSnowAt(
  i: number,
  drift: number,
  width: number,
  height: number,
  wind: number,
) {
  const speed = SNOW_SPEED * (0.7 + 0.6 * unit(`snow-v:${i}`));
  const span = height + 20;
  const start = townFallSpread(i);
  const fall = (start.y * span + drift * speed) % span;
  const phase = unit(`snow-p:${i}`) * Math.PI * 2;
  const x =
    start.x * width +
    Math.sin(drift * 0.9 + phase) * 9 +
    fall * 0.08 * Math.max(0, wind - 1);
  return {
    x: ((x % width) + width) % width,
    y: fall - 10,
    size: 0.7 + 0.6 * unit(`snow-s:${i}`),
  };
}

/** Gust `i` of the wind `drift` seconds on: a pale streak blowing across. */
export function townGustAt(
  i: number,
  drift: number,
  width: number,
  height: number,
) {
  const span = width + GUST_LENGTH * 2;
  const speed = GUST_SPEED * (0.75 + 0.5 * unit(`gust-v:${i}`));
  const along = (unit(`gust-x:${i}`) * span + drift * speed) % span;
  return {
    x: along - GUST_LENGTH,
    y: unit(`gust-y:${i}`) * height + Math.sin(drift * 1.7 + i) * 4,
    // Fading in and out at the screen's edges, a gust never pops.
    fade: Math.max(0, Math.min(1, along / 80, (span - along) / 80)),
  };
}

/** A sheet's overhang past each screen edge, in screen pixels. */
const SHEET_BLEED = 64;

/**
 * The world rectangle a weather sheet covers for a camera at `origin` and
 * zoom `z` on a `width` × `height` screen: the whole screen and a little
 * more, whatever the zoom or scroll.
 */
export function townWeatherSheet(
  origin: { x: number; y: number },
  z: number,
  width: number,
  height: number,
): TownRect {
  return {
    x: (-SHEET_BLEED - origin.x) / z,
    y: (-SHEET_BLEED - origin.y) / z,
    w: (width + SHEET_BLEED * 2) / z,
    h: (height + SHEET_BLEED * 2) / z,
  };
}

/* ---------- drawing ---------- */

function texture(
  width: number,
  height: number,
  paint: (g: CanvasRenderingContext2D) => void,
) {
  const [canvas, g] = townCanvas(width, height);
  paint(g);
  return new Texture({
    source: new CanvasSource({ resource: canvas, scaleMode: "linear" }),
  });
}

/** A falling streak: faint at its tail, bright at its head. */
const dropTexture = () =>
  texture(2, 14, (g) => {
    const gradient = g.createLinearGradient(0, 0, 0, 14);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(255,255,255,1)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 2, 14);
  });

const flakeTexture = () =>
  texture(8, 8, (g) => {
    const gradient = g.createRadialGradient(4, 4, 0, 4, 4, 4);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.5, "rgba(255,255,255,.8)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 0, 8, 8);
  });

const gustTexture = () =>
  texture(GUST_LENGTH, 3, (g) => {
    const gradient = g.createLinearGradient(0, 0, GUST_LENGTH, 0);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255,255,255,1)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gradient;
    g.fillRect(0, 1, GUST_LENGTH, 1);
  });

const WET = 0x16223a;
const PUDDLE = 0xa8c4e6;
const SNOW_LYING = 0xf2f6ff;
const FOG = 0xe4e8ee;
const FOG_BANK = 0xf0f3f7;
const DROP = 0xdde8ff;

export type TownWeatherArt = ReturnType<typeof createTownWeatherArt>;

export function createTownWeatherArt(options: {
  /** On the ground, under the sun's shadows. */
  under: Container;
  /** Over the shadows, under the buildings. */
  over: Container;
  /** Over the whole scene, under the status light: what falls or blows. */
  air: Container;
  /** A soft round light (townLighting.ts's), for puddles. */
  radial: Texture;
  /** A cloud (townAtmosphere.ts's), for fog banks. */
  cloud: Texture;
}) {
  const { under, over, air, radial, cloud } = options;
  const drop = dropTexture();
  const flake = flakeTexture();
  const gust = gustTexture();
  const sheet = (parent: Container, tint: number) => {
    const sprite = parent.addChild(new Sprite(Texture.WHITE));
    sprite.tint = tint;
    sprite.visible = false;
    return sprite;
  };
  const wet = sheet(under, WET);
  const puddleLayer = under.addChild(new Container());
  const lying = sheet(under, SNOW_LYING);
  const fog = sheet(over, FOG);
  const bankLayer = over.addChild(new Container());
  const fall = air.addChild(new Container());
  const puddles: Sprite[] = [];
  const banks: { sprite: Sprite; x: number; y: number; speed: number }[] = [];
  /** Pools grow to what a screen has needed and are reused after. */
  const pools = {
    rain: [] as Sprite[],
    snow: [] as Sprite[],
    gusts: [] as Sprite[],
  };
  let span: TownRect = { x: 0, y: 0, w: 1, h: 1 };

  const pool = (name: keyof typeof pools, count: number, art: Texture) => {
    const list = pools[name];
    while (list.length < count) {
      const sprite = fall.addChild(new Sprite(art));
      sprite.anchor.set(0.5);
      list.push(sprite);
    }
    for (let i = count; i < list.length; i += 1) list[i]!.visible = false;
    return list;
  };

  return {
    /** Lay out the ground's puddles and the fog's banks for a layout. */
    sync(
      layout: TownLayout,
      nextSpan: TownRect,
      clouds: readonly { x: number; y: number; speed: number }[],
    ) {
      span = nextSpan;
      for (const child of [
        ...puddleLayer.removeChildren(),
        ...bankLayer.removeChildren(),
      ])
        child.destroy();
      puddles.length = banks.length = 0;
      for (const p of townPuddles(layout)) {
        const sprite = puddleLayer.addChild(new Sprite(radial));
        sprite.anchor.set(0.5);
        sprite.position.set(p.x, p.y);
        sprite.width = p.sx;
        sprite.height = p.sy;
        sprite.tint = PUDDLE;
        sprite.blendMode = "add";
        puddles.push(sprite);
      }
      // Fog banks keep low and slow: twice a cloud's size, a third its speed.
      for (const c of clouds) {
        const sprite = bankLayer.addChild(new Sprite(cloud));
        sprite.anchor.set(0.5);
        sprite.scale.set(2.6, 1.6);
        sprite.tint = FOG_BANK;
        banks.push({ sprite, x: c.x, y: c.y + span.h / 7, speed: c.speed / 3 });
      }
    },
    /**
     * Draw `sky`'s weather `drift` seconds on. Returns whether anything falls
     * or blows, and so wants redrawing.
     */
    update(
      sky: TownSky,
      drift: number,
      animated: boolean,
      world: Container,
      viewport: { width: number; height: number },
    ) {
      const { width, height } = viewport;
      const z = world.scale.x || 1;
      // The wet, snowy or foggy sheets cover the screen, not the town: the
      // wild land around it runs on past any span (townWildBands), so a sheet
      // sized to the town would stop at a hard edge over the forest.
      const seen = townWeatherSheet(world.position, z, width, height);
      for (const sprite of [wet, lying, fog]) {
        sprite.position.set(seen.x, seen.y);
        sprite.width = seen.w;
        sprite.height = seen.h;
      }
      wet.visible = sky.wet > 0.01;
      wet.alpha = 0.2 * sky.wet;
      puddleLayer.visible = wet.visible;
      puddleLayer.alpha = 0.14 * sky.wet;
      lying.visible = sky.cover > 0.01;
      lying.alpha = 0.55 * sky.cover;
      fog.visible = sky.fog > 0.01;
      fog.alpha = 0.32 * sky.fog;
      bankLayer.visible = fog.visible;
      if (bankLayer.visible)
        for (const bank of banks) {
          const along =
            (((bank.x + drift * bank.speed * sky.wind) % span.w) + span.w) %
            span.w;
          bank.sprite.position.set(span.x + along, bank.y);
          bank.sprite.alpha =
            0.4 * sky.fog * Math.min(1, along / 300, (span.w - along) / 300);
        }
      const place = (sprite: Sprite, x: number, y: number, size = 1) => {
        sprite.visible = true;
        sprite.position.set(
          (x - world.position.x) / z,
          (y - world.position.y) / z,
        );
        sprite.scale.set(size / z);
      };
      const rain = animated
        ? townFallCount(sky.rain, width, height, TOWN_RAIN_MAX)
        : 0;
      const slant = townRainSlant(sky.wind);
      pool("rain", rain, drop).forEach((sprite, i) => {
        if (i >= rain) return;
        const at = townRainAt(i, drift, width, height, sky.wind);
        place(sprite, at.x, at.y);
        sprite.rotation = -Math.atan(slant);
        sprite.tint = DROP;
        sprite.alpha = 0.3 + 0.15 * sky.rain;
      });
      const snow = animated
        ? townFallCount(sky.snow, width, height, TOWN_SNOW_MAX)
        : 0;
      pool("snow", snow, flake).forEach((sprite, i) => {
        if (i >= snow) return;
        const at = townSnowAt(i, drift, width, height, sky.wind);
        place(sprite, at.x, at.y, at.size);
        sprite.alpha = 0.85;
      });
      const gusts = animated
        ? townFallCount(sky.gusts, width, height, TOWN_GUSTS_MAX)
        : 0;
      pool("gusts", gusts, gust).forEach((sprite, i) => {
        if (i >= gusts) return;
        const at = townGustAt(i, drift, width, height);
        place(sprite, at.x, at.y);
        sprite.alpha = 0.22 * at.fade;
      });
      return rain + snow + gusts > 0;
    },
    destroy() {
      for (const layer of [under, over, air])
        for (const child of layer.removeChildren())
          child.destroy({ children: true });
      drop.destroy(true);
      flake.destroy(true);
      gust.destroy(true);
    },
  };
}
