/**
 * The land around Town's buildings: woods, meadows, gardens, ponds, trails
 * and country lanes, generated from a fixed seed over every tile that the
 * layout leaves free, inside the town and on the map beyond it.
 *
 * A few tiles past the town (townWildLine) the town's own land (lanes,
 * parkland, what keeps clear of buildings) gives way to the wild: land that
 * depends on the seed alone and repeats every TOWN_LAND_PERIOD tiles. The
 * renderer bakes one period of it once and repeats it out to the window's
 * edges, so the map never ends (townRendererTopology.ts).
 *
 * Every tile's land is a pure function of its own coordinates, the seed and
 * the layout within a few tiles of it (its reserved land), never of the
 * town's size or of the order tiles are visited. So a reload draws the same
 * land, and a layout change regenerates only the land next to what changed:
 * growth extends the landscape rather than reshuffling it.
 *
 * Headless and pure; townLandscapePaint.ts draws it into the ground chunks.
 */

import { townBusRoute } from "./townBus";
import {
  TOWN_FACADE,
  TOWN_TILE as T,
  TownGround,
  type TownLayout,
} from "./townLayout";

/** The landscape's seed: one fixed seed, so every World grows the same land. */
export const TOWN_LANDSCAPE_SEED = 641;

/**
 * Every random choice repeats every this many tiles each way, so the wild
 * land beyond the town is one baked square repeated. Each noise scale, the
 * plot cell and the tree block divide it.
 */
export const TOWN_LAND_PERIOD = 96;

/** Tiles of the town's own land (lanes, parkland) at least past its edges. */
const WILD_GAP = 8;

/** What a free tile's surface is. */
export const TownLand = {
  meadow: 0,
  /** Woodland floor, under the trees. */
  forest: 1,
  /** A footpath winding through the land. */
  trail: 2,
  /** A street's country lane beyond the town's edge. */
  lane: 3,
  water: 4,
  /** A garden's flower bed. */
  bed: 5,
  /** A garden's gravel walk. */
  gravel: 6,
  /** A garden's mown lawn. */
  lawn: 7,
} as const;
export type TownLandKind = (typeof TownLand)[keyof typeof TownLand];

/** Something standing on the land, drawn from its tile (x, y) upward. */
export type TownLandObject = {
  kind: "tree" | "pine" | "hedge" | "shrub" | "rock" | "reeds" | "flowers";
  x: number;
  y: number;
  /** Which look of its kind (colours, size). */
  variant: number;
};

/**
 * Rows above the first street kept as lawn, for the signs that stand beside
 * the top road (#700's billboards).
 */
export const TOWN_BILLBOARD_VERGE = 4;

/** How far (tiles) the reserved land's distance is tracked. */
const REACH = 3;
/** Gardens and ponds each take at most one plot of this many tiles square. */
const PLOT_CELL = 12;
/** A tree's crown and shadow reach this far from its trunk tile. */
const CROWN = { left: 1, right: 1, up: 2, down: 1 } as const;
/** How many tiles a lane runs straight from the town's edge before winding. */
const LANE_STRAIGHT = 6;

const wrap = (v: number, period: number) =>
  (((v | 0) % period) + period) % period;

/**
 * A well-mixed 32-bit hash of a point and a salt, repeating every `period`
 * points each way (TOWN_LAND_PERIOD tiles, counted in the point's units).
 */
function hash(x: number, y: number, salt: number, period = TOWN_LAND_PERIOD) {
  let h =
    Math.imul(wrap(x, period), 0x27d4eb2d) ^
    Math.imul(wrap(y, period), 0x165667b1) ^
    Math.imul(salt | 0, 0x5bd1e995);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
const unit = (h: number) => h / 4294967296;
const smooth = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1): a lattice every `scale` tiles. */
function noise(x: number, y: number, scale: number, salt: number) {
  const fx = x / scale;
  const fy = y / scale;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  const sx = smooth(fx - ix);
  const sy = smooth(fy - iy);
  const n = TOWN_LAND_PERIOD / scale;
  const a = unit(hash(ix, iy, salt, n));
  const b = unit(hash(ix + 1, iy, salt, n));
  const c = unit(hash(ix, iy + 1, salt, n));
  const d = unit(hash(ix + 1, iy + 1, salt, n));
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

/** A garden or pond, inside one plot cell with a tile to spare all round. */
export type TownLandPlot = {
  kind: "garden" | "orchard" | "pond";
  x: number;
  y: number;
  w: number;
  h: number;
  /** Colours or shape, by kind. */
  variant: number;
};

export type TownLandscape = {
  seed: number;
  /**
   * Chebyshev distance from the tile to the nearest reserved tile (a road,
   * pavement, plaza, building, the town center, a lamp, bench, bush, board,
   * bus stop or the billboard verge), capped above REACH.
   */
  reserved(tx: number, ty: number): number;
  /** The free tile's surface; reserved tiles keep the layout's ground. */
  surface(tx: number, ty: number): TownLandKind;
  /** The object standing on a tile, if any. */
  objectAt(tx: number, ty: number): TownLandObject | null;
  /** The garden or pond on a plot cell, if any. */
  plot(cx: number, cy: number): TownLandPlot | null;
};

const cache = new WeakMap<TownLayout, Map<number, TownLandscape>>();
const wildCache = new Map<number, TownLandscape>();

/** The landscape of `layout`, built once per layout and seed. */
export function townLandscape(
  layout: TownLayout,
  seed = TOWN_LANDSCAPE_SEED,
): TownLandscape {
  let bySeed = cache.get(layout);
  if (!bySeed) cache.set(layout, (bySeed = new Map()));
  let landscape = bySeed.get(seed);
  if (!landscape) bySeed.set(seed, (landscape = build(layout, seed)));
  return landscape;
}

/**
 * The wild land of `seed`, with no town: what every town's landscape is past
 * its wild line. It repeats every TOWN_LAND_PERIOD tiles each way.
 */
export function townWildLandscape(seed = TOWN_LANDSCAPE_SEED): TownLandscape {
  let landscape = wildCache.get(seed);
  if (!landscape) wildCache.set(seed, (landscape = build(null, seed)));
  return landscape;
}

/** A rectangle of tiles, x0..x1 and y0..y1 exclusive. */
export type TownTileRect = { x0: number; y0: number; x1: number; y1: number };

/**
 * Where `layout`'s own land ends: every tile outside this rectangle is the
 * wild landscape's. It lies at least WILD_GAP tiles past the town, on plot
 * cell lines, so no garden or pond is cut in two.
 */
export function townWildLine(layout: TownLayout): TownTileRect {
  const out = (t: number) => Math.floor(t / PLOT_CELL) * PLOT_CELL;
  const up = (t: number) => Math.ceil(t / PLOT_CELL) * PLOT_CELL;
  return {
    x0: out(-WILD_GAP),
    y0: out(-WILD_GAP),
    x1: up(layout.width + WILD_GAP),
    y1: up(layout.height + WILD_GAP),
  };
}

/** The reserved land: what the layout uses or keeps clear, with its distance. */
function reservedLand(layout: TownLayout) {
  const { width, height, ground } = layout;
  const pad = REACH + 1;
  const w = width + 2 * pad;
  const h = height + 2 * pad;
  const far = REACH + 1;
  const distance = new Uint8Array(w * h).fill(far);
  const reserve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(-pad, y0); y < Math.min(height + pad, y1); y += 1)
      for (let x = Math.max(-pad, x0); x < Math.min(width + pad, x1); x += 1)
        distance[(y + pad) * w + x + pad] = 0;
  };
  for (let ty = 0; ty < height; ty += 1)
    for (let tx = 0; tx < width; tx += 1)
      if (ground[ty * width + tx] !== TownGround.grass)
        reserve(tx, ty, tx + 1, ty + 1);
  // Buildings with their roof row, shadow and front-door path.
  for (const b of layout.buildings)
    reserve(b.x - 1, b.y - 2, b.x + b.w + 1, b.y + b.h + TOWN_FACADE + 1);
  const { center } = layout;
  reserve(center.x - 1, center.y - 1, center.x + center.w + 1, center.street);
  for (const lamp of layout.lamps)
    reserve(lamp.x, lamp.y - 2, lamp.x + 1, lamp.y + 1);
  for (const bush of layout.bushes)
    reserve(bush.x - 1, bush.y, bush.x + 1, bush.y + 1);
  for (const bench of layout.benches)
    reserve(bench.x, bench.y, bench.x + 2, bench.y + 1);
  reserve(
    layout.board.x - 1,
    layout.board.y - 1,
    layout.board.x + 2,
    layout.board.y + 1,
  );
  reserve(
    layout.plaza.x - 2,
    layout.plaza.y - 2,
    layout.plaza.x + 3,
    layout.plaza.y + 2,
  );
  for (const stop of townBusRoute(layout).stops) {
    const sx = Math.floor(stop.wait.x / T);
    const sy = Math.floor(stop.wait.y / T);
    reserve(sx - 2, sy - 5, sx + 3, sy + 2);
  }
  if (layout.roads.length) {
    const top = Math.min(...layout.roads);
    reserve(0, top - TOWN_BILLBOARD_VERGE, width, top);
  }
  // Grow the distance one ring at a time, up to REACH.
  for (let ring = 1; ring <= REACH; ring += 1)
    for (let y = 0; y < h; y += 1)
      for (let x = 0; x < w; x += 1) {
        if (distance[y * w + x] !== far) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy += 1)
          for (let dx = -1; dx <= 1 && !near; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h)
              near = distance[ny * w + nx] === ring - 1;
          }
        if (near) distance[y * w + x] = ring;
      }
  return (tx: number, ty: number) => {
    const x = tx + pad;
    const y = ty + pad;
    return x < 0 || y < 0 || x >= w || y >= h ? far : distance[y * w + x]!;
  };
}

/** A town's landscape, or with `layout` null the wild land alone. */
function build(layout: TownLayout | null, seed: number): TownLandscape {
  const far = REACH + 1;
  const reserved = layout ? reservedLand(layout) : () => far;
  const roads = layout ? [...new Set(layout.roads)].sort((a, b) => a - b) : [];
  const width = layout?.width ?? 0;
  const height = layout?.height ?? 0;
  // Past the wild line the town's land is the wild's, tile for tile.
  const wild = layout ? townWildLandscape(seed) : null;
  const line = layout ? townWildLine(layout) : null;
  const isWild = (tx: number, ty: number) =>
    !!line && (tx < line.x0 || ty < line.y0 || tx >= line.x1 || ty >= line.y1);
  const inTown = (tx: number, ty: number) =>
    tx >= 0 && ty >= 0 && tx < width && ty < height;
  /**
   * How deep in the woods a tile is, [0, 1). Inside the town the land is
   * parkland: open lawn with scattered trees, gardens and ponds.
   */
  const wood = (tx: number, ty: number) =>
    inTown(tx, ty)
      ? 0
      : 0.65 * noise(tx, ty, 24, seed + 1) + 0.35 * noise(tx, ty, 8, seed + 2);
  const FOREST = 0.56;
  const DEEP = 0.66;

  /**
   * Beyond the town's edge each street runs on as a country lane, as far as
   * the wild line.
   */
  const lane = (tx: number, ty: number) => {
    if ((tx >= 0 && tx < width) || isWild(tx, ty)) return false;
    const out = tx < 0 ? -1 - tx : tx - width;
    const sway = Math.min(1, Math.max(0, (out - LANE_STRAIGHT) / 8));
    for (const road of roads) {
      const bend = Math.round((noise(tx, road, 16, seed + 3) - 0.5) * 6 * sway);
      const top = road + 1 + bend;
      if (ty >= top && ty < top + 3) return true;
    }
    return false;
  };
  /** Near a lane (within a tile), where no tree stands. */
  const byLane = (tx: number, ty: number) => {
    if (tx >= -1 && tx <= width) return false;
    for (let dy = -1; dy <= 1; dy += 1)
      for (let dx = -1; dx <= 1; dx += 1)
        if (lane(tx + dx, ty + dy)) return true;
    return false;
  };

  /** Footpaths wind along a noise field's contour, through woods and fields. */
  const trailField = (tx: number, ty: number) =>
    noise(tx, ty, 32, seed + 5) >= 0.5;
  const trail = (tx: number, ty: number) => {
    const here = trailField(tx, ty);
    return here !== trailField(tx + 1, ty) || here !== trailField(tx, ty + 1);
  };

  const plots = new Map<string, TownLandPlot | null>();
  /** Every tile of a rectangle (with a ring) free, off lanes and trails. */
  const clear = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    distance: number,
  ) => {
    for (let y = y0 - 1; y <= y1; y += 1)
      for (let x = x0 - 1; x <= x1; x += 1)
        if (reserved(x, y) < distance || lane(x, y) || trail(x, y))
          return false;
    return true;
  };
  const plot = (cx: number, cy: number): TownLandPlot | null => {
    if (wild && isWild(cx * PLOT_CELL, cy * PLOT_CELL))
      return wild.plot(cx, cy);
    const key = `${cx},${cy}`;
    if (plots.has(key)) return plots.get(key)!;
    const h = hash(cx, cy, seed + 7, TOWN_LAND_PERIOD / PLOT_CELL);
    const pick = unit(h);
    const x0 = cx * PLOT_CELL;
    const y0 = cy * PLOT_CELL;
    let result: TownLandPlot | null = null;
    if (wood(x0 + PLOT_CELL / 2, y0 + PLOT_CELL / 2) < FOREST) {
      const variant = (h >>> 20) % 4;
      if (pick < 0.2) {
        const w = 6 + ((h >>> 4) % 3);
        const ph = 4 + ((h >>> 8) % 3);
        const x = x0 + 2 + ((h >>> 12) % (PLOT_CELL - 3 - w));
        const y = y0 + 2 + ((h >>> 16) % (PLOT_CELL - 3 - ph));
        const candidate = { kind: "pond" as const, x, y, w, h: ph, variant };
        if (clear(x, y, x + w, y + ph, 3)) result = candidate;
      } else if (pick < 0.5) {
        const w = 6 + ((h >>> 4) % 4);
        const ph = 5 + ((h >>> 8) % 3);
        const x = x0 + 1 + ((h >>> 12) % (PLOT_CELL - 1 - w));
        const y = y0 + 1 + ((h >>> 16) % (PLOT_CELL - 1 - ph));
        const kind = pick < 0.4 ? ("garden" as const) : ("orchard" as const);
        if (clear(x, y, x + w, y + ph, 2))
          result = { kind, x, y, w, h: ph, variant };
      }
    }
    plots.set(key, result);
    return result;
  };
  const cellOf = (t: number) => Math.floor(t / PLOT_CELL);
  const plotAt = (tx: number, ty: number) => {
    const p = plot(cellOf(tx), cellOf(ty));
    return p && tx >= p.x && tx < p.x + p.w && ty >= p.y && ty < p.y + p.h
      ? p
      : null;
  };
  /** Inside a pond's ellipse. */
  const inPond = (p: TownLandPlot, tx: number, ty: number) => {
    const rx = p.w / 2;
    const ry = p.h / 2;
    const dx = (tx + 0.5 - (p.x + rx)) / rx;
    const dy = (ty + 0.5 - (p.y + ry)) / ry;
    return dx * dx + dy * dy <= 1;
  };

  const surface = (tx: number, ty: number): TownLandKind => {
    if (wild && isWild(tx, ty)) return wild.surface(tx, ty);
    if (reserved(tx, ty) === 0) return TownLand.meadow;
    if (lane(tx, ty)) return TownLand.lane;
    const p = plotAt(tx, ty);
    if (p?.kind === "pond") {
      if (inPond(p, tx, ty)) return TownLand.water;
    } else if (p) {
      const edge =
        tx === p.x ||
        ty === p.y ||
        tx === p.x + p.w - 1 ||
        ty === p.y + p.h - 1;
      if (edge) return TownLand.lawn;
      if (p.kind === "orchard") return TownLand.lawn;
      return (ty - p.y) % 2 === 1 ? TownLand.bed : TownLand.gravel;
    }
    if (reserved(tx, ty) >= 2 && trail(tx, ty)) return TownLand.trail;
    return wood(tx, ty) >= FOREST ? TownLand.forest : TownLand.meadow;
  };

  /** The tree whose block this tile is the trunk of, if it may stand. */
  const tree = (tx: number, ty: number): TownLandObject | null => {
    const bx = Math.floor(tx / 2);
    const by = Math.floor(ty / 2);
    const h = hash(bx, by, seed + 11, TOWN_LAND_PERIOD / 2);
    if (tx !== bx * 2 + (h & 1) || ty !== by * 2 + ((h >>> 1) & 1)) return null;
    const depth = wood(tx, ty);
    const chance =
      depth >= FOREST
        ? Math.min(0.9, 0.5 + (depth - FOREST) * 2.5)
        : inTown(tx, ty)
          ? 0.2
          : 0.06;
    if (unit(hash(tx, ty, seed + 12)) >= chance) return null;
    if (reserved(tx, ty) < 2) return null;
    for (let y = ty - CROWN.up; y <= ty + CROWN.down; y += 1)
      for (let x = tx - CROWN.left; x <= tx + CROWN.right; x += 1)
        if (reserved(x, y) === 0) return null;
    if (byLane(tx, ty) || trail(tx, ty)) return null;
    for (let y = ty - CROWN.up; y <= ty + CROWN.down; y += 1)
      for (let x = tx - CROWN.left; x <= tx + CROWN.right; x += 1)
        if (plotAt(x, y)) return null;
    const look = unit(hash(tx, ty, seed + 13));
    if (depth >= DEEP && look < 0.6)
      return { kind: "pine", x: tx, y: ty, variant: look < 0.3 ? 0 : 1 };
    const variant = depth < FOREST && look < 0.15 ? 2 : look < 0.55 ? 0 : 1;
    return { kind: "tree", x: tx, y: ty, variant };
  };

  const objectAt = (tx: number, ty: number): TownLandObject | null => {
    if (wild && isWild(tx, ty)) return wild.objectAt(tx, ty);
    if (reserved(tx, ty) === 0) return null;
    const p = plotAt(tx, ty);
    if (p) {
      if (p.kind === "pond") {
        // Reeds on a few tiles of the shore.
        if (
          !inPond(p, tx, ty) &&
          (inPond(p, tx + 1, ty) || inPond(p, tx - 1, ty)) &&
          hash(tx, ty, seed + 14) % 3 === 0
        )
          return { kind: "reeds", x: tx, y: ty, variant: 0 };
        return null;
      }
      const edge =
        tx === p.x ||
        ty === p.y ||
        tx === p.x + p.w - 1 ||
        ty === p.y + p.h - 1;
      const gate =
        ty === p.y + p.h - 1 && Math.abs(tx - (p.x + (p.w >> 1))) < 1;
      if (edge && !gate) return { kind: "hedge", x: tx, y: ty, variant: 0 };
      if (p.kind === "garden" && !edge && (ty - p.y) % 2 === 1)
        return { kind: "flowers", x: tx, y: ty, variant: p.variant };
      if (
        p.kind === "orchard" &&
        !edge &&
        (tx - p.x) % 3 === 2 &&
        (ty - p.y) % 3 === 2 &&
        ty < p.y + p.h - 1
      )
        return { kind: "tree", x: tx, y: ty, variant: p.variant % 2 ? 2 : 0 };
      return null;
    }
    const standing = tree(tx, ty);
    if (standing) return standing;
    const kind = surface(tx, ty);
    if (
      (kind !== TownLand.meadow && kind !== TownLand.forest) ||
      reserved(tx, ty) < 2
    )
      return null;
    const h = hash(tx, ty, seed + 15);
    const roll = unit(h);
    if (roll < 0.018) return { kind: "shrub", x: tx, y: ty, variant: h % 2 };
    if (roll < 0.026) return { kind: "rock", x: tx, y: ty, variant: h % 2 };
    if (kind === TownLand.meadow && roll < 0.04)
      return { kind: "flowers", x: tx, y: ty, variant: h % 4 };
    return null;
  };

  return { seed, reserved, surface, objectAt, plot };
}

/** How far (tiles) an object's drawing reaches beyond its own tile. */
export const TOWN_LAND_OBJECT_REACH = {
  left: 2,
  right: 2,
  up: 3,
  down: 1,
} as const;

/**
 * The objects whose drawings may reach the tiles x0..x1, y0..y1 (exclusive),
 * in drawing order: back rows first, left to right.
 */
export function townLandObjects(
  landscape: TownLandscape,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) {
  const objects: TownLandObject[] = [];
  const r = TOWN_LAND_OBJECT_REACH;
  for (let ty = y0 - r.down; ty < y1 + r.up; ty += 1)
    for (let tx = x0 - r.right; tx < x1 + r.left; tx += 1) {
      const object = landscape.objectAt(tx, ty);
      if (object) objects.push(object);
    }
  return objects;
}
