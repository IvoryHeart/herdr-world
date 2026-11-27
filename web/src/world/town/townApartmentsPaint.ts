/**
 * The apartment building's art (#1011), in Town's pixel style: a three-storey
 * sandstone block under a flat roof with a parapet and a water tank, warm
 * windows with flower boxes, and a green front door with a canopy. Painted
 * once and shared; the renderer places it as one outdoor sprite.
 */

import { artApartments, townArtLandmark } from "./townArtLandmarks";
import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_APARTMENTS_ROWS,
  TOWN_APARTMENTS_WIDTH,
} from "./townApartmentsLot";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  type TownCanvas,
} from "./townSprites";

const WALL = "#d9b98a";
const WALL_DARK = "#b8956a";
const TRIM = "#f1e4c8";
const ROOF = "#5b5e6b";
const GLASS = "#ffe39a";
const GLASS_LOW = "#f2c46a";
const FRAME = "#6e4a2e";
const DOOR = "#3f7a5a";
const FLOWER = ["#e0566b", "#f2a541", "#b06ad9"];
const LEAF = "#4f8f3a";

let house: TownCanvas | null = null;

/** The house: TOWN_APARTMENTS_WIDTH tiles wide, its door on its bottom row. */
export function paintTownApartments(): TownCanvas {
  const art = townArtLandmark("apartments", (style) =>
    artApartments(style, TOWN_APARTMENTS_WIDTH * T, TOWN_APARTMENTS_ROWS * T),
  );
  if (art) return art;
  if (!house)
    house = paint(TOWN_APARTMENTS_WIDTH * T, TOWN_APARTMENTS_ROWS * T);
  return house;
}

function paint(W: number, H: number) {
  const [canvas, g] = townCanvas(W, H);
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const roof = 12;
  const plinth = H - 6;

  rect(6, H - 6, W - 8, 6, "rgba(0,0,0,.2)");
  // A water tank on the roof, then the parapet.
  rect(W - 34, 0, 18, 10, "#8a6a4a");
  rect(W - 34, 0, 18, 2, townShade("#8a6a4a", 0.25));
  rect(W - 32, 10, 2, 4, TOWN_OUTLINE);
  rect(W - 20, 10, 2, 4, TOWN_OUTLINE);
  rect(2, roof - 4, W - 4, 4, ROOF);
  rect(2, roof - 4, W - 4, 1, townShade(ROOF, 0.3));
  rect(2, roof - 1, W - 4, 1, townShade(ROOF, -0.4));

  // Sandstone walls with a course every storey.
  rect(4, roof, W - 8, plinth - roof, WALL);
  for (let y = roof + 5; y < plinth; y += 6)
    for (let x = 4 + ((y / 6) % 2) * 5; x < W - 4; x += 10)
      rect(x, y, 4, 1, WALL_DARK);
  const storey = Math.floor((plinth - roof) / 3);
  for (let i = 1; i < 3; i += 1) {
    rect(2, roof + i * storey - 2, W - 4, 3, TRIM);
    rect(2, roof + i * storey + 1, W - 4, 1, WALL_DARK);
  }
  rect(2, roof, W - 4, 3, TRIM);
  rect(2, plinth, W - 4, 6, townShade(WALL, -0.25));
  rect(2, plinth, W - 4, 1, TRIM);

  // Windows: three per upper storey, two either side of the door below.
  const mid = Math.round(W / 2);
  const window = (x: number, y: number, flower: string) => {
    rect(x - 1, y - 1, 18, 12, FRAME);
    rect(x, y, 16, 10, GLASS);
    rect(x, y + 6, 16, 4, GLASS_LOW);
    rect(x + 7, y, 2, 10, FRAME);
    rect(x - 2, y + 11, 20, 2, TRIM);
    rect(x, y + 15, 16, 2, townShade(FRAME, 0.15));
    for (let f = 0; f < 4; f += 1) {
      rect(x + 1 + f * 4, y + 14, 2, 2, LEAF);
      rect(x + 2 + f * 4, y + 13, 2, 2, flower);
    }
  };
  // Each storey's windows sit under its trim course.
  const sill = (floor: number) => roof + floor * storey + 5;
  for (let floor = 0; floor < 2; floor += 1)
    for (let i = 0; i < 3; i += 1)
      window(14 + i * 40, sill(floor), FLOWER[(i + floor) % FLOWER.length]!);
  window(14, sill(2), FLOWER[2]!);
  window(W - 30, sill(2), FLOWER[0]!);

  // The front door under a canopy, lit from inside.
  const doorTop = sill(2) + 1;
  rect(mid - 12, doorTop - 4, 24, 4, townShade(DOOR, -0.35));
  rect(mid - 13, doorTop - 5, 26, 1, TRIM);
  rect(mid - 9, doorTop, 18, plinth - doorTop, FRAME);
  rect(mid - 7, doorTop + 2, 14, plinth - doorTop - 2, DOOR);
  rect(mid - 5, doorTop + 4, 10, 5, GLASS);
  rect(mid + 3, doorTop + 12, 2, 2, "#e8c75a");
  // Letterboxes by the door: one slot each, for the residents.
  for (let i = 0; i < 3; i += 1)
    rect(mid + 12, doorTop + 4 + i * 5, 6, 3, "#c4c9d2");
  // The step onto the plaza's walk.
  rect(mid - 12, H - 3, 24, 3, TRIM);
  return canvas;
}
