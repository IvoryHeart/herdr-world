/**
 * The harbour's art (#1028), in Town's pixel style and palette: a stone-walled
 * basin of water with a red-and-white lighthouse on its far corner, and at
 * its foot a plank quay with bollards and a yellow gantry crane reaching over
 * the water. Ships, crates, the lamp's light and pennants are the DOM
 * layer's (TownShipyard.tsx), one per release, waiting change and running
 * World: the art paints none, so a closed harbour shows an empty basin.
 * Painted once and shared; the renderer places basin and quay as two
 * outdoor sprites.
 */

import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_HARBOUR_BASIN_ROWS,
  TOWN_HARBOUR_LAMP,
  TOWN_HARBOUR_QUAY_ROWS,
  TOWN_HARBOUR_WIDTH,
} from "./townHarbour";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  type TownCanvas,
} from "./townSprites";

const STONE = "#c9c2b2";
const STONE_SHADE = "#a39b89";
const STONE_DARK = "#6f6858";
const WATER = "#3f86c4";
const WATER_DEEP = "#2f6aa3";
const WAVE = "#7cc0ea";
const FOAM = "#d8f0fb";
const TOWER_RED = "#d4252b";
const TOWER_WHITE = "#f6f2e6";
const WOOD = "#9b6a3f";
const WOOD_DARK = "#6e4a2e";
const WOOD_EDGE = "#3b2414";
const CRANE = "#e8b923";
const CRANE_DARK = "#a77e10";
const IRON = "#3a3f4a";

let basin: TownCanvas | null = null;
let quay: TownCanvas | null = null;

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
  return { canvas, rect, disc };
}

/** The basin: TOWN_HARBOUR_WIDTH tiles wide, its lighthouse top left. */
export function paintTownHarbourBasin(): TownCanvas {
  if (!basin)
    basin = paintBasin(TOWN_HARBOUR_WIDTH * T, TOWN_HARBOUR_BASIN_ROWS * T);
  return basin;
}

/** The quay: planks, bollards and the crane at its right end. */
export function paintTownHarbourQuay(): TownCanvas {
  if (!quay)
    quay = paintQuay(TOWN_HARBOUR_WIDTH * T, TOWN_HARBOUR_QUAY_ROWS * T);
  return quay;
}

function paintBasin(W: number, H: number) {
  const { canvas, rect, disc } = painter(W, H);
  const wall = 6;
  // Shadow, then the stone walls round three sides.
  rect(4, 6, W - 4, H - 6, "rgba(0,0,0,.18)");
  rect(0, 0, W - 2, H, STONE_DARK);
  rect(1, 1, W - 4, H - 1, STONE);
  for (let y = 3; y < H; y += 6)
    for (let x = (y / 6) % 2 ? 2 : 6; x < W - 4; x += 10)
      rect(x, y, 1, 3, STONE_SHADE);
  // The water inside, deeper towards the walls, with staggered waves.
  rect(wall, wall, W - wall * 2 - 2, H - wall, WATER_DEEP);
  rect(wall + 2, wall + 2, W - wall * 2 - 6, H - wall - 2, WATER);
  for (let row = 0, y = wall + 8; y < H - 6; y += 9, row += 1)
    for (let x = wall + 6 + ((row * 13) % 22); x < W - wall - 12; x += 22) {
      rect(x, y, 6, 1, WAVE);
      rect(x + 2, y - 1, 3, 1, FOAM);
    }
  // Reflections where the ships moor, along the quay wall.
  rect(wall + 2, H - 4, W - wall * 2 - 6, 2, townShade(WATER, -0.2));

  // The lighthouse on the far left corner: white and red bands, a gallery
  // and a dark lantern room the DOM layer lights (TOWN_HARBOUR_LAMP).
  const cx = TOWN_HARBOUR_LAMP.x;
  const top = TOWN_HARBOUR_LAMP.y - 6;
  rect(cx - 9, top + 34, 18, 6, STONE_DARK);
  for (let i = 0; i < 4; i += 1) {
    const y = top + 10 + i * 6;
    const half = 5 + Math.floor(i / 2);
    rect(cx - half - 1, y, half * 2 + 2, 6, TOWN_OUTLINE);
    rect(cx - half, y, half * 2, 6, i % 2 ? TOWER_RED : TOWER_WHITE);
    rect(cx - half, y, 2, 6, townShade(i % 2 ? TOWER_RED : TOWER_WHITE, 0.2));
  }
  rect(cx - 7, top + 8, 14, 2, IRON);
  rect(cx - 5, top + 1, 10, 8, TOWN_OUTLINE);
  rect(cx - 4, top + 2, 8, 6, "#4a4458");
  rect(cx - 5, top - 2, 10, 3, TOWER_RED);
  disc(cx, top - 3, 2, TOWER_RED);

  // The crane's arm and hook over the water, one crane with the quay's
  // gantry below it.
  const crane = W - 44;
  rect(crane, H - 18, 4, 18, CRANE_DARK);
  rect(crane + 28, H - 18, 4, 18, CRANE_DARK);
  rect(crane - 34, H - 22, 70, 4, CRANE);
  rect(crane - 34, H - 19, 70, 1, CRANE_DARK);
  rect(crane - 20, H - 18, 1, 10, IRON);
  rect(crane - 22, H - 8, 5, 2, IRON);
  return canvas;
}

function paintQuay(W: number, H: number) {
  const { canvas, rect, disc } = painter(W, H);
  // Shadow, the stone edge on the water side, then the deck's planks.
  rect(4, 4, W - 4, H - 4, "rgba(0,0,0,.18)");
  rect(0, 0, W - 2, H - 2, WOOD_EDGE);
  rect(0, 0, W - 2, 4, STONE_DARK);
  rect(1, 0, W - 4, 3, STONE);
  for (let y = 5, row = 0; y < H - 4; y += 6, row += 1) {
    rect(2, y, W - 6, 5, row % 2 ? WOOD : townShade(WOOD, 0.08));
    rect(2, y + 5, W - 6, 1, WOOD_DARK);
    for (let x = 2 + ((row * 29) % 44); x < W - 6; x += 44)
      rect(x, y, 1, 5, WOOD_DARK);
  }
  // Bollards along the water's edge, one under each berth.
  for (const x of [56, 122, 188, 236]) {
    rect(x - 3, 2, 6, 6, IRON);
    rect(x - 4, 1, 8, 2, townShade(IRON, 0.3));
  }
  // The gantry crane at the quay's right end, its arm over the basin.
  const cx = W - 44;
  rect(cx, 6, 4, H - 10, CRANE_DARK);
  rect(cx + 28, 6, 4, H - 10, CRANE_DARK);
  rect(cx + 1, 6, 2, H - 10, CRANE);
  rect(cx + 29, 6, 2, H - 10, CRANE);
  rect(cx - 2, H - 8, 8, 4, IRON);
  rect(cx + 26, H - 8, 8, 4, IRON);
  rect(cx, 8, 32, 4, CRANE);
  rect(cx, 11, 32, 1, CRANE_DARK);
  for (let x = cx + 4; x < cx + 28; x += 6) rect(x, 12, 1, 6, CRANE_DARK);
  disc(cx + 16, 22, 2, IRON);
  return canvas;
}
