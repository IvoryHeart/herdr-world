/**
 * What one ground chunk draws, as data: each tile's surface (the layout's
 * ground where it uses the land, the generated landscape elsewhere, on and
 * beyond the town's edge), the road markings and building shadows, and the
 * landscape's trees, hedges and the like whose drawings reach the chunk.
 *
 * The painter (townPaint.ts) draws a plan and reads nothing else, so two
 * plans with the same `key` paint the same pixels: a layout change keeps
 * every painted chunk whose plan is unchanged (townRendererTopology.ts).
 * Headless and pure.
 */

import {
  townLandObjects,
  townLandscape,
  type TownLandObject,
} from "./townLandscape";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  TownGround,
  type TownLayout,
} from "./townLayout";
import type { TownRect } from "./townTransition";

/** A tile's code: the layout's ground (0–5), or LAND + a TownLand kind. */
export const TOWN_GROUND_LAND = 16;

/** A filled rectangle in world pixels. */
export type TownGroundMark = {
  fill: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type TownGroundPlan = {
  region: TownRect;
  /** The tiles covered, with a ring of one tile all round (for edges). */
  tx0: number;
  ty0: number;
  cols: number;
  rows: number;
  tiles: Uint8Array;
  /** Road markings, kerbs, building shadows and door mats, in order. */
  marks: TownGroundMark[];
  /** The landscape objects whose drawings reach the region, in drawing order. */
  objects: TownLandObject[];
  /** Equal for plans that paint the same pixels. */
  key: string;
};

/** The plan of one rectangular region (world pixels) of `layout`'s ground. */
export function townGroundPlan(
  layout: TownLayout,
  region: TownRect,
): TownGroundPlan {
  const { width, height, ground } = layout;
  const land = townLandscape(layout);
  const tx0 = Math.floor(region.x / T) - 1;
  const ty0 = Math.floor(region.y / T) - 1;
  const tx1 = Math.ceil((region.x + region.w) / T) + 1;
  const ty1 = Math.ceil((region.y + region.h) / T) + 1;
  const cols = tx1 - tx0;
  const rows = ty1 - ty0;
  const tiles = new Uint8Array(cols * rows);
  for (let ty = ty0; ty < ty1; ty += 1)
    for (let tx = tx0; tx < tx1; tx += 1) {
      const inside = tx >= 0 && ty >= 0 && tx < width && ty < height;
      const type = inside ? ground[ty * width + tx]! : TownGround.grass;
      tiles[(ty - ty0) * cols + tx - tx0] =
        type === TownGround.grass || type === TownGround.building
          ? TOWN_GROUND_LAND + land.surface(tx, ty)
          : type;
    }

  const marks: TownGroundMark[] = [];
  const mark = (fill: string, x: number, y: number, w: number, h: number) => {
    // Clip to the region, so the key holds only what this chunk shows.
    const cx0 = Math.max(x, region.x);
    const cy0 = Math.max(y, region.y);
    const cx1 = Math.min(x + w, region.x + region.w);
    const cy1 = Math.min(y + h, region.y + region.h);
    if (cx1 > cx0 && cy1 > cy0)
      marks.push({ fill, x: cx0, y: cy0, w: cx1 - cx0, h: cy1 - cy0 });
  };
  // Street markings run the town's width; beyond it the street is a lane.
  const left = Math.max(region.x, 0);
  const right = Math.min(region.x + region.w, width * T);
  for (const roadY of layout.roads) {
    const cy = (roadY + 2) * T + 7;
    for (let x = Math.floor(left / 16) * 16; x < right; x += 16)
      mark("#e8c75a", x + 3, cy, Math.min(9, right - x - 3), 2);
    mark("#3f424a", left, (roadY + 1) * T, right - left, 1);
    mark("#3f424a", left, (roadY + 4) * T - 1, right - left, 1);
  }
  for (const road of layout.verticalRoads)
    for (let ty = road.y0; ty < road.y1; ty += 1)
      mark("#e8c75a", (road.x + 2) * T + 7, ty * T + 3, 2, 9);
  for (const b of layout.buildings) {
    mark(
      "rgba(0,0,0,.2)",
      b.x * T + 10,
      b.y * T - 4,
      b.w * T,
      (b.h + TOWN_FACADE) * T + 8,
    );
    mark(
      "rgba(60,40,30,.55)",
      b.barDoorX * T + 1,
      (b.y + b.h + TOWN_FACADE) * T,
      14,
      4,
    );
  }

  const objects = townLandObjects(land, tx0 + 1, ty0 + 1, tx1 - 1, ty1 - 1);
  return {
    region,
    tx0,
    ty0,
    cols,
    rows,
    tiles,
    marks,
    objects,
    key: planKey(region, tiles, marks, objects),
  };
}

function planKey(
  region: TownRect,
  tiles: Uint8Array,
  marks: readonly TownGroundMark[],
  objects: readonly TownLandObject[],
) {
  let h = 2166136261;
  const mix = (value: number) => {
    h ^= value | 0;
    h = Math.imul(h, 16777619);
  };
  for (const tile of tiles) mix(tile);
  for (const m of marks) {
    for (let i = 0; i < m.fill.length; i += 1) mix(m.fill.charCodeAt(i));
    mix(m.x);
    mix(m.y);
    mix(m.w);
    mix(m.h);
  }
  for (const o of objects) {
    mix(o.kind.charCodeAt(0) + o.kind.length * 256);
    mix(o.x);
    mix(o.y);
    mix(o.variant);
  }
  return `${region.x},${region.y},${region.w},${region.h}:${tiles.length}:${marks.length}:${objects.length}:${(h >>> 0).toString(36)}`;
}
