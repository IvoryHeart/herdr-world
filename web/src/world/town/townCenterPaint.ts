/**
 * The town center's art: a civic hall in Town's pixel style. A copper dome on
 * a clock drum, a columned portico under a pediment with a gold crest, slate
 * wings ending in pavilions, banners, lamps and wide front steps. Painted once
 * per width and shared; the renderer places it as one outdoor sprite.
 */

import { TOWN_CENTER_FRIEZE_Y, TOWN_CENTER_HEIGHT } from "./townCenter";
import { TOWN_TILE as T } from "./townLayout";
import {
  TOWN_OUTLINE,
  townCanvas,
  townShade,
  type TownCanvas,
} from "./townSprites";

const STONE = "#ece2c8";
const STONE_SHADE = "#cfc1a0";
const STONE_DARK = "#9a8a6c";
const COLUMN = "#f7f2e6";
const SLATE = "#4f5a80";
const COPPER = "#4f9a86";
const GOLD = "#e8c75a";
const GOLD_LIGHT = "#fff0b0";
const GOLD_DARK = "#a8862e";
const BANNER = "#b44a3f";
const GLASS = "#ffe39a";

const painted = new Map<number, TownCanvas>();

/** The center `widthTiles` wide, painted once per width. */
export function paintTownCenter(widthTiles: number): TownCanvas {
  let canvas = painted.get(widthTiles);
  if (!canvas) {
    canvas = paint(widthTiles * T, TOWN_CENTER_HEIGHT * T);
    painted.set(widthTiles, canvas);
  }
  return canvas;
}

function paint(W: number, H: number): TownCanvas {
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
  const mid = Math.round(W / 2);
  const front = TOWN_CENTER_FRIEZE_Y - 5; // the frieze's top row
  const plinth = 200; // the portico floor; steps run below it
  // The central block is wider in a wider town; wings take the rest.
  const block = W >= 500 ? 168 : 144;
  const bx0 = mid - block / 2;
  const bx1 = mid + block / 2;
  const pavilion = W >= 500 ? 44 : 32;

  /* ---------- ground shadow ---------- */
  rect(14, plinth - 4, W - 20, 12, "rgba(0,0,0,.2)");

  /* ---------- wings and end pavilions ---------- */
  const wingTop = front - 34;
  for (const side of [-1, 1] as const) {
    const outer = side < 0 ? 8 : W - 8;
    const x0 = Math.min(outer, side < 0 ? bx0 : bx1);
    const x1 = Math.max(outer, side < 0 ? bx0 : bx1);
    // The wing's roof seen from above, then its front wall.
    slateRoof(x0, wingTop, x1 - x0, 32);
    wall(x0, wingTop + 32, x1 - x0, plinth - wingTop - 32);
    const px0 = side < 0 ? x0 : x1 - pavilion;
    // Arched windows between the block and the pavilion.
    const wx0 = side < 0 ? px0 + pavilion + 10 : bx1 + 10;
    const wx1 = side < 0 ? bx0 - 10 : px0 - 10;
    for (let x = wx0; x + 14 <= wx1; x += 26) archWindow(x, front + 8, 14, 30);
    // The pavilion: a hipped roof with a gold finial, a taller window.
    const roofTop = wingTop - 18;
    for (let y = 0; y < 34; y += 1) {
      const inset = Math.max(
        0,
        Math.round(((34 - y) / 34) * (pavilion / 2 - 4)),
      );
      rect(
        px0 - 3 + inset,
        roofTop + y,
        pavilion + 6 - inset * 2,
        1,
        townShade(SLATE, y % 6 === 5 ? -0.3 : 0.12 - (y / 34) * 0.25),
      );
    }
    rect(px0 - 3, roofTop + 33, pavilion + 6, 2, townShade(SLATE, -0.45));
    rect(px0 + pavilion / 2 - 1, roofTop - 7, 2, 8, GOLD_DARK);
    disc(px0 + pavilion / 2, roofTop - 8, 2, GOLD);
    wall(px0, roofTop + 35, pavilion, plinth - roofTop - 35);
    rect(px0, roofTop + 35, pavilion, 3, STONE_DARK);
    archWindow(px0 + pavilion / 2 - 8, front - 4, 16, 42);
    // Quoins at the pavilion's corners.
    for (let y = roofTop + 40; y < plinth - 6; y += 8) {
      rect(px0, y, 4, 4, STONE_SHADE);
      rect(px0 + pavilion - 4, y + 4, 4, 4, STONE_SHADE);
    }
  }

  /* ---------- the drum, clock and dome behind the pediment ---------- */
  const drumTop = 60;
  rect(mid - 28, drumTop, 56, front - drumTop, STONE_SHADE);
  rect(mid - 26, drumTop, 52, front - drumTop, STONE);
  for (const dx of [-26, -14, 10, 22])
    rect(mid + dx, drumTop + 4, 4, 40, STONE_SHADE);
  rect(mid - 30, drumTop - 2, 60, 4, STONE_DARK);
  // The clock: ten past ten.
  disc(mid, drumTop + 22, 12, GOLD_DARK);
  disc(mid, drumTop + 22, 10, "#fbf6e8");
  rect(mid - 1, drumTop + 13, 2, 2, TOWN_OUTLINE);
  rect(mid - 1, drumTop + 29, 2, 2, TOWN_OUTLINE);
  rect(mid - 9, drumTop + 21, 2, 2, TOWN_OUTLINE);
  rect(mid + 7, drumTop + 21, 2, 2, TOWN_OUTLINE);
  for (let i = 0; i < 6; i += 1) {
    rect(mid - 1 - i, drumTop + 21 - Math.round(i * 0.6), 2, 2, TOWN_OUTLINE);
    rect(mid + i, drumTop + 21 - Math.round(i * 0.9), 2, 2, TOWN_OUTLINE);
  }
  // The dome: copper with ribs and a highlight, a gold band at its foot.
  const domeY = drumTop - 2;
  for (let y = 0; y < 34; y += 1) {
    const half = Math.round(30 * Math.sqrt(1 - ((34 - y) / 34) ** 2));
    rect(
      mid - half,
      domeY - 34 + y,
      half * 2,
      1,
      townShade(COPPER, 0.16 - y * 0.012),
    );
    if (half > 4) {
      rect(
        mid - Math.round(half * 0.5),
        domeY - 34 + y,
        1,
        1,
        townShade(COPPER, -0.32),
      );
      rect(
        mid + Math.round(half * 0.5),
        domeY - 34 + y,
        1,
        1,
        townShade(COPPER, -0.32),
      );
      rect(mid, domeY - 34 + y, 1, 1, townShade(COPPER, -0.25));
      rect(
        mid - Math.round(half * 0.78),
        domeY - 34 + y,
        2,
        1,
        townShade(COPPER, 0.42),
      );
    }
  }
  rect(mid - 31, domeY - 2, 62, 4, GOLD);
  rect(mid - 31, domeY - 2, 62, 1, GOLD_LIGHT);
  // The lantern, finial and flag.
  rect(mid - 6, domeY - 44, 12, 10, STONE);
  rect(mid - 4, domeY - 42, 3, 6, "#3a2b22");
  rect(mid + 1, domeY - 42, 3, 6, "#3a2b22");
  rect(mid - 7, domeY - 46, 14, 3, GOLD);
  rect(mid - 1, 1, 2, domeY - 47, GOLD_DARK);
  disc(mid, 1, 2, GOLD_LIGHT);
  for (let x = 0; x < 20; x += 1) {
    const wave = Math.round(Math.sin(x / 3.2));
    rect(mid + 1 + x, 2 + wave, 1, 9 - Math.floor(x / 5), "#d9644a");
    if (x < 16) rect(mid + 1 + x, 5 + wave, 1, 2, GOLD);
  }

  /* ---------- the central block: roof, pediment, frieze ---------- */
  slateRoof(bx0 - 4, front - 46, block + 8, 20);
  const apex = front - 34;
  for (let y = apex; y < front; y += 1) {
    const half = Math.round(((y - apex) / (front - apex)) * (block / 2 + 6));
    rect(mid - half - 2, y, half * 2 + 4, 1, STONE_DARK);
    rect(mid - half + 1, y, half * 2 - 2, 1, y < apex + 3 ? STONE_DARK : STONE);
  }
  rect(bx0 - 8, front - 2, block + 16, 3, STONE_DARK);
  // The crest: a gold medallion with a star.
  const crestY = front - 13;
  disc(mid, crestY, 10, GOLD_DARK);
  disc(mid, crestY, 8, GOLD);
  disc(mid - 2, crestY - 2, 3, GOLD_LIGHT);
  rect(mid - 1, crestY - 5, 2, 10, BANNER);
  rect(mid - 5, crestY - 1, 10, 2, BANNER);
  rect(mid - 3, crestY - 3, 6, 6, BANNER);
  rect(mid - 1, crestY - 1, 2, 2, GOLD_LIGHT);
  // The frieze, where the name plaque hangs.
  rect(bx0 - 6, front + 1, block + 12, 10, STONE);
  rect(bx0 - 6, front + 1, block + 12, 1, "#fbf6e8");
  rect(bx0 - 6, front + 10, block + 12, 2, GOLD);

  /* ---------- the portico ---------- */
  const portTop = front + 12;
  rect(bx0, portTop, block, plinth - portTop, "#8e8169");
  rect(bx0, portTop, block, 4, "rgba(0,0,0,.25)");
  // The doors: an arch lit warm from inside.
  const doorY = portTop + 18;
  rect(mid - 12, doorY, 24, plinth - doorY, "#5b4535");
  disc(mid, doorY, 12, "#5b4535");
  rect(mid - 10, doorY, 20, plinth - doorY, "#3a2b22");
  disc(mid, doorY, 10, "#3a2b22");
  rect(mid - 8, doorY + 1, 16, plinth - doorY - 1, "#ffd27a");
  disc(mid, doorY + 1, 8, "#ffd27a");
  rect(mid - 1, doorY - 10, 2, plinth - doorY + 10, "#5b4535");
  rect(mid - 8, doorY + 12, 16, plinth - doorY - 12, "#f2b85a");
  rect(mid - 4, doorY + 16, 2, 3, GOLD_DARK);
  rect(mid + 2, doorY + 16, 2, 3, GOLD_DARK);
  // Banners between the outer columns.
  const columns = 6;
  const step = (block - 16) / (columns - 1);
  const colX = (i: number) => Math.round(bx0 + 8 + i * step);
  for (const i of [0, columns - 2]) {
    const x = Math.round((colX(i) + colX(i + 1)) / 2) - 7;
    rect(x, portTop + 2, 14, 28, BANNER);
    rect(x, portTop + 2, 14, 2, townShade(BANNER, -0.35));
    rect(x + 1, portTop + 30, 5, 3, BANNER);
    rect(x + 8, portTop + 30, 5, 3, BANNER);
    disc(x + 7, portTop + 15, 4, GOLD);
    rect(x + 6, portTop + 14, 2, 2, BANNER);
  }
  for (let i = 0; i < columns; i += 1)
    column(colX(i), portTop, plinth - portTop);
  rect(bx0 - 6, plinth - 2, block + 12, 6, STONE);
  rect(bx0 - 6, plinth - 2, block + 12, 1, "#fbf6e8");
  rect(bx0 - 6, plinth + 3, block + 12, 1, STONE_DARK);

  /* ---------- steps, lamps and planters ---------- */
  const steps = [
    { y: plinth + 4, w: block - 4 },
    { y: plinth + 12, w: block + 12 },
    { y: plinth + 20, w: block + 28 },
  ];
  for (const s of steps) {
    rect(mid - s.w / 2, s.y, s.w, 8, STONE_SHADE);
    rect(mid - s.w / 2, s.y, s.w, 3, STONE);
    rect(mid - s.w / 2, s.y + 7, s.w, 1, STONE_DARK);
  }
  rect(
    mid - steps[2]!.w / 2 + 2,
    plinth + 28,
    steps[2]!.w,
    4,
    "rgba(0,0,0,.18)",
  );
  for (const side of [-1, 1] as const) {
    // A lamp at each end of the bottom step.
    const lx = mid + side * (steps[2]!.w / 2 + 14);
    rect(lx - 1, plinth - 22, 3, 46, "#3a3f4a");
    rect(lx - 4, plinth + 22, 9, 3, "#3a3f4a");
    rect(lx - 4, plinth - 30, 9, 9, "#3a3f4a");
    rect(lx - 3, plinth - 29, 7, 7, GLASS);
    rect(lx - 5, plinth - 32, 11, 3, "#2a2e36");
    // A clipped bush in a stone planter beside the portico.
    const tx = side < 0 ? bx0 - 18 : bx1 + 4;
    rect(tx, plinth - 8, 14, 10, STONE_DARK);
    rect(tx + 1, plinth - 8, 12, 2, STONE);
    disc(tx + 7, plinth - 15, 8, "#3f7a3a");
    disc(tx + 5, plinth - 17, 4, "#5c9a48");
    rect(tx + 4, plinth - 20, 1, 1, "#f2a5c4");
    rect(tx + 10, plinth - 14, 1, 1, "#fff5d6");
  }
  return canvas;

  function slateRoof(x: number, y: number, w: number, h: number) {
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

  function wall(x: number, y: number, w: number, h: number) {
    rect(x, y, w, h, STONE);
    g.fillStyle = townShade(STONE, -0.06);
    for (let yy = y + 6; yy < y + h; yy += 6) g.fillRect(x, yy, w, 1);
    rect(x, y, w, 3, STONE_SHADE);
    rect(x, y + h - 6, w, 6, STONE_SHADE);
    rect(x, y + h - 6, w, 1, STONE_DARK);
  }

  function archWindow(x: number, y: number, w: number, h: number) {
    const r = Math.floor(w / 2);
    disc(x + r, y + r + 1, r + 1, STONE_DARK);
    rect(x - 1, y + r, w + 2, h - r + 1, STONE_DARK);
    disc(x + r, y + r + 1, r - 1, GLASS);
    rect(x + 1, y + r, w - 2, h - r - 1, GLASS);
    rect(x + 1, y + h - 8, w - 2, 7, "#f2c46a");
    rect(x + r, y + 2, 1, h - 3, STONE_DARK);
    rect(x + 1, y + r + 6, w - 2, 1, STONE_DARK);
    rect(x - 2, y + h, w + 4, 2, STONE_DARK);
  }

  function column(x: number, y: number, h: number) {
    rect(x - 6, y, 13, 4, COLUMN);
    rect(x - 6, y + 3, 13, 1, STONE_DARK);
    rect(x - 4, y + 4, 9, h - 8, COLUMN);
    rect(x - 4, y + 4, 2, h - 8, "#ffffff");
    rect(x + 2, y + 4, 3, h - 8, STONE_SHADE);
    rect(x - 1, y + 6, 1, h - 12, STONE_SHADE);
    rect(x - 6, y + h - 4, 13, 4, COLUMN);
    rect(x - 6, y + h - 4, 13, 1, STONE_SHADE);
  }
}
