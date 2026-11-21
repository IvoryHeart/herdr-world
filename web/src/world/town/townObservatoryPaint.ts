/**
 * The observatory's art (#1029), in Town's pixel style and palette: a round
 * cream-stone tower between two low wings under the center's slate, a
 * verdigris dome with its shutter open and a brass telescope pointing out,
 * and a lit door onto the street. Its windows are painted dark: the DOM
 * layer (TownObservatory.tsx) lights one for each agent at work, so a quiet
 * crew leaves it dark. Painted once and shared.
 */

import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_OBSERVATORY_ROWS,
  TOWN_OBSERVATORY_WIDTH,
  TOWN_OBSERVATORY_WINDOW,
  TOWN_OBSERVATORY_WINDOWS,
} from "./townObservatoryLot";
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
const DOME = "#5f9e93";
const DOME_LIGHT = "#8cc7b8";
const DOME_DARK = "#3c6d66";
const BRASS = "#d6a640";
const BRASS_DARK = "#8a6420";
const NIGHT = "#1d2440";
const GLASS_DARK = "#2a3350";
const DOOR = "#3a2b22";
const DOOR_LIT = "#ffd27a";

let art: TownCanvas | null = null;

/** The observatory: TOWN_OBSERVATORY_WIDTH tiles wide, door at its foot. */
export function paintTownObservatory(): TownCanvas {
  if (!art) art = paint(TOWN_OBSERVATORY_WIDTH * T, TOWN_OBSERVATORY_ROWS * T);
  return art;
}

function paint(W: number, H: number) {
  const [canvas, g] = townCanvas(W, H);
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const mid = Math.round(W / 2);
  const towerL = 40;
  const towerR = W - 40;
  const gallery = 62;
  const plinth = H - 6;

  rect(6, H - 8, W - 8, 8, "rgba(0,0,0,.2)");

  // The wings: low stone halls under slate, either side of the tower.
  const wingTop = 128;
  for (let r = 0; r < 12; r += 1)
    rect(
      4,
      wingTop - 12 + r,
      W - 8,
      1,
      townShade(SLATE, r % 5 === 4 ? -0.3 : 0.15 - (r / 12) * 0.25),
    );
  rect(4, wingTop - 12, W - 8, 2, townShade(SLATE, 0.3));
  rect(4, wingTop, W - 8, plinth - wingTop, STONE_SHADE);
  for (let y = wingTop + 6; y < plinth; y += 8)
    rect(4, y, W - 8, 1, STONE_DARK);
  rect(2, wingTop, W - 4, 3, STONE);
  rect(2, plinth, W - 4, 6, STONE_DARK);
  rect(2, plinth, W - 4, 1, STONE);

  // The dome: a verdigris half-disc, its shutter open on the night sky.
  const r = (towerR - towerL) / 2 + 4;
  for (let y = -r; y <= 0; y += 1) {
    const half = Math.round(Math.sqrt(r * r - y * y));
    const shade = y < -r * 0.6 ? DOME_LIGHT : y < -r * 0.2 ? DOME : DOME_DARK;
    rect(mid - half, gallery + y, half * 2, 1, shade);
    rect(mid - half, gallery + y, 1, 1, TOWN_OUTLINE);
    rect(mid + half - 1, gallery + y, 1, 1, TOWN_OUTLINE);
  }
  for (const dx of [-26, -13, 13, 26]) {
    const top = Math.round(Math.sqrt(Math.max(0, r * r - dx * dx)));
    rect(mid + dx, gallery - top + 2, 1, top - 2, DOME_DARK);
  }
  rect(mid - 7, gallery - r + 2, 14, r - 2, NIGHT);
  rect(mid - 7, gallery - r + 2, 1, r - 2, TOWN_OUTLINE);
  rect(mid + 6, gallery - r + 2, 1, r - 2, TOWN_OUTLINE);
  // Two stars seen through the shutter.
  rect(mid - 3, gallery - r + 10, 1, 1, "#fff6d0");
  rect(mid + 2, gallery - r + 22, 1, 1, "#fff6d0");

  // The brass telescope, leaning out of the shutter to the upper right.
  for (let i = 0; i < 30; i += 1) {
    const x = mid - 2 + i;
    const y = gallery - 18 - Math.round(i * 0.8);
    const w = i < 4 ? 8 : 6;
    rect(x, y, 2, w, i % 9 === 8 ? BRASS_DARK : BRASS);
    rect(x, y + w - 1, 2, 1, BRASS_DARK);
  }
  rect(mid + 26, gallery - 46, 4, 10, BRASS_DARK);

  // The gallery's stone ring under the dome.
  rect(towerL - 6, gallery, towerR - towerL + 12, 6, STONE);
  rect(towerL - 6, gallery + 5, towerR - towerL + 12, 1, STONE_DARK);
  for (let x = towerL - 4; x < towerR + 4; x += 6)
    rect(x, gallery - 6, 2, 6, STONE_SHADE);
  rect(towerL - 6, gallery - 7, towerR - towerL + 12, 2, STONE_DARK);

  // The tower: cream stone in courses, from the gallery to the street.
  rect(towerL, gallery + 6, towerR - towerL, plinth - gallery - 6, STONE);
  for (let y = gallery + 12, row = 0; y < plinth; y += 6, row += 1) {
    rect(towerL, y, towerR - towerL, 1, STONE_SHADE);
    for (let x = towerL + (row % 2) * 8; x < towerR; x += 16)
      rect(x, y - 5, 1, 5, STONE_SHADE);
  }
  rect(towerL, gallery + 6, 3, plinth - gallery - 6, STONE_SHADE);
  rect(towerR - 3, gallery + 6, 3, plinth - gallery - 6, STONE_DARK);

  // Windows, dark until an agent at work lights one (TownObservatory.tsx).
  const { w: ww, h: wh } = TOWN_OBSERVATORY_WINDOW;
  for (const at of TOWN_OBSERVATORY_WINDOWS) {
    rect(at.x - 2, at.y - 2, ww + 4, wh + 4, STONE_DARK);
    rect(at.x, at.y, ww, wh, GLASS_DARK);
    rect(at.x, at.y, ww, 3, townShade(GLASS_DARK, 0.3));
    rect(at.x - 3, at.y + wh + 2, ww + 6, 2, STONE);
  }

  // The door under a round arch, lit from inside, with steps to the street.
  const doorY = plinth - 34;
  rect(mid - 12, doorY - 4, 24, plinth - doorY + 4, STONE_DARK);
  rect(mid - 10, doorY, 20, plinth - doorY, DOOR);
  rect(mid - 8, doorY + 2, 16, plinth - doorY - 2, DOOR_LIT);
  rect(mid - 1, doorY, 2, plinth - doorY, "#5b4535");
  for (let i = 0; i < 6; i += 1)
    rect(
      mid - 10 + i,
      doorY - 6 + Math.round(i / 2),
      20 - i * 2,
      1,
      STONE_DARK,
    );
  // A brass star over the door.
  rect(mid - 1, doorY - 12, 2, 6, BRASS);
  rect(mid - 3, doorY - 10, 6, 2, BRASS);
  rect(mid - 14, H - 4, 28, 4, STONE);
  return canvas;
}
