/**
 * The harbour's art (#1028), drawn like Town's agents and desks
 * (townSprites.ts): rectangles in a small palette, a highlight row on top
 * and a shade row below every surface, and a one-pixel dark outline round
 * every DOM sprite. No binary assets; everything is a pure function of its
 * kind and, for ships and flags, the project's colour.
 *
 * The renderer paints what never changes as outdoor sprites: the
 * warehouse's house and yard. The DOM layer (TownShipyard.tsx,
 * TownWarehouse.tsx) places what the Shipyard and the GitHub source change:
 * a pier per project with releases (planks, a stone slipway at its root and
 * bollards at the berths), the lighthouse on its head, the ships, the hull
 * on the slipway, the flags and the crates.
 */

import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_WAREHOUSE_HOUSE_ROWS,
  TOWN_WAREHOUSE_WIDTH,
  TOWN_WAREHOUSE_YARD_ROWS,
} from "./townHarbourLot";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  townSprite,
  type TownCanvas,
} from "./townSprites";

/* ---------- palette ---------- */

const WOOD = "#9b6a3f";
const WOOD_LIGHT = "#c9925c";
const WOOD_RAW = "#dcb07a";
const WOOD_DARK = "#6e4a2e";
const WOOD_EDGE = "#3b2414";
const SAIL = "#f3ecd8";
const SAIL_SHADE = "#d9cfb4";
const SAIL_DEEP = "#bfb393";
const CREAM = "#efe4c8";
const ANTIFOUL = "#7a2f2a";
const IRON = "#3a3f4a";
const IRON_LIGHT = "#6b7280";
const STONE = "#a9a29a";
const STONE_LIGHT = "#c4beb4";
const STONE_DARK = "#7c766d";
const GLASS = "#ffe39a";
const GLASS_DEEP = "#f2c46a";
const LIGHTHOUSE = "#f3ecdf";
const LIGHTHOUSE_RED = "#c94f4f";
const ROPE = "#c9a86a";
const BOARDS = "#6f8f8a";
const ROOF = "#565b6b";
const DOOR = "#8c3b32";
const INSIDE = "#2b2228";
const SETT = "#9a958c";
const SETT_DARK = "#7c776f";
const SEA_SHADOW = "rgba(10,30,50,.35)";

type Rect = (x: number, y: number, w: number, h: number, color: string) => void;

/** A Bresenham line of one-pixel rects: rigging, braces, ropes. */
function line(
  R: Rect,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  color: string,
) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    R(x, y, 1, 1, color);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** A canvas painter for ground art: no outline, the art draws its own edges. */
function painter(W: number, H: number) {
  const [canvas, g] = townCanvas(W, H);
  const rect: Rect = (x, y, w, h, color) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const disc = (cx: number, cy: number, r: number, color: string) => {
    g.fillStyle = color;
    for (let y = -r; y <= r; y += 1) {
      const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
      g.fillRect(cx - w, cy + y, w * 2, 1);
    }
  };
  return { canvas, rect, disc };
}

/* ---------- ships ---------- */

/**
 * A hull in side view, bow to the right (out to sea), `rows` tall from `top`:
 * a wooden rail, a cream band with portholes, the body in the project's
 * colour and dark antifouling at the waterline.
 */
function hull(
  R: Rect,
  color: string,
  { left, right, top, rows, rake, band }: HullShape,
) {
  for (let r = 0; r < rows; r += 1) {
    const t = r / (rows - 1);
    const x0 = left + Math.round(t * t * rake.stern);
    const x1 = right - Math.round(t * rake.bow);
    const y = top + r;
    const body = townShade(color, 0.18 - t * 0.4);
    const fill =
      r === 0
        ? WOOD_LIGHT
        : r === 1
          ? WOOD_DARK
          : r < 2 + band
            ? r === 2
              ? "#fbf3dc"
              : CREAM
            : r >= rows - 3
              ? r === rows - 1
                ? townShade(ANTIFOUL, -0.35)
                : ANTIFOUL
              : body;
    R(x0, y, x1 - x0, 1, fill);
    // The bow and stern catch the light; the counter is in shade.
    R(x1 - 2, y, 1, 1, townShade(fill, 0.22));
    R(x0, y, 1, 1, townShade(fill, -0.25));
  }
}

type HullShape = {
  left: number;
  right: number;
  top: number;
  rows: number;
  rake: { stern: number; bow: number };
  /** Rows of the cream band under the rail. */
  band: number;
};

/** A square sail on its yard, bellied by the wind from astern. */
function squareSail(R: Rect, x: number, y: number, w: number, h: number) {
  R(x - 1, y - 1, w + 2, 1, WOOD_DARK);
  for (let r = 0; r < h; r += 1) {
    const belly = r > 0 && r < h - 1 ? 1 : 0;
    R(x - belly, y + r, w + belly * 2, 1, r === h - 1 ? SAIL_SHADE : SAIL);
  }
  for (let s = x + 3; s < x + w - 1; s += 4) R(s, y + 1, 1, h - 2, SAIL_SHADE);
  R(x - 1, y + 1, 1, h - 2, SAIL_DEEP);
  R(x, y + h - 1, w, 1, SAIL_DEEP);
}

/** A triangular sail between a mast or stay and its foot, filled row by row. */
function triangleSail(
  R: Rect,
  apex: { x: number; y: number },
  foot: { x0: number; x1: number; y: number },
  lean: "fore" | "aft",
  band?: { y: number; h: number; color: string },
) {
  const rows = foot.y - apex.y;
  for (let r = 0; r <= rows; r += 1) {
    const t = r / rows;
    const span = Math.max(1, Math.round((foot.x1 - foot.x0) * t));
    const x =
      lean === "fore"
        ? apex.x + Math.round((foot.x0 - apex.x) * t)
        : apex.x - span;
    const y = apex.y + r;
    const inBand = band && y >= band.y && y < band.y + band.h;
    R(x, y, span, 1, inBand ? band.color : r === rows ? SAIL_SHADE : SAIL);
    if (span > 3) R(lean === "fore" ? x : x + span - 1, y, 1, 1, SAIL_DEEP);
  }
}

function mast(R: Rect, x: number, top: number, foot: number) {
  R(x, top, 2, foot - top, WOOD_DARK);
  R(x, top, 1, foot - top, WOOD);
}

/** A swallow-tailed pennant flying aft from a masthead. */
function pennant(R: Rect, x: number, y: number, color: string) {
  R(x, y, 7, 2, color);
  R(x, y, 7, 1, townShade(color, 0.25));
  R(x + 7, y, 2, 1, color);
  R(x + 7, y + 1, 1, 1, townShade(color, -0.2));
}

/**
 * A released ship, `TOWN_SHIP` in size: a two-masted brig for a stable
 * release, a sloop for a prerelease. Its body and pennant are the project's
 * colour; the running pennant is the DOM layer's, so it can fly.
 */
function paintShip(kind: "stable" | "prerelease", color: string) {
  return townSprite(66, 50, (R) => {
    // The water it lies in: a darker ring and two ripples at the waterline.
    R(4, 47, 60, 2, SEA_SHADOW);
    R(0, 48, 6, 1, "#7fb3d9");
    R(60, 48, 6, 1, "#7fb3d9");
    if (kind === "stable") {
      line(R, 27, 3, 6, 30, "#5b4535");
      line(R, 46, 7, 64, 33, "#5b4535");
      mast(R, 26, 3, 36);
      mast(R, 45, 7, 36);
      // The stern cabin, its windows lit.
      R(5, 29, 18, 6, WOOD);
      R(5, 29, 18, 1, WOOD_LIGHT);
      R(5, 28, 18, 1, WOOD_DARK);
      for (let x = 6; x < 22; x += 3) R(x, 27, 1, 1, WOOD_DARK);
      R(8, 31, 3, 2, GLASS);
      R(14, 31, 3, 2, GLASS);
      R(8, 32, 3, 1, GLASS_DEEP);
      R(14, 32, 3, 1, GLASS_DEEP);
      // Sails: two on each mast, then the jib to the bowsprit.
      squareSail(R, 17, 9, 20, 8);
      squareSail(R, 15, 19, 24, 11);
      squareSail(R, 37, 12, 17, 7);
      squareSail(R, 35, 21, 21, 9);
      triangleSail(R, { x: 48, y: 9 }, { x0: 64, x1: 64 + 14, y: 32 }, "fore");
      // The bowsprit.
      for (let i = 0; i < 6; i += 1) R(59 + i, 35 - i, 2, 1, WOOD_DARK);
      hull(R, color, {
        left: 2,
        right: 63,
        top: 34,
        rows: 14,
        rake: { stern: 6, bow: 9 },
        band: 3,
      });
      for (let x = 12; x < 56; x += 7) {
        R(x, 37, 2, 2, "#2b2f3a");
        R(x, 37, 1, 1, "#8fb6d6");
      }
      pennant(R, 28, 1, color);
      // The ensign at the stern, the project's colour on a staff.
      R(2, 22, 1, 13, WOOD_DARK);
      R(3, 22, 6, 4, color);
      R(3, 22, 6, 1, townShade(color, 0.3));
      R(3, 25, 6, 1, townShade(color, -0.3));
      return;
    }
    // A sloop: one mast, a gaff mainsail banded in the project's colour.
    line(R, 34, 9, 58, 37, "#5b4535");
    mast(R, 33, 9, 40);
    R(15, 35, 19, 1, WOOD_DARK);
    triangleSail(R, { x: 33, y: 11 }, { x0: 15, x1: 15 + 18, y: 34 }, "aft", {
      y: 24,
      h: 3,
      color,
    });
    triangleSail(R, { x: 36, y: 12 }, { x0: 55, x1: 55 + 14, y: 36 }, "fore");
    for (let i = 0; i < 4; i += 1) R(55 + i, 39 - i, 2, 1, WOOD_DARK);
    R(16, 36, 10, 3, WOOD);
    R(16, 36, 10, 1, WOOD_LIGHT);
    R(19, 37, 2, 1, GLASS);
    hull(R, color, {
      left: 12,
      right: 57,
      top: 38,
      rows: 10,
      rake: { stern: 4, bow: 6 },
      band: 2,
    });
    pennant(R, 35, 7, color);
  });
}

/**
 * The next release on the slipway, `TOWN_SHIP` in size: a hull in frames on
 * its cradle, planked to the turn of the bilge, a scaffold and derrick at
 * its stern and the project's flag on the derrick.
 */
function paintHullInFrame(color: string) {
  return townSprite(66, 50, (R) => {
    // The cradle's blocks on the slipway.
    for (const x of [10, 24, 38, 50]) {
      R(x, 44, 6, 5, WOOD_DARK);
      R(x, 44, 6, 1, WOOD);
    }
    R(4, 48, 58, 1, STONE_DARK);
    // Ribs above the planking, keel to sheer.
    const top = 29;
    const rows = 15;
    const sheer = (x: number) => top + Math.round(((x - 34) / 30) ** 2 * 4);
    for (let x = 8; x <= 58; x += 5) {
      const y = sheer(x);
      R(x, y, 2, 36 - y, WOOD_RAW);
      R(x + 1, y, 1, 36 - y, townShade(WOOD_RAW, -0.25));
    }
    // The planked bottom: raw strakes with their seams.
    for (let r = 7; r < rows; r += 1) {
      const t = r / (rows - 1);
      const x0 = 4 + Math.round(t * t * 6);
      const x1 = 62 - Math.round(t * 9);
      const y = top + r;
      R(x0, y, x1 - x0, 1, r % 2 ? WOOD_RAW : townShade(WOOD_RAW, -0.12));
      for (let s = x0 + ((r * 7) % 11); s < x1 - 2; s += 11)
        R(s, y, 1, 1, WOOD_DARK);
    }
    R(6, top + 7, 55, 1, townShade(WOOD_RAW, 0.25));
    R(8, top + rows - 1, 48, 1, WOOD_DARK);
    // The sheer strake running stem to stern, and the stem and stern posts.
    for (let x = 6; x < 62; x += 1) R(x, sheer(x) - 1, 1, 1, WOOD);
    R(61, 24, 2, 20, WOOD_DARK);
    R(61, 24, 1, 20, WOOD);
    R(4, 26, 2, 16, WOOD_DARK);
    // The scaffold at the stern and its plank walk.
    R(0, 14, 2, 35, WOOD_DARK);
    R(0, 14, 1, 35, WOOD);
    R(0, 30, 9, 2, WOOD);
    R(0, 31, 9, 1, WOOD_DARK);
    for (let y = 34; y < 46; y += 3) R(2, y, 4, 1, WOOD_LIGHT);
    // The derrick: its boom out over the hull, a rope down to a plank.
    line(R, 1, 14, 30, 6, WOOD_DARK);
    line(R, 1, 15, 30, 7, WOOD);
    R(29, 7, 1, 10, ROPE);
    R(24, 17, 12, 2, WOOD_LIGHT);
    R(24, 18, 12, 1, WOOD_DARK);
    // The project's flag on the derrick's head.
    R(0, 4, 1, 10, WOOD_DARK);
    R(1, 4, 8, 5, color);
    R(1, 4, 8, 1, townShade(color, 0.3));
    R(1, 8, 8, 1, townShade(color, -0.3));
  });
}

/* ---------- flags ---------- */

/**
 * A flag's two frames side by side, `TOWN_FLAG` each, flying right: the
 * project's flag on its lane's pole, or the green pennant of a running
 * release. CSS steps between the frames.
 */
function paintFlag(color: string, shape: "flag" | "pennant") {
  const frame = (wave: number) =>
    townSprite(12, 8, (R) => {
      if (shape === "pennant") {
        for (let x = 0; x < 12; x += 1) {
          const h = Math.max(1, 6 - Math.floor(x / 2));
          const y = (x + wave) % 4 === 0 ? 1 : 0;
          R(x, y + Math.floor((6 - h) / 2), 1, h, color);
        }
        R(0, 1, 2, 1, townShade(color, 0.3));
        return;
      }
      for (let x = 0; x < 12; x += 1) {
        const y = Math.floor((x + wave * 2) / 3) % 2;
        R(x, y, 1, 7, color);
        R(x, y, 1, 1, townShade(color, 0.3));
        R(x, y + 6, 1, 1, townShade(color, -0.3));
      }
      // A cream canton: every project flag reads as a flag, not a sign.
      R(0, 1, 4, 3, CREAM);
    });
  const [sheet, g] = townCanvas(28, 10);
  g.drawImage(frame(0), 0, 0);
  g.drawImage(frame(1), 14, 0);
  return sheet;
}

/* ---------- crates ---------- */

export type TownCrateState =
  | "ready"
  | "failing"
  | "waiting"
  | "unknown"
  | "draft";

const CRATE_WOOD = "#c8915a";
const CRATE_LID = "#dcae7a";
const STRAPS: Record<"ready" | "failing" | "waiting", string> = {
  ready: "#3fae5c",
  failing: "#d4252b",
  waiting: "#e3aa3a",
};

/**
 * A pull request's crate, 16 by 13 outlined: a slatted crate with its
 * state's strap and stencil (a green tick, a red cross band, an amber
 * hourglass), a grey tarpaulin when unknown, and a draft only planks on a
 * pallet, not yet a crate.
 */
function paintCrate(state: TownCrateState) {
  return townSprite(14, 11, (R) => {
    if (state === "draft") {
      R(0, 8, 14, 3, WOOD_DARK);
      R(0, 8, 14, 1, WOOD);
      R(2, 10, 2, 1, WOOD_EDGE);
      R(10, 10, 2, 1, WOOD_EDGE);
      R(1, 5, 12, 2, CRATE_LID);
      R(1, 6, 12, 1, townShade(CRATE_LID, -0.2));
      R(3, 3, 9, 2, "#f1ead6");
      R(4, 3, 5, 1, "#b8ad94");
      return;
    }
    if (state === "unknown") {
      R(0, 2, 14, 9, "#9aa3ad");
      R(1, 0, 12, 3, "#b7bec6");
      R(0, 10, 14, 1, "#6b7380");
      R(3, 3, 1, 7, "#828b96");
      R(9, 2, 1, 8, "#828b96");
      R(0, 6, 14, 1, ROPE);
      R(6, 4, 2, 1, "#5d6574");
      R(7, 5, 1, 1, "#5d6574");
      R(6, 7, 1, 1, "#5d6574");
      R(6, 9, 1, 1, "#5d6574");
      return;
    }
    R(0, 0, 14, 11, CRATE_WOOD);
    R(0, 0, 14, 3, CRATE_LID);
    R(0, 0, 14, 1, townShade(CRATE_LID, 0.3));
    R(0, 3, 14, 1, townShade(CRATE_WOOD, -0.3));
    R(0, 7, 14, 1, townShade(CRATE_WOOD, -0.18));
    R(0, 3, 1, 8, townShade(CRATE_WOOD, -0.25));
    R(13, 3, 1, 8, townShade(CRATE_WOOD, -0.38));
    R(0, 10, 14, 1, townShade(CRATE_WOOD, -0.4));
    const strap = STRAPS[state];
    if (state === "failing") {
      R(0, 5, 14, 2, strap);
      R(0, 5, 14, 1, townShade(strap, 0.25));
      R(2, 1, 2, 1, strap);
      R(4, 2, 1, 1, strap);
      R(2, 2, 1, 1, strap);
      R(4, 1, 1, 1, strap);
      return;
    }
    R(10, 0, 2, 11, strap);
    R(10, 0, 1, 11, townShade(strap, 0.25));
    if (state === "ready") {
      R(2, 7, 1, 1, strap);
      R(3, 8, 1, 1, strap);
      R(4, 7, 1, 1, strap);
      R(5, 6, 1, 1, strap);
      R(6, 5, 1, 1, strap);
      // A brass tag: ready glints.
      R(1, 0, 3, 2, "#ffd166");
      return;
    }
    // Waiting: an hourglass stencil.
    R(3, 4, 5, 1, strap);
    R(4, 5, 3, 1, strap);
    R(5, 6, 1, 1, strap);
    R(4, 7, 3, 1, strap);
    R(3, 8, 5, 1, strap);
  });
}

/* ---------- the pier and its lighthouse ---------- */

/** The pier's drawing: its deck's top row, and its height in pixels. */
export const TOWN_PIER_ART = { deck: 28, h: 50 } as const;

let pierCache: { w: number; canvas: TownCanvas } | null = null;

/**
 * A lane's pier, `w` pixels long from the promenade: a stone slipway at its
 * root under the hull being built, then plank deck with an iron bollard at
 * each berth, out to a square head for the lighthouse (paintTownLighthouse,
 * drawn above the ships). Pilings and their shadow stand in the water
 * below it.
 */
export function paintTownPier(
  w: number,
  slipway: { x: number; w: number },
  bollards: readonly number[],
): TownCanvas {
  if (pierCache?.w === w) return pierCache.canvas;
  const { canvas, rect, disc } = painter(w, TOWN_PIER_ART.h);
  const top = TOWN_PIER_ART.deck;
  const deck = 12;
  const head = { x: w - 44, w: 44 };
  // Shadow on the water, then the pilings standing in it.
  rect(2, top + deck + 2, w - 2, 5, SEA_SHADOW);
  for (let x = 6; x < w - 4; x += 24) {
    rect(x, top + deck, 4, 7, "#4a3424");
    rect(x, top + deck, 1, 7, WOOD_DARK);
    rect(x - 1, top + deck + 6, 6, 1, "#7fb3d9");
  }
  // The head's wider platform.
  rect(head.x, top - 6, head.w, deck + 12, WOOD_EDGE);
  rect(head.x + 1, top - 5, head.w - 2, deck + 9, WOOD);
  for (let x = head.x + 1; x < w - 1; x += 5)
    rect(x, top - 5, 1, deck + 9, WOOD_DARK);
  rect(head.x + 1, top - 5, head.w - 2, 1, WOOD_LIGHT);
  rect(head.x, top + deck + 4, head.w, 2, townShade(WOOD_DARK, -0.3));
  // The deck: planks across the pier, a dark edge each side.
  rect(0, top, head.x + 1, deck, WOOD_EDGE);
  for (let x = 0, n = 0; x < head.x; x += 4, n += 1) {
    const tint = n % 3 === 0 ? 0.08 : n % 3 === 1 ? 0 : -0.06;
    rect(x, top + 1, 4, deck - 3, townShade(WOOD, tint));
    rect(x + 3, top + 1, 1, deck - 3, WOOD_DARK);
    if (n % 2) rect(x + 1, top + 2, 1, 1, WOOD_EDGE);
  }
  rect(0, top + 1, head.x, 1, WOOD_LIGHT);
  rect(0, top + deck - 2, head.x + 1, 2, townShade(WOOD_DARK, -0.3));
  // The slipway at the root: dressed stone with two iron rails.
  rect(slipway.x, top, slipway.w, deck, STONE_DARK);
  for (let x = slipway.x, n = 0; x < slipway.x + slipway.w; x += 8, n += 1) {
    rect(x + 1, top + 1, 7, 4, n % 2 ? STONE : STONE_LIGHT);
    rect(x + 4 - (n % 2) * 4, top + 6, 7, 3, n % 2 ? STONE_LIGHT : STONE);
  }
  rect(slipway.x, top + 3, slipway.w, 1, IRON);
  rect(slipway.x, top + 8, slipway.w, 1, IRON);
  // A bollard at each berth, a coil of rope beside the first.
  for (const [i, x] of bollards.entries()) {
    rect(x - 2, top - 2, 5, 5, TOWN_OUTLINE);
    rect(x - 1, top - 1, 3, 3, IRON);
    rect(x - 1, top - 1, 3, 1, IRON_LIGHT);
    if (!i) {
      disc(x + 8, top + 5, 3, ROPE);
      disc(x + 8, top + 5, 1, townShade(ROPE, -0.4));
    }
  }
  pierCache = { w, canvas };
  return canvas;
}

/**
 * A striped lighthouse, 20 by 28 pixels (TOWN_LIGHTHOUSE in
 * townHarbour.ts), standing on its bottom rows: its lamp room's glass is
 * dark; the DOM layer lights it in main's colour.
 */
export function paintTownLighthouse(): TownCanvas {
  const { canvas, rect } = painter(20, 28);
  paintLighthouse(rect, 0, 26);
  return canvas;
}

function paintLighthouse(rect: Rect, x: number, foot: number) {
  const tower = 11;
  rect(x + 1, foot - 2, 18, 3, "rgba(0,0,0,.25)");
  for (let y = tower; y < foot; y += 1) {
    const t = (y - tower) / (foot - tower);
    const half = 5 + Math.round(t * 3);
    const band = Math.floor((y - tower) / 4) % 2 === 1;
    const fill = band ? LIGHTHOUSE_RED : LIGHTHOUSE;
    rect(x + 10 - half - 1, y, half * 2 + 2, 1, TOWN_OUTLINE);
    rect(x + 10 - half, y, half * 2, 1, fill);
    rect(x + 10 - half, y, 2, 1, townShade(fill, 0.2));
    rect(x + 10 + half - 3, y, 3, 1, townShade(fill, -0.22));
  }
  // The door at its foot.
  rect(x + 8, foot - 6, 4, 6, WOOD_DARK);
  rect(x + 8, foot - 6, 4, 1, TOWN_OUTLINE);
  // The gallery, the lamp room and its red cap.
  rect(x + 1, 9, 18, 2, TOWN_OUTLINE);
  rect(x + 2, 9, 16, 1, IRON_LIGHT);
  rect(x + 3, 3, 14, 6, TOWN_OUTLINE);
  rect(x + 4, 4, 12, 5, "#2b2f3a");
  for (let i = 0; i < 3; i += 1) {
    rect(x + 3 + i * 2, 2 - i, 14 - i * 4, 1, TOWN_OUTLINE);
    rect(x + 4 + i * 2, 2 - i, 12 - i * 4, 1, LIGHTHOUSE_RED);
  }
}

/* ---------- the warehouse (renderer) ---------- */

let warehouseHouse: TownCanvas | null = null;
let warehouseYard: TownCanvas | null = null;

/** The warehouse: TOWN_WAREHOUSE_WIDTH tiles wide, its loading door on its bottom row. */
export function paintTownWarehouseHouse(): TownCanvas {
  warehouseHouse ??= paintHouse(
    TOWN_WAREHOUSE_WIDTH * T,
    TOWN_WAREHOUSE_HOUSE_ROWS * T,
  );
  return warehouseHouse;
}

/** The yard: stone setts, a loading line and a hand cart at its right end. */
export function paintTownWarehouseYard(): TownCanvas {
  warehouseYard ??= paintYard(
    TOWN_WAREHOUSE_WIDTH * T,
    TOWN_WAREHOUSE_YARD_ROWS * T,
  );
  return warehouseYard;
}

function paintHouse(W: number, H: number) {
  const { canvas, rect, disc } = painter(W, H);
  const mid = Math.round(W / 2);
  const eave = 30;
  const plinth = H - 5;
  rect(8, H - 6, W - 10, 6, "rgba(0,0,0,.2)");

  // A corrugated roof, its ribs catching the light, and the loft gable.
  rect(2, 6, W - 4, eave - 4, TOWN_OUTLINE);
  for (let x = 3, n = 0; x < W - 3; x += 1, n += 1) {
    const rib = n % 4;
    rect(
      x,
      7,
      1,
      eave - 7,
      rib === 0
        ? townShade(ROOF, 0.25)
        : rib === 1
          ? ROOF
          : townShade(ROOF, -0.18),
    );
  }
  rect(3, 7, W - 6, 2, townShade(ROOF, 0.35));
  rect(3, eave - 3, W - 6, 2, townShade(ROOF, -0.45));
  rect(3, eave - 1, W - 6, 1, TOWN_OUTLINE);
  for (let y = 0; y < 22; y += 1) {
    const half = 6 + Math.round((y / 22) * 22);
    rect(mid - half - 1, y, half * 2 + 2, 1, TOWN_OUTLINE);
    rect(
      mid - half,
      y,
      half * 2,
      1,
      y < 2
        ? townShade(ROOF, 0.35)
        : y % 4 === 3
          ? townShade(BOARDS, -0.3)
          : BOARDS,
    );
  }
  // The loft door, and the hoist beam over it with its rope and hook.
  rect(mid - 6, 8, 12, 14, TOWN_OUTLINE);
  rect(mid - 5, 9, 10, 13, DOOR);
  rect(mid - 5, 9, 10, 1, townShade(DOOR, 0.3));
  rect(mid, 9, 1, 13, townShade(DOOR, -0.4));
  rect(mid - 3, 2, 22, 3, WOOD_DARK);
  rect(mid - 3, 2, 22, 1, WOOD);
  disc(mid + 16, 6, 2, IRON);
  rect(mid + 16, 6, 1, 32, ROPE);
  rect(mid + 15, 37, 3, 2, IRON);
  rect(mid + 17, 38, 1, 2, IRON);

  // Weatherboard walls between corner posts.
  rect(2, eave, W - 4, plinth - eave, TOWN_OUTLINE);
  for (let y = eave, n = 0; y < plinth; y += 4, n += 1) {
    rect(3, y, W - 6, 4, n % 2 ? BOARDS : townShade(BOARDS, 0.06));
    rect(3, y + 3, W - 6, 1, townShade(BOARDS, -0.3));
  }
  for (const x of [3, W - 9]) {
    rect(x, eave, 6, plinth - eave, WOOD_DARK);
    rect(x, eave, 2, plinth - eave, WOOD);
  }
  rect(3, eave, W - 6, 1, townShade(BOARDS, -0.5));

  // High windows either side, lit.
  for (const x of [22, W - 46]) {
    rect(x - 1, eave + 10, 26, 14, TOWN_OUTLINE);
    rect(x, eave + 11, 24, 12, GLASS);
    rect(x, eave + 17, 24, 6, GLASS_DEEP);
    rect(x + 11, eave + 11, 2, 12, WOOD_DARK);
    rect(x, eave + 16, 24, 1, WOOD_DARK);
    rect(x - 3, eave + 23, 30, 3, WOOD);
    rect(x - 3, eave + 23, 30, 1, WOOD_LIGHT);
  }

  // The loading door, open: a lit interior with crates, its leaves
  // swung out either side.
  const doorY = eave + 26;
  rect(mid - 23, doorY - 3, 46, plinth - doorY + 3, TOWN_OUTLINE);
  rect(mid - 22, doorY - 2, 44, 2, WOOD);
  rect(mid - 21, doorY, 42, plinth - doorY, INSIDE);
  rect(mid - 21, doorY, 42, 3, "#3d3238");
  disc(mid, doorY + 6, 3, "#ffd27a");
  rect(mid, doorY, 1, 3, IRON);
  for (const [x, y, w, h] of [
    [mid - 18, plinth - 12, 12, 12],
    [mid - 16, plinth - 20, 9, 8],
    [mid + 7, plinth - 10, 11, 10],
  ] as const) {
    rect(x, y, w, h, "#6b4a32");
    rect(x, y, w, 1, "#8a6040");
    rect(x + Math.floor(w / 2), y, 1, h, "#4a3224");
  }
  for (const side of [-1, 1]) {
    const x = side < 0 ? mid - 31 : mid + 23;
    rect(x, doorY - 1, 8, plinth - doorY + 1, TOWN_OUTLINE);
    rect(x + 1, doorY, 6, plinth - doorY, DOOR);
    rect(x + 1, doorY, 6, 1, townShade(DOOR, 0.3));
    for (let y = doorY + 2; y < plinth - 1; y += 1) {
      const t = (y - doorY - 2) / (plinth - doorY - 3);
      rect(x + 1 + Math.round(t * 5), y, 1, 1, townShade(DOOR, -0.4));
    }
  }

  // Barrels left of the door; a lantern and a life ring on the wall right.
  for (const x of [16, 30]) {
    rect(x, plinth - 15, 12, 15, TOWN_OUTLINE);
    rect(x + 1, plinth - 14, 10, 14, WOOD);
    rect(x + 1, plinth - 14, 3, 14, WOOD_LIGHT);
    rect(x + 8, plinth - 14, 3, 14, WOOD_DARK);
    rect(x + 1, plinth - 11, 10, 1, IRON);
    rect(x + 1, plinth - 4, 10, 1, IRON);
  }
  rect(18, plinth - 22, 10, 7, TOWN_OUTLINE);
  rect(19, plinth - 21, 8, 6, WOOD_LIGHT);
  rect(19, plinth - 21, 8, 1, WOOD_RAW);
  const ring = { x: W - 34, y: eave + 34 };
  disc(ring.x, ring.y, 7, TOWN_OUTLINE);
  disc(ring.x, ring.y, 6, "#f3ecdf");
  for (const [dx, dy] of [
    [-5, -1],
    [3, -1],
    [-1, -6],
    [-1, 3],
  ] as const)
    rect(ring.x + dx, ring.y + dy, 3, 3, LIGHTHOUSE_RED);
  disc(ring.x, ring.y, 3, TOWN_OUTLINE);
  disc(ring.x, ring.y, 2, BOARDS);
  rect(W - 54, eave + 30, 5, 7, TOWN_OUTLINE);
  rect(W - 53, eave + 31, 3, 5, "#ffd27a");

  // The plinth and the step onto the yard.
  rect(2, plinth, W - 4, 5, STONE_DARK);
  rect(2, plinth, W - 4, 1, STONE_LIGHT);
  rect(mid - 21, H - 3, 42, 3, STONE);
  rect(mid - 21, H - 3, 42, 1, STONE_LIGHT);
  return canvas;
}

function paintYard(W: number, H: number) {
  const { canvas, rect, disc } = painter(W, H);
  rect(3, 4, W - 3, H - 4, "rgba(0,0,0,.16)");
  rect(1, 1, W - 4, H - 4, SETT_DARK);
  // Stone setts in staggered courses.
  for (let y = 2, row = 0; y < H - 4; y += 5, row += 1)
    for (let x = 2 - (row % 2) * 4; x < W - 4; x += 8) {
      const x0 = Math.max(2, x);
      const w = Math.min(x + 7, W - 4) - x0;
      if (w <= 0) continue;
      rect(x0, y, w, 4, (x + row * 3) % 3 ? SETT : townShade(SETT, 0.06));
      rect(x0, y, w, 1, townShade(SETT, 0.18));
    }
  // The loading line along the front edge.
  rect(2, H - 7, W - 6, 2, "#e3c35a");
  for (let x = 6; x < W - 6; x += 12) rect(x, H - 7, 6, 2, "#c9a63c");
  // The hand cart at the right end: a flatbed on two wheels, its handle up.
  const cx = W - 34;
  rect(cx - 1, 15, 26, 16, TOWN_OUTLINE);
  rect(cx, 16, 24, 13, WOOD);
  for (let x = cx + 5; x < cx + 24; x += 6) rect(x, 16, 1, 13, WOOD_DARK);
  rect(cx, 16, 24, 1, WOOD_LIGHT);
  rect(cx, 28, 24, 1, WOOD_EDGE);
  rect(cx + 23, 6, 2, 12, IRON);
  rect(cx + 22, 5, 6, 2, IRON);
  for (const x of [cx + 4, cx + 18]) {
    disc(x, 33, 5, TOWN_OUTLINE);
    disc(x, 33, 4, WOOD_DARK);
    disc(x, 33, 1, IRON_LIGHT);
  }
  // A mooring bollard at the corner.
  rect(W - 10, H - 15, 7, 7, TOWN_OUTLINE);
  rect(W - 9, H - 14, 5, 5, IRON);
  rect(W - 9, H - 14, 5, 1, IRON_LIGHT);
  return canvas;
}

/* ---------- image URLs for the DOM layer ---------- */

const urls = new Map<string, string>();

/** A drawing as an image URL, drawn once; empty where there is no canvas (tests). */
function url(key: string, draw: () => TownCanvas) {
  let value = urls.get(key);
  if (value === undefined) {
    try {
      value = draw().toDataURL();
    } catch {
      value = "";
    }
    urls.set(key, value);
  }
  return value;
}

export const townShipUrl = (kind: "stable" | "prerelease", color: string) =>
  url(`ship:${kind}:${color}`, () => paintShip(kind, color));

export const townHullUrl = (color: string) =>
  url(`hull:${color}`, () => paintHullInFrame(color));

export const townFlagUrl = (color: string, shape: "flag" | "pennant") =>
  url(`flag:${shape}:${color}`, () => paintFlag(color, shape));

export const townPierUrl = (
  w: number,
  slipway: { x: number; w: number },
  bollards: readonly number[],
) =>
  url(`pier:${w}:${slipway.x}:${slipway.w}:${bollards.join(",")}`, () =>
    paintTownPier(w, slipway, bollards),
  );

export const townLighthouseUrl = () =>
  url("lighthouse", () => paintTownLighthouse());

export const townCrateUrl = (state: TownCrateState) =>
  url(`crate:${state}`, () => paintCrate(state));
