/**
 * Drawing the generated landscape (townLandscape.ts) into a ground chunk:
 * its tiles (woodland floor, footpaths, lanes, ponds and garden beds) and
 * the trees, hedges, shrubs, rocks, reeds and flowers standing on them.
 * Every drawing is a small canvas made once, in Town's sprite recipe.
 */

import { TownLand, type TownLandObject } from "./townLandscape";
import { TOWN_TILE as T } from "./townLayout";
import {
  townCanvas,
  townRandom,
  townShade,
  townSprite,
  townTrees,
  type TownCanvas,
} from "./townSprites";

const made = new Map<string, TownCanvas>();
function once(key: string, make: () => TownCanvas) {
  let canvas = made.get(key);
  if (!canvas) made.set(key, (canvas = make()));
  return canvas;
}
function tile(key: string, draw: (g: CanvasRenderingContext2D) => void) {
  return once(key, () => {
    const [canvas, g] = townCanvas(T, T);
    draw(g);
    return canvas;
  });
}

const speckle = (
  g: CanvasRenderingContext2D,
  seed: number,
  count: number,
  colors: readonly string[],
) => {
  const random = townRandom(seed);
  for (let i = 0; i < count; i += 1) {
    g.fillStyle = colors[(random() * colors.length) | 0]!;
    g.fillRect((random() * T) | 0, (random() * T) | 0, 1, 1);
  }
};

/** Which neighbours share the tile's kind: bit 1 up, 2 right, 4 down, 8 left. */
export type TownLandEdges = number;

/** Draw a path's edges where it meets grass: a darker rim and a few tufts. */
function rim(
  g: CanvasRenderingContext2D,
  same: TownLandEdges,
  color: string,
  tuft: string,
) {
  g.fillStyle = color;
  if (!(same & 1)) g.fillRect(0, 0, T, 1);
  if (!(same & 2)) g.fillRect(T - 1, 0, 1, T);
  if (!(same & 4)) g.fillRect(0, T - 1, T, 1);
  if (!(same & 8)) g.fillRect(0, 0, 1, T);
  g.fillStyle = tuft;
  if (!(same & 1)) g.fillRect(5, 1, 1, 1);
  if (!(same & 4)) g.fillRect(10, T - 2, 1, 1);
  if (!(same & 8)) g.fillRect(1, 9, 1, 1);
  if (!(same & 2)) g.fillRect(T - 2, 4, 1, 1);
}

/** How many drawings each tile kind has; a tile's hash picks one. */
const TILE_VARIANTS: Record<number, number> = {
  [TownLand.forest]: 6,
  [TownLand.trail]: 4,
  [TownLand.lane]: 4,
  [TownLand.water]: 4,
  [TownLand.bed]: 3,
  [TownLand.gravel]: 3,
  [TownLand.lawn]: 2,
};
/** Kinds whose drawing has edges where they meet another kind. */
const EDGED = new Set<number>([TownLand.trail, TownLand.lane, TownLand.water]);

/**
 * A landscape tile of `kind` other than meadow (townPaint.ts draws meadow as
 * the town's grass); `variant` comes from the tile's hash, `same` from its
 * neighbours. The drawing depends only on the cache key (kind, variant bucket
 * and, for edged kinds, `same`), so the same layout and seed paint the same
 * pixels whichever tile reaches the cache first.
 */
export function townLandTile(
  kind: number,
  variant: number,
  same: TownLandEdges,
): TownCanvas {
  const count = TILE_VARIANTS[kind] ?? TILE_VARIANTS[TownLand.lawn]!;
  const bucket = ((variant % count) + count) % count;
  const edges = EDGED.has(kind) ? same : 0;
  return tile(`land:${kind}:${bucket}:${edges}`, (g) =>
    paintTownLandTile(g, kind, bucket, edges),
  );
}

/** Draw one landscape tile from its normalized `bucket` and `same` edges. */
export function paintTownLandTile(
  g: CanvasRenderingContext2D,
  kind: number,
  bucket: number,
  same: TownLandEdges,
) {
  switch (kind) {
    case TownLand.forest:
      g.fillStyle = "#4f8a3e";
      g.fillRect(0, 0, T, T);
      speckle(g, bucket * 31 + 5, 9, ["#457c35", "#5a9748", "#6b7a3a"]);
      if (bucket % 3 === 0) {
        g.fillStyle = "#7a6a3a";
        g.fillRect(4 + bucket, 9, 2, 1);
      }
      return;
    case TownLand.trail:
    case TownLand.lane: {
      const lane = kind === TownLand.lane;
      g.fillStyle = lane ? "#a98d5f" : "#bfa271";
      g.fillRect(0, 0, T, T);
      speckle(
        g,
        bucket * 17 + (lane ? 3 : 9),
        lane ? 10 : 6,
        lane ? ["#957a50", "#b89c6c"] : ["#a88c5e", "#cdb385"],
      );
      rim(g, same, lane ? "#8a7149" : "#9b8458", "#5c9a48");
      return;
    }
    case TownLand.water:
      g.fillStyle = "#4f9fd3";
      g.fillRect(0, 0, T, T);
      speckle(g, bucket * 13 + 1, 4, ["#6fb9e6", "#8fd0f2"]);
      if (bucket === 1) {
        g.fillStyle = "#5aa857";
        g.fillRect(6, 7, 3, 2);
        g.fillRect(7, 6, 1, 1);
      }
      // The bank: a shadowed edge on top, a pale rim elsewhere.
      g.fillStyle = "#3f7fb0";
      if (!(same & 1)) g.fillRect(0, 0, T, 2);
      g.fillStyle = "#b9b28e";
      if (!(same & 2)) g.fillRect(T - 1, 0, 1, T);
      if (!(same & 4)) g.fillRect(0, T - 1, T, 1);
      if (!(same & 8)) g.fillRect(0, 0, 1, T);
      return;
    case TownLand.bed:
      g.fillStyle = "#7a5638";
      g.fillRect(0, 0, T, T);
      g.fillStyle = "#664730";
      g.fillRect(0, 4, T, 1);
      g.fillRect(0, 10, T, 1);
      speckle(g, bucket * 7 + 2, 4, ["#8a6444"]);
      return;
    case TownLand.gravel:
      g.fillStyle = "#d2c4a2";
      g.fillRect(0, 0, T, T);
      speckle(g, bucket * 11 + 4, 10, ["#bfb08c", "#e0d5b8"]);
      return;
    default:
      // Lawn: mown stripes, alternating by column.
      g.fillStyle = bucket ? "#64a24f" : "#6cab57";
      g.fillRect(0, 0, T, T);
      speckle(g, bucket + 21, 3, ["#5c9a48"]);
  }
}

const pine = (dark: string, mid: string, light: string) =>
  townSprite(
    22,
    38,
    (R) => {
      R(9, 30, 4, 8, "#5e4129");
      for (let i = 0; i < 4; i += 1) {
        const top = 2 + i * 7;
        for (let row = 0; row < 11; row += 1) {
          const half = Math.min(10, 2 + i + (row >> 1) + (row > 4 ? 1 : 0));
          R(11 - half, top + row, half * 2, 1, row > 7 ? dark : mid);
        }
        R(10 - i, top + 3, 2, 1, light);
      }
      R(10, 0, 2, 3, mid);
    },
    "#14231a",
  );
const pines = () =>
  [
    once("pine:0", () => pine("#1f4d33", "#2a6040", "#3f7f52")),
    once("pine:1", () => pine("#24543a", "#2f6a46", "#4a8a5a")),
  ] as const;

const hedge = () =>
  once("hedge", () =>
    townSprite(
      16,
      13,
      (R) => {
        R(0, 1, 16, 12, "#2f6b38");
        R(1, 0, 14, 1, "#2f6b38");
        R(1, 1, 14, 3, "#3f8a45");
        R(3, 1, 2, 1, "#5aa857");
        R(10, 2, 2, 1, "#5aa857");
        R(0, 10, 16, 3, "#255a2e");
      },
      "#1b2a1f",
    ),
  );

const shrub = (variant: number) =>
  once(`shrub:${variant}`, () =>
    townSprite(
      14,
      10,
      (R, D) => {
        const leaf = variant ? "#3f8346" : "#4a8f3e";
        D(4, 6, 4, townShade(leaf, -0.15));
        D(9, 6, 4, townShade(leaf, -0.15));
        D(7, 4, 4, leaf);
        R(6, 2, 2, 1, townShade(leaf, 0.35));
        if (variant) R(3, 5, 1, 1, "#f2a5c4");
      },
      "#1b2a1f",
    ),
  );

const rock = (variant: number) =>
  once(`rock:${variant}`, () =>
    townSprite(variant ? 9 : 7, variant ? 6 : 5, (R) => {
      const w = variant ? 9 : 7;
      const h = variant ? 6 : 5;
      R(1, 0, w - 2, h, "#8d8a84");
      R(0, 1, w, h - 1, "#8d8a84");
      R(1, 1, w - 3, 1, "#b3afa7");
      R(0, h - 1, w, 1, "#6c6964");
    }),
  );

const reeds = () =>
  once("reeds", () =>
    townSprite(
      10,
      12,
      (R) => {
        for (const [x, h] of [
          [1, 9],
          [3, 12],
          [5, 8],
          [7, 11],
          [9, 7],
        ] as const) {
          R(x, 12 - h, 1, h, "#4f7f3a");
          R(x, 12 - h, 1, 2, "#7a5a35");
        }
      },
      null,
    ),
  );

const FLOWER_COLORS = ["#f2a5c4", "#f5e27a", "#b9d4ff", "#ff9c7a"] as const;
const flowers = (variant: number) =>
  once(`flowers:${variant}`, () =>
    townSprite(
      T,
      T,
      (R) => {
        const color = FLOWER_COLORS[variant % FLOWER_COLORS.length]!;
        const random = townRandom(variant * 97 + 3);
        for (let i = 0; i < 6; i += 1) {
          const x = 1 + ((random() * 12) | 0);
          const y = 2 + ((random() * 10) | 0);
          R(x, y + 1, 1, 2, "#3f7f3a");
          R(x - 1, y, 3, 1, color);
          R(x, y - 1, 1, 1, townShade(color, 0.4));
        }
      },
      null,
    ),
  );

function ellipse(
  g: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
) {
  for (let y = -ry; y <= ry; y += 1) {
    const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y * y) / (ry * ry))));
    g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
  }
}

/** Draw the landscape's objects in order; `g` is in world pixels. */
export function paintTownLandObjects(
  g: CanvasRenderingContext2D,
  objects: readonly TownLandObject[],
) {
  for (const o of objects) {
    const x = o.x * T;
    const y = o.y * T;
    switch (o.kind) {
      case "tree":
        g.fillStyle = "rgba(10,30,10,.22)";
        ellipse(g, x + 11, y + 15, 13, 5);
        g.drawImage(townTrees()[o.variant]!, x - 9, y - 29);
        break;
      case "pine":
        g.fillStyle = "rgba(10,30,10,.22)";
        ellipse(g, x + 10, y + 15, 9, 4);
        g.drawImage(pines()[o.variant]!, x - 4, y - 24);
        break;
      case "hedge":
        g.drawImage(hedge(), x - 1, y - 1);
        break;
      case "shrub":
        g.drawImage(shrub(o.variant), x, y + 4);
        break;
      case "rock":
        g.drawImage(rock(o.variant), x + 4, y + 8);
        break;
      case "reeds":
        g.drawImage(reeds(), x + 3, y + 2);
        break;
      case "flowers":
        g.drawImage(flowers(o.variant), x, y);
        break;
    }
  }
}
