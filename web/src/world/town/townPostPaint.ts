/**
 * The post office's art (#760), in Town's pixel style and palette: a red
 * brick house under the center's slate, cream stone trim, a striped awning
 * over a lit door, a red pillar box, and across the park walk a plank
 * sorting yard with an empty mail trolley. Every parcel is the DOM layer's
 * (TownPostOffice.tsx), one per pull request: the art paints none, so a
 * closed post office shows none. Painted once and shared; the renderer places
 * the house and the yard as two outdoor sprites, so walkers on the walk pass
 * in front of the house and over nothing.
 */

import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_POST_HOUSE_ROWS,
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
} from "./townPost";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  type TownCanvas,
} from "./townSprites";

const STONE = "#ece2c8";
const STONE_SHADE = "#cfc1a0";
const STONE_DARK = "#9a8a6c";
const SLATE = "#4f5a80";
const BRICK = "#a4553f";
const BRICK_DARK = "#7e3d2d";
const POST_RED = "#d4252b";
const GLASS = "#ffe39a";
const GOLD = "#e8c75a";
const WOOD = "#9b6a3f";
const WOOD_DARK = "#6e4a2e";
const WOOD_EDGE = "#3b2414";

let house: TownCanvas | null = null;
let yard: TownCanvas | null = null;

type Paint = ReturnType<typeof painter>;

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

/** The house: TOWN_POST_WIDTH tiles wide, its door on its bottom row. */
export function paintTownPostHouse(): TownCanvas {
  if (!house) house = paintHouse(TOWN_POST_WIDTH * T, TOWN_POST_HOUSE_ROWS * T);
  return house;
}

/** The sorting yard: planks, posts and the mail trolley at its right end. */
export function paintTownPostYard(): TownCanvas {
  if (!yard) yard = paintYard(TOWN_POST_WIDTH * T, TOWN_POST_YARD_ROWS * T);
  return yard;
}

function paintHouse(W: number, H: number) {
  const p = painter(W, H);
  const { rect, disc } = p;
  const mid = Math.round(W / 2);
  const eave = 32;
  const plinth = H - 6;

  rect(8, H - 8, W - 12, 8, "rgba(0,0,0,.2)");
  // The chimney behind the roof.
  rect(30, 0, 12, 18, BRICK_DARK);
  rect(28, 0, 16, 3, STONE_DARK);
  rect(32, 3, 8, 1, TOWN_OUTLINE);
  slateRoof(p, 4, 8, W - 8, eave - 8);
  // A cream gable over the door with the envelope emblem.
  for (let y = 0; y < 16; y += 1) {
    const half = Math.round((y / 16) * 26);
    rect(mid - half - 1, 14 + y, half * 2 + 2, 1, STONE_DARK);
    rect(mid - half + 1, 14 + y, half * 2 - 2, 1, y < 2 ? STONE_DARK : STONE);
  }
  rect(mid - 8, 21, 16, 8, "#fbf6e8");
  rect(mid - 8, 21, 16, 1, STONE_DARK);
  rect(mid - 8, 28, 16, 1, STONE_DARK);
  rect(mid - 8, 21, 1, 8, STONE_DARK);
  rect(mid + 7, 21, 1, 8, STONE_DARK);
  for (let i = 0; i < 4; i += 1) {
    rect(mid - 7 + i * 2, 22 + i, 2, 1, POST_RED);
    rect(mid + 5 - i * 2, 22 + i, 2, 1, POST_RED);
  }

  // Brick walls between a stone cornice and a stone plinth.
  rect(4, eave, W - 8, plinth - eave, BRICK);
  for (let y = eave + 4, row = 0; y < plinth; y += 4, row += 1) {
    rect(4, y, W - 8, 1, BRICK_DARK);
    for (let x = 4 + (row % 2) * 6; x < W - 4; x += 12)
      rect(x, y - 3, 1, 3, BRICK_DARK);
  }
  rect(2, eave, W - 4, 4, STONE);
  rect(2, eave + 3, W - 4, 1, STONE_DARK);
  for (let y = eave + 6; y < plinth - 4; y += 8) {
    rect(4, y, 5, 4, STONE_SHADE);
    rect(W - 9, y + 4, 5, 4, STONE_SHADE);
  }
  rect(2, plinth, W - 4, 6, STONE_SHADE);
  rect(2, plinth, W - 4, 1, STONE);

  // Two lit windows with sills either side of the door.
  for (const x of [22, W - 50]) {
    rect(x - 2, eave + 12, 32, 26, STONE_DARK);
    rect(x, eave + 14, 28, 22, GLASS);
    rect(x, eave + 28, 28, 8, "#f2c46a");
    rect(x + 13, eave + 14, 2, 22, STONE_DARK);
    rect(x, eave + 23, 28, 1, STONE_DARK);
    rect(x - 4, eave + 38, 36, 3, STONE);
    // The counter behind the glass, empty: parcels are the yard's alone.
    rect(x, eave + 31, 28, 2, WOOD_DARK);
  }

  // The door under a striped awning, lit from inside.
  const doorY = eave + 18;
  rect(mid - 13, doorY - 2, 26, plinth - doorY + 2, STONE_DARK);
  rect(mid - 11, doorY, 22, plinth - doorY, "#3a2b22");
  rect(mid - 9, doorY + 2, 18, plinth - doorY - 2, "#ffd27a");
  rect(mid - 9, doorY + 14, 18, plinth - doorY - 14, "#f2b85a");
  rect(mid - 1, doorY, 2, plinth - doorY, "#5b4535");
  rect(mid + 4, doorY + 16, 2, 2, GOLD);
  for (let i = 0; i < 9; i += 1) {
    const stripe = i % 2 ? "#f6f2e6" : POST_RED;
    rect(mid - 18 + i * 4, doorY - 10, 4, 7, stripe);
    disc(mid - 16 + i * 4, doorY - 3, 2, stripe);
  }
  rect(mid - 18, doorY - 11, 36, 1, townShade(POST_RED, -0.45));
  // The step onto the walk.
  rect(mid - 15, H - 3, 30, 3, STONE);

  // A red pillar box beside the door.
  const bx = mid + 22;
  rect(bx, H - 26, 12, 24, POST_RED);
  disc(bx + 6, H - 26, 6, POST_RED);
  rect(bx - 1, H - 30, 14, 3, townShade(POST_RED, -0.35));
  rect(bx + 2, H - 22, 8, 2, TOWN_OUTLINE);
  rect(bx + 1, H - 24, 2, 18, townShade(POST_RED, 0.25));
  rect(bx + 3, H - 15, 6, 4, GOLD);
  rect(bx - 1, H - 3, 14, 3, "#2a1a1a");
  return p.canvas;
}

function paintYard(W: number, H: number) {
  const p = painter(W, H);
  const { rect, disc } = p;
  // Shadow, then the deck's planks inside a dark edge.
  rect(4, 6, W - 4, H - 6, "rgba(0,0,0,.18)");
  rect(1, 2, W - 4, H - 6, WOOD_EDGE);
  for (let y = 4, row = 0; y < H - 6; y += 6, row += 1) {
    rect(3, y, W - 8, 5, row % 2 ? WOOD : townShade(WOOD, 0.08));
    rect(3, y + 5, W - 8, 1, WOOD_DARK);
    for (let x = 3 + ((row * 37) % 50); x < W - 8; x += 50)
      rect(x, y, 1, 5, WOOD_DARK);
  }
  // Corner posts.
  for (const x of [0, W - 8])
    for (const y of [0, H - 12]) {
      rect(x, y, 6, 10, WOOD_DARK);
      rect(x, y, 6, 2, townShade(WOOD_DARK, 0.25));
    }
  // The mail trolley at the right end: a red cart on two wheels.
  const cx = W - 30;
  rect(cx, 18, 22, 20, POST_RED);
  rect(cx, 18, 22, 3, townShade(POST_RED, 0.25));
  rect(cx + 2, 23, 18, 2, townShade(POST_RED, -0.35));
  rect(cx + 2, 18, 18, 2, townShade(POST_RED, -0.55));
  rect(cx - 6, 22, 7, 2, "#3a3f4a");
  disc(cx + 5, 40, 4, "#2a2e36");
  disc(cx + 17, 40, 4, "#2a2e36");
  disc(cx + 5, 40, 1, STONE_DARK);
  disc(cx + 17, 40, 1, STONE_DARK);
  return p.canvas;
}

function slateRoof(p: Paint, x: number, y: number, w: number, h: number) {
  const { rect, g } = p;
  for (let r = 0; r < h; r += 1)
    rect(
      x,
      y + r,
      w,
      1,
      townShade(SLATE, r % 5 === 4 ? -0.3 : 0.15 - (r / h) * 0.25),
    );
  g.fillStyle = "rgba(0,0,0,.14)";
  for (let r = 0; r < h; r += 5)
    for (let xx = x + ((r / 5) % 2) * 4; xx < x + w; xx += 8)
      g.fillRect(xx, y + r, 1, 4);
  rect(x, y, w, 2, townShade(SLATE, 0.3));
  rect(x, y + h - 2, w, 2, townShade(SLATE, -0.45));
}
