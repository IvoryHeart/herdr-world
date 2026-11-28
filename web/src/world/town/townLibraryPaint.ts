/**
 * The library's art (#1027), in Town's pixel style and palette: a sandstone
 * hall under a verdigris copper roof, an open-book medallion in its gable,
 * three tall arched windows lit warm over shelves of coloured spines, twin
 * lanterns at a panelled door, and in front a reading garden with a gravel
 * path, a bench, a flower bed and a cart of books waiting to be shelved.
 * The books stand for memory files; the art paints no counts or states, which
 * are the DOM sign's (TownLibrary.tsx). Painted once and shared; the renderer
 * places the house and the garden as two outdoor sprites, and the Library
 * dialog shows the same house as its banner (townLibraryBanner).
 */

import {
  artLibraryHouse,
  artLibraryYard,
  townArtLandmark,
} from "./townArtLandmarks";
import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_LIBRARY_HOUSE_ROWS,
  TOWN_LIBRARY_WIDTH,
  TOWN_LIBRARY_YARD_ROWS,
} from "./townLibraryLot";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  type TownCanvas,
} from "./townSprites";

const SAND = "#e6cf9f";
const SAND_SHADE = "#c9ad78";
const SAND_DARK = "#8f7550";
const COPPER = "#4f9a86";
const COPPER_DARK = "#2f6b5c";
const GLASS = "#ffe0a0";
const GLASS_DEEP = "#f0b860";
const SHELF = "#5b3a24";
const DOOR = "#4a2d1f";
const GOLD = "#e8c75a";
const GRASS = "#6fae5a";
const GRAVEL = "#d9cfb8";
const WOOD = "#9b6a3f";
const WOOD_DARK = "#6e4a2e";
/** Book spines: kinds of memory, warm and readable at Town's zoom. */
export const TOWN_LIBRARY_SPINES = [
  "#c8553d",
  "#3f7cac",
  "#e0a83a",
  "#5c9e5a",
  "#8a5aa8",
  "#d07a9c",
] as const;

let house: TownCanvas | null = null;
let yard: TownCanvas | null = null;
let banner: string | null = null;

function painter(W: number, H: number) {
  const [canvas, g] = townCanvas(W, H);
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
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
  return { canvas, g, rect, disc };
}

/** The hall: TOWN_LIBRARY_WIDTH tiles wide, its door on its bottom row. */
export function paintTownLibraryHouse(): TownCanvas {
  const art = townArtLandmark("library-house", (style) =>
    artLibraryHouse(style, TOWN_LIBRARY_WIDTH * T, TOWN_LIBRARY_HOUSE_ROWS * T),
  );
  if (art) return art;
  if (!house)
    house = paintHouse(TOWN_LIBRARY_WIDTH * T, TOWN_LIBRARY_HOUSE_ROWS * T);
  return house;
}

/** The reading garden in front of the door. */
export function paintTownLibraryYard(): TownCanvas {
  const art = townArtLandmark("library-yard", (style) =>
    artLibraryYard(style, TOWN_LIBRARY_WIDTH * T, TOWN_LIBRARY_YARD_ROWS * T),
  );
  if (art) return art;
  if (!yard)
    yard = paintYard(TOWN_LIBRARY_WIDTH * T, TOWN_LIBRARY_YARD_ROWS * T);
  return yard;
}

/**
 * The hall as an image URL for the Library dialog's banner, so the dialog
 * and the building are visibly one place. Null where there is no canvas.
 */
export function townLibraryBanner(): string | null {
  if (banner) return banner;
  try {
    banner = paintTownLibraryHouse().toDataURL("image/png");
  } catch {
    banner = null;
  }
  return banner;
}

/** A shelf of spines between x and x + w on baseline y, `h` tall at most. */
function spines(
  rect: (x: number, y: number, w: number, h: number, c: string) => void,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
) {
  let at = x;
  let i = seed;
  while (at < x + w - 1) {
    const bw = 2 + (i % 2);
    const bh = h - ((i * 7) % 3);
    if (at + bw > x + w) break;
    rect(
      at,
      y - bh,
      bw,
      bh,
      TOWN_LIBRARY_SPINES[i % TOWN_LIBRARY_SPINES.length]!,
    );
    at += bw + ((i * 5) % 4 === 0 ? 1 : 0);
    i += 1;
  }
}

function paintHouse(W: number, H: number) {
  const p = painter(W, H);
  const { rect, disc } = p;
  const mid = Math.round(W / 2);
  const eave = 30;
  const plinth = H - 6;

  rect(8, H - 8, W - 12, 8, "rgba(0,0,0,.2)");
  // A verdigris copper roof with standing seams, a gable over the door.
  for (let r = 0; r < eave - 8; r += 1)
    rect(4, 8 + r, W - 8, 1, townShade(COPPER, 0.18 - (r / (eave - 8)) * 0.35));
  for (let x = 10; x < W - 8; x += 8) rect(x, 9, 1, eave - 10, COPPER_DARK);
  rect(4, 8, W - 8, 2, townShade(COPPER, 0.35));
  rect(4, eave - 2, W - 8, 2, COPPER_DARK);
  for (let y = 0; y < 18; y += 1) {
    const half = Math.round((y / 18) * 30);
    rect(mid - half - 1, 4 + y, half * 2 + 2, 1, SAND_DARK);
    rect(mid - half + 1, 4 + y, half * 2 - 2, 1, y < 2 ? SAND_DARK : SAND);
  }
  // The open-book medallion in the gable.
  disc(mid, 15, 7, SAND_DARK);
  disc(mid, 15, 6, "#fbf3df");
  rect(mid - 5, 13, 5, 5, "#fbf3df");
  for (let i = 0; i < 4; i += 1) {
    rect(mid - 5 + i, 12 + Math.floor(i / 2), 1, 1, SAND_DARK);
    rect(mid + 1 + i, 13 - Math.floor(i / 2) + 1, 1, 1, SAND_DARK);
  }
  rect(mid - 5, 17, 10, 1, COPPER_DARK);
  rect(mid, 12, 1, 6, COPPER_DARK);

  // Sandstone walls between a cornice and a plinth, coursed in long blocks.
  rect(4, eave, W - 8, plinth - eave, SAND);
  for (let y = eave + 6, row = 0; y < plinth; y += 6, row += 1) {
    rect(4, y, W - 8, 1, SAND_SHADE);
    for (let x = 4 + (row % 2) * 9; x < W - 4; x += 18)
      rect(x, y - 5, 1, 5, SAND_SHADE);
  }
  rect(2, eave, W - 4, 4, "#f4e6c4");
  rect(2, eave + 3, W - 4, 1, SAND_DARK);
  rect(2, plinth, W - 4, 6, SAND_SHADE);
  rect(2, plinth, W - 4, 1, "#f4e6c4");
  // Pilasters framing the bays.
  for (const x of [6, 58, W - 64, W - 12]) {
    rect(x, eave + 4, 6, plinth - eave - 4, "#f1e2bf");
    rect(x + 5, eave + 4, 1, plinth - eave - 4, SAND_SHADE);
  }

  // Tall arched windows, lit, with shelves of spines behind the glass.
  for (const x of [20, W - 46]) {
    const top = eave + 10;
    const h = 40;
    rect(x - 2, top + 4, 30, h, SAND_DARK);
    disc(x + 13, top + 5, 15, SAND_DARK);
    rect(x, top + 6, 26, h - 4, GLASS);
    disc(x + 13, top + 6, 13, GLASS);
    rect(x, top + h - 14, 26, 12, GLASS_DEEP);
    for (const y of [top + 14, top + 24, top + 34]) {
      rect(x, y, 26, 2, SHELF);
      spines(rect, x + 1, y, 24, 7, x + y);
    }
    rect(x + 12, top - 6, 2, h + 8, SAND_DARK);
    rect(x - 4, top + h + 2, 34, 3, "#f4e6c4");
  }

  // The door, panelled, under a fanlight, with a lantern either side.
  const doorY = eave + 20;
  rect(mid - 14, doorY - 6, 28, plinth - doorY + 6, SAND_DARK);
  disc(mid, doorY - 4, 12, SAND_DARK);
  disc(mid, doorY - 4, 10, GLASS);
  rect(mid - 10, doorY - 4, 20, 4, GLASS);
  for (let i = -2; i <= 2; i += 1)
    rect(mid + i * 4, doorY - 12, 1, 8, SAND_DARK);
  rect(mid - 11, doorY, 22, plinth - doorY, DOOR);
  for (const x of [mid - 9, mid + 1])
    for (const y of [doorY + 3, doorY + 17]) {
      rect(x, y, 8, 11, townShade(DOOR, 0.22));
      rect(x, y, 8, 1, townShade(DOOR, 0.4));
    }
  rect(mid - 1, doorY, 2, plinth - doorY, TOWN_OUTLINE);
  rect(mid - 4, doorY + 16, 2, 2, GOLD);
  rect(mid + 2, doorY + 16, 2, 2, GOLD);
  for (const x of [mid - 22, mid + 18]) {
    rect(x + 1, doorY - 2, 2, 4, TOWN_OUTLINE);
    rect(x - 1, doorY + 2, 6, 9, TOWN_OUTLINE);
    rect(x, doorY + 3, 4, 7, GLASS);
    rect(x - 2, doorY + 1, 8, 2, "#2a2e36");
  }
  // Steps down onto the garden.
  rect(mid - 17, H - 6, 34, 3, "#f4e6c4");
  rect(mid - 20, H - 3, 40, 3, SAND_SHADE);
  return p.canvas;
}

function paintYard(W: number, H: number) {
  const p = painter(W, H);
  const { rect, disc } = p;
  const mid = Math.round(W / 2);
  // Lawn with a clipped hedge border, a gravel path from door to street.
  rect(2, 2, W - 4, H - 6, GRASS);
  for (let x = 3; x < W - 4; x += 5)
    rect(x, 3 + (x % 3), 1, 2, townShade(GRASS, -0.18));
  rect(2, 2, W - 4, 4, townShade(GRASS, -0.3));
  rect(2, H - 6, W - 4, 3, townShade(GRASS, -0.3));
  rect(mid - 12, 0, 24, H - 4, GRAVEL);
  for (let y = 2; y < H - 4; y += 4)
    rect(mid - 10 + ((y * 3) % 18), y, 1, 1, townShade(GRAVEL, -0.2));
  rect(mid - 13, 0, 1, H - 4, townShade(GRAVEL, -0.3));
  rect(mid + 12, 0, 1, H - 4, townShade(GRAVEL, -0.3));
  // A flower bed on the left, a bench under it.
  rect(10, 12, 44, 10, "#6b4a33");
  for (let x = 12; x < 52; x += 4)
    disc(
      x,
      15 + (x % 3),
      1,
      ["#e8607a", "#f2d24b", "#f6f2e6", "#9a6ad0"][(x / 4) % 4]!,
    );
  rect(14, 32, 34, 4, WOOD);
  rect(14, 28, 34, 2, WOOD_DARK);
  rect(16, 36, 2, 6, WOOD_DARK);
  rect(44, 36, 2, 6, WOOD_DARK);
  // A cart of books to be shelved on the right: memory waiting for you.
  const cx = W - 54;
  rect(cx, 20, 36, 16, WOOD);
  rect(cx, 20, 36, 2, townShade(WOOD, 0.25));
  rect(cx, 34, 36, 2, WOOD_DARK);
  spines(rect, cx + 2, 20, 32, 10, 3);
  rect(cx + 36, 14, 2, 14, WOOD_DARK);
  disc(cx + 6, 40, 4, "#2a2e36");
  disc(cx + 30, 40, 4, "#2a2e36");
  disc(cx + 6, 40, 1, GRAVEL);
  disc(cx + 30, 40, 1, GRAVEL);
  return p.canvas;
}
