/**
 * The post office's art (#760, redrawn by #1098), in the style of Town's
 * agents and desks: outlined in Town's ink (townOutline) over a soft ground
 * shadow. A red brick house under a pitched slate roof, a cream gable with
 * an envelope oculus, a "POST" fascia over a green double door with a
 * fanlight, striped awnings over windows with letter racks behind the glass,
 * flower boxes, lanterns, a notice board and a red pillar box. Its forecourt
 * is cobbled, with mail sacks, a postman's bicycle and a mail trolley. It
 * holds letters, never parcels: pull requests are the warehouse's
 * (TownWarehouse.tsx). The letters in the yard (questions agents asked
 * you) and the trolley's load (your answers on their way) are the DOM
 * layer's (TownPostOffice.tsx, #1105), drawn with the letter painted here.
 * Painted once and shared; the renderer places the house and the yard as
 * two outdoor sprites.
 */

import { artPostHouse, artPostYard, townArtLandmark } from "./townArtLandmarks";
import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_POST_HOUSE_ROWS,
  TOWN_POST_WIDTH,
  TOWN_POST_YARD_ROWS,
} from "./townPostLot";
import { TOWN_LETTER_SIZE } from "./townPostModel";
import {
  TOWN_OUTLINE,
  townCanvas,
  townOutline,
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
const POST_GREEN = "#2f6b4f";
const NAVY = "#2f3a5e";
const GLASS = "#ffe39a";
const GLASS_LOW = "#f2c46a";
const GOLD = "#e8c75a";
const PAPER = "#fbf6e8";
const WOOD = "#9b6a3f";
const WOOD_DARK = "#6e4a2e";
const LEAF = "#3f7a3a";
const LEAF_LIGHT = "#5c9a48";
const IRON = "#3a3f4a";
const SACK = "#d8c39a";
const COBBLE = "#b8ab90";
const SHADOW = "rgba(0,0,0,.2)";

let house: TownCanvas | null = null;
let yard: TownCanvas | null = null;
const letterUrls = new Map<string, string>();

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

/** The art outlined in Town's ink, over its ground shadow. */
function outlined(ground: Paint, art: Paint) {
  ground.g.drawImage(townOutline(art.canvas), 0, 0);
  return ground.canvas;
}

/** The house: TOWN_POST_WIDTH tiles wide, its door on its bottom row. */
export function paintTownPostHouse(): TownCanvas {
  const art = townArtLandmark("post-house", (style) =>
    artPostHouse(style, TOWN_POST_WIDTH * T, TOWN_POST_HOUSE_ROWS * T),
  );
  if (art) return art;
  if (!house) house = paintHouse(TOWN_POST_WIDTH * T, TOWN_POST_HOUSE_ROWS * T);
  return house;
}

/** The forecourt: cobbles, mail sacks, a bicycle and the mail trolley. */
export function paintTownPostYard(): TownCanvas {
  const art = townArtLandmark("post-yard", (style) =>
    artPostYard(style, TOWN_POST_WIDTH * T, TOWN_POST_YARD_ROWS * T),
  );
  if (art) return art;
  if (!yard) yard = paintYard(TOWN_POST_WIDTH * T, TOWN_POST_YARD_ROWS * T);
  return yard;
}

/** "POST" in a 3×5 pixel face. */
const LETTERS: Record<string, readonly string[]> = {
  P: ["111", "101", "111", "100", "100"],
  O: ["111", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
};

function word(p: Paint, text: string, x: number, y: number, color: string) {
  for (const [index, letter] of [...text].entries())
    for (const [row, bits] of LETTERS[letter]!.entries())
      for (const [column, bit] of [...bits].entries())
        if (bit === "1") p.rect(x + index * 4 + column, y + row, 1, 1, color);
}

function paintHouse(W: number, H: number) {
  const ground = painter(W, H);
  ground.rect(8, H - 7, W - 12, 7, SHADOW);
  const p = painter(W, H);
  const { rect, disc } = p;
  const mid = Math.round(W / 2);
  const eave = 36;
  const plinth = H - 6;

  // The chimney behind the roof, a wisp of warmth above it.
  rect(30, 2, 12, 16, BRICK_DARK);
  rect(31, 6, 10, 1, townShade(BRICK_DARK, -0.25));
  rect(31, 11, 10, 1, townShade(BRICK_DARK, -0.25));
  rect(28, 0, 16, 3, STONE_DARK);
  rect(28, 0, 16, 1, STONE_SHADE);
  pitchedRoof(p, 2, 9, W - 4, eave - 9, 16);

  // A cream cross gable with an envelope in its round window.
  for (let y = 0; y <= 24; y += 1) {
    const half = Math.round((y / 24) * 30);
    rect(mid - half - 2, 12 + y, half * 2 + 4, 1, STONE_DARK);
    if (half > 2) rect(mid - half + 1, 12 + y, half * 2 - 2, 1, STONE);
  }
  rect(mid - 1, 10, 2, 3, GOLD);
  disc(mid, 26, 7, STONE_DARK);
  disc(mid, 26, 6, NAVY);
  rect(mid - 5, 23, 10, 7, PAPER);
  for (let i = 0; i < 4; i += 1) {
    rect(mid - 5 + i, 23 + i, 1, 1, POST_RED);
    rect(mid + 4 - i, 23 + i, 1, 1, POST_RED);
  }

  // Brick walls between a stone cornice and a stone plinth, with quoins.
  rect(4, eave, W - 8, plinth - eave, BRICK);
  for (let y = eave + 6, row = 0; y < plinth; y += 4, row += 1) {
    rect(4, y, W - 8, 1, BRICK_DARK);
    for (let x = 4 + (row % 2) * 6; x < W - 4; x += 12)
      rect(x, y - 3, 1, 3, BRICK_DARK);
  }
  rect(2, eave, W - 4, 4, STONE);
  rect(2, eave + 3, W - 4, 1, STONE_DARK);
  for (let y = eave + 5, i = 0; y < plinth - 3; y += 6, i += 1) {
    const wide = i % 2 ? 4 : 7;
    rect(4, y, wide, 5, STONE_SHADE);
    rect(W - 4 - wide, y, wide, 5, STONE_SHADE);
  }
  rect(2, plinth, W - 4, 6, STONE_SHADE);
  rect(2, plinth, W - 4, 1, STONE);

  // The fascia over the door: POST in gold on navy.
  rect(mid - 15, eave + 5, 30, 9, GOLD);
  rect(mid - 14, eave + 6, 28, 7, NAVY);
  word(p, "POST", mid - 7, eave + 7, GOLD);

  // A green double door under a fanlight, in a stone arch.
  const arch = eave + 26;
  disc(mid, arch, 13, STONE_SHADE);
  rect(mid - 13, arch, 26, plinth - arch, STONE_SHADE);
  rect(mid - 1, arch - 13, 2, 3, STONE_DARK);
  disc(mid, arch, 10, NAVY);
  disc(mid, arch, 9, GLASS);
  rect(mid - 10, arch, 20, 1, NAVY);
  for (const dx of [-5, 0, 5]) rect(mid + dx, arch - 8, 1, 8, NAVY);
  rect(mid - 10, arch + 1, 20, plinth - arch - 1, townShade(POST_GREEN, -0.4));
  for (const x of [mid - 9, mid + 1]) {
    rect(x, arch + 2, 8, plinth - arch - 2, POST_GREEN);
    rect(x + 1, arch + 4, 6, 8, townShade(POST_GREEN, -0.2));
    rect(x + 1, arch + 15, 6, 8, townShade(POST_GREEN, -0.2));
    rect(x, arch + 2, 8, 1, townShade(POST_GREEN, 0.3));
  }
  rect(mid - 3, arch + 13, 2, 2, GOLD);
  rect(mid + 1, arch + 13, 2, 2, GOLD);
  rect(mid + 2, arch + 10, 5, 1, GOLD);
  rect(mid - 15, H - 4, 30, 4, STONE);
  rect(mid - 15, H - 4, 30, 1, PAPER);

  // Lanterns either side of the door.
  for (const x of [mid - 19, mid + 16]) {
    rect(x, arch - 6, 3, 2, IRON);
    rect(x - 1, arch - 4, 5, 7, IRON);
    rect(x, arch - 3, 3, 5, GLASS);
    rect(x + 1, arch + 3, 1, 2, IRON);
  }

  // Windows with letter racks behind the glass, striped awnings over them
  // and flower boxes under them.
  for (const x of [14, W - 46]) window(p, x, eave + 18);

  // A notice board of pinned letters: what is addressed to you.
  const nx = 56;
  const ny = eave + 22;
  rect(nx, ny, 22, 18, WOOD_DARK);
  rect(nx + 1, ny + 1, 20, 16, "#c9a26b");
  const notes = [
    [3, 3, 6, 5, PAPER],
    [11, 2, 7, 6, "#ffe9a8"],
    [4, 10, 7, 5, "#f6c9d6"],
    [13, 10, 5, 5, PAPER],
  ] as const;
  for (const [dx, dy, w, h, color] of notes) {
    rect(nx + dx, ny + dy, w, h, color);
    rect(nx + dx + 1, ny + dy + 2, w - 2, 1, STONE_DARK);
    rect(nx + dx + Math.floor(w / 2), ny + dy, 1, 1, POST_RED);
  }
  rect(nx + 3, ny + 18, 2, 4, WOOD_DARK);
  rect(nx + 17, ny + 18, 2, 4, WOOD_DARK);

  // A red pillar box beside the door.
  const bx = mid + 26;
  const top = H - 28;
  disc(bx + 6, top + 2, 6, POST_RED);
  rect(bx, top + 2, 12, H - top - 6, POST_RED);
  rect(bx - 1, top + 5, 14, 3, townShade(POST_RED, -0.35));
  rect(bx + 1, top + 2, 2, H - top - 8, townShade(POST_RED, 0.25));
  rect(bx + 3, top + 10, 6, 2, "#1c1722");
  rect(bx + 4, top + 15, 4, 4, GOLD);
  rect(bx - 1, H - 4, 14, 4, "#2a1a1a");
  return outlined(ground, p);
}

/** A window at (x, y), 32 wide: awning, glass, letter racks, flower box. */
function window(p: Paint, x: number, y: number) {
  const { rect, disc } = p;
  rect(x - 2, y, 36, 26, STONE_DARK);
  rect(x, y + 2, 32, 22, GLASS);
  rect(x, y + 13, 32, 11, GLASS_LOW);
  // The racks: pigeonholes with letters waiting in them.
  rect(x + 1, y + 13, 30, 11, WOOD);
  const tints = [PAPER, "#f6c9d6", "#cfe3f7", "#ffe9a8"];
  for (let row = 0; row < 2; row += 1)
    for (let column = 0; column < 5; column += 1) {
      const cx = x + 2 + column * 6;
      const cy = y + 14 + row * 5;
      rect(cx, cy, 5, 4, WOOD_DARK);
      if ((row * 5 + column) % 3 !== 2)
        rect(cx + 1, cy + 1, 3, 3, tints[(row + column) % tints.length]!);
    }
  rect(x + 15, y + 2, 2, 22, STONE_DARK);
  rect(x, y + 12, 32, 1, STONE_DARK);
  // The awning, red and cream, scalloped.
  for (let i = 0; i < 9; i += 1) {
    const stripe = i % 2 ? "#f6f2e6" : POST_RED;
    rect(x - 2 + i * 4, y - 7, 4, 6, stripe);
    disc(x + i * 4, y - 1, 2, stripe);
  }
  rect(x - 3, y - 8, 38, 1, townShade(POST_RED, -0.45));
  // The flower box.
  rect(x - 3, y + 25, 38, 6, WOOD_DARK);
  rect(x - 3, y + 25, 38, 1, WOOD);
  for (let i = 0; i < 9; i += 1) {
    const fx = x - 1 + i * 4;
    disc(fx + 1, y + 24, 2, i % 2 ? LEAF : LEAF_LIGHT);
    rect(fx + 1, y + 22, 2, 2, ["#f2a5c4", GOLD, "#f6f2e6"][i % 3]!);
  }
}

function pitchedRoof(
  p: Paint,
  x: number,
  y: number,
  w: number,
  h: number,
  hip: number,
) {
  const { rect, g } = p;
  for (let r = 0; r < h; r += 1) {
    const inset = Math.round(hip * (1 - r / (h - 1)));
    rect(
      x + inset,
      y + r,
      w - inset * 2,
      1,
      townShade(SLATE, r % 5 === 4 ? -0.3 : 0.15 - (r / h) * 0.25),
    );
  }
  g.fillStyle = "rgba(0,0,0,.14)";
  for (let r = 0; r < h; r += 5) {
    const inset = Math.round(hip * (1 - r / (h - 1)));
    for (let xx = x + inset + ((r / 5) % 2) * 4; xx < x + w - inset; xx += 8)
      g.fillRect(xx, y + r, 1, 4);
  }
  rect(x + hip, y, w - hip * 2, 2, townShade(SLATE, -0.45));
  rect(x, y + h - 2, w, 2, townShade(SLATE, -0.45));
}

function paintYard(W: number, H: number) {
  const ground = painter(W, H);
  // Cobbles inside a stone kerb, the flags under the door paler.
  ground.rect(4, 6, W - 4, H - 6, SHADOW);
  ground.rect(1, 1, W - 4, H - 6, STONE_DARK);
  ground.rect(2, 2, W - 6, H - 8, COBBLE);
  for (let y = 3, row = 0; y < H - 7; y += 5, row += 1)
    for (let x = 3 + (row % 2) * 4, i = 0; x < W - 5; x += 8, i += 1) {
      const tone = ((row * 7 + i * 3) % 5) / 40 - 0.05;
      ground.rect(x, y, 7, 4, townShade(COBBLE, tone));
      ground.rect(x, y + 3, 7, 1, townShade(COBBLE, -0.18));
    }
  const mid = Math.round(W / 2);
  ground.rect(mid - 14, 2, 28, H - 8, STONE_SHADE);
  for (let y = 2; y < H - 6; y += 8)
    ground.rect(mid - 14, y, 28, 1, STONE_DARK);
  ground.rect(mid, 2, 1, H - 8, STONE_DARK);

  const p = painter(W, H);
  const { rect, disc } = p;
  // Mail sacks, tied at the neck, by the left kerb.
  for (const [sx, sy] of [
    [12, 26],
    [26, 30],
    [18, 38],
  ] as const) {
    disc(sx + 6, sy + 7, 7, SACK);
    rect(sx - 1, sy + 7, 14, 6, SACK);
    rect(sx + 4, sy - 2, 4, 4, SACK);
    rect(sx + 3, sy + 1, 6, 1, WOOD_DARK);
    rect(sx + 1, sy + 6, 3, 6, townShade(SACK, 0.15));
    rect(sx + 4, sy + 8, 4, 3, POST_RED);
  }
  // A postman's bicycle with a basket of letters.
  const bx = 120;
  const by = 30;
  for (const wx of [bx, bx + 22]) {
    disc(wx, by + 10, 7, IRON);
    disc(wx, by + 10, 5, COBBLE);
    rect(wx - 5, by + 10, 10, 1, STONE_DARK);
    rect(wx, by + 5, 1, 10, STONE_DARK);
    disc(wx, by + 10, 1, IRON);
  }
  rect(bx, by + 9, 12, 2, POST_RED);
  rect(bx + 10, by + 2, 2, 9, POST_RED);
  rect(bx + 10, by + 2, 12, 2, POST_RED);
  rect(bx + 12, by + 9, 10, 2, POST_RED);
  rect(bx + 20, by - 2, 2, 12, IRON);
  rect(bx + 18, by - 3, 6, 2, IRON);
  rect(bx + 7, by, 6, 2, IRON);
  rect(bx + 22, by - 1, 10, 7, WOOD);
  rect(bx + 23, by - 4, 3, 4, PAPER);
  rect(bx + 27, by - 3, 3, 3, "#f6c9d6");
  rect(bx + 22, by + 2, 10, 1, WOOD_DARK);
  // The mail trolley at the right end, laden with sacks.
  const cx = W - 32;
  rect(cx, 22, 24, 18, POST_RED);
  rect(cx, 22, 24, 3, townShade(POST_RED, 0.25));
  rect(cx + 2, 30, 20, 2, townShade(POST_RED, -0.35));
  rect(cx + 9, 33, 6, 4, GOLD);
  disc(cx + 7, 19, 5, SACK);
  disc(cx + 17, 18, 5, SACK);
  rect(cx + 6, 15, 3, 2, WOOD_DARK);
  rect(cx + 16, 14, 3, 2, WOOD_DARK);
  rect(cx - 7, 25, 8, 2, IRON);
  disc(cx + 5, 42, 4, "#2a2e36");
  disc(cx + 19, 42, 4, "#2a2e36");
  disc(cx + 5, 42, 1, STONE_DARK);
  disc(cx + 19, 42, 1, STONE_DARK);
  // Two potted shrubs flanking the flagged path.
  for (const tx of [mid - 26, mid + 16]) {
    rect(tx, 12, 10, 8, BRICK);
    rect(tx, 12, 10, 2, townShade(BRICK, 0.2));
    disc(tx + 5, 9, 6, LEAF);
    disc(tx + 3, 7, 3, LEAF_LIGHT);
    rect(tx + 7, 6, 1, 1, "#f2a5c4");
  }
  return outlined(ground, p);
}

/**
 * A letter, TOWN_LETTER_SIZE: a cream envelope with its flap, sealed in red
 * wax, or grey wax when the service could not verify who wrote it.
 */
export function paintTownLetter(verified: boolean): TownCanvas {
  const { w: W, h: H } = TOWN_LETTER_SIZE;
  const { canvas, rect, disc } = painter(W, H);
  rect(0, 0, W, H, TOWN_OUTLINE);
  rect(1, 1, W - 2, H - 2, PAPER);
  rect(1, H - 2, W - 2, 1, STONE_SHADE);
  // The flap: two lines from the top corners down to the seal.
  for (let i = 0; i < 5; i += 1) {
    rect(1 + i, 1 + i, 1, 1, STONE_DARK);
    rect(W - 2 - i, 1 + i, 1, 1, STONE_DARK);
  }
  disc(W / 2, 5, 2, verified ? POST_RED : "#8a8f99");
  return canvas;
}

/** A letter's art as an image URL, drawn once; empty without a canvas (tests). */
export function townLetterUrl(verified: boolean) {
  const key = verified ? "sealed" : "unverified";
  let value = letterUrls.get(key);
  if (value === undefined) {
    try {
      value = paintTownLetter(verified).toDataURL();
    } catch {
      value = "";
    }
    letterUrls.set(key, value);
  }
  return value;
}
