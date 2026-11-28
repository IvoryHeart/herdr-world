/**
 * The Town art kit (#1117): the shared parts every landmark is built from in
 * an art direction (townArtDirection.ts), following the Town art guide
 * (docs/design/town-art.md). The rules live here so that every building, and
 * the agents and desks beside them, read as drawn by one hand:
 *
 * - Light comes from the top left: a surface's top row is lighter, its right
 *   edge and its underside darker (`face`), as on the agents and desks.
 * - Shapes are flat fills in a small palette; texture is a low-contrast
 *   pattern of at least two-pixel marks, never one-pixel noise.
 * - The finished building carries Town's one-pixel ink outline
 *   (townOutline) over a soft ground shadow that lies outside the outline.
 */

import {
  TOWN_OUTLINE,
  townCanvas,
  townOutline,
  townShade,
  type TownCanvas,
} from "./townSprites";

/** Colours every direction shares: ink, lit glass, wood, iron and ground. */
export const ART = {
  ink: TOWN_OUTLINE,
  glass: "#ffe39a",
  glassLow: "#f2c46a",
  inside: "#2b2228",
  wood: "#9b6a3f",
  woodDark: "#6e4a2e",
  woodLight: "#c9925c",
  iron: "#3a3f4a",
  ironLight: "#6b7280",
  paper: "#fbf6e8",
  leaf: "#3f7a3a",
  leafLight: "#5c9a48",
  grass: "#6fae5a",
  gold: "#e8c75a",
  shadow: "rgba(0,0,0,.2)",
} as const;

type ArtRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) => void;

export type ArtPaint = {
  canvas: TownCanvas;
  g: CanvasRenderingContext2D;
  W: number;
  H: number;
  rect: ArtRect;
  disc: (cx: number, cy: number, r: number, color: string) => void;
};

export function artPainter(W: number, H: number): ArtPaint {
  const [canvas, g] = townCanvas(W, H);
  const rect: ArtRect = (x, y, w, h, color) => {
    if (w <= 0 || h <= 0) return;
    g.fillStyle = color;
    g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const disc = (cx: number, cy: number, r: number, color: string) => {
    g.fillStyle = color;
    for (let y = -r; y <= r; y += 1) {
      const w = Math.round(Math.sqrt(Math.max(0, r * r - y * y)));
      g.fillRect(Math.round(cx - w), Math.round(cy + y), w * 2, 1);
    }
  };
  return { canvas, g, W, H, rect, disc };
}

/** The building in Town's ink over its ground shadow. */
export function artFinish(ground: ArtPaint, art: ArtPaint) {
  ground.g.drawImage(townOutline(art.canvas), 0, 0);
  return ground.canvas;
}

/**
 * A lit surface: its fill, a lighter top row, a darker right edge and a
 * darker underside: the agents' and desks' shading.
 */
export function face(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  { top = 0.22, right = -0.16, under = -0.28 } = {},
) {
  p.rect(x, y, w, h, color);
  if (top) p.rect(x, y, w, Math.min(2, h), townShade(color, top));
  if (right) p.rect(x + w - 2, y, 2, h, townShade(color, right));
  if (under) p.rect(x, y + h - 2, w, 2, townShade(color, under));
}

export type ArtTiles = "round" | "shingle" | "slate" | "seam" | "plain";

/**
 * A hipped roof seen from three-quarters above, like the rooms' roofs: a
 * narrow back slope, a ridge, a deep front slope, a lit left hip and a shaded
 * right hip, with tiles on the slopes and a dark eave.
 */
export function hipRoof(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  tiles: ArtTiles,
  hip = Math.round(h * 0.6),
) {
  const ridge = Math.max(2, Math.round(h * 0.32));
  const edge = (r: number) =>
    Math.round(
      hip * (r <= ridge ? r / ridge : (h - 1 - r) / Math.max(1, h - 1 - ridge)),
    );
  const back = townShade(color, 0.18);
  const lit = townShade(color, 0.3);
  const dark = townShade(color, -0.28);
  for (let r = 0; r < h; r += 1) {
    const inset = edge(r);
    const slope =
      r < ridge ? back : townShade(color, 0.06 - ((r - ridge) / h) * 0.22);
    p.rect(x, y + r, inset, 1, lit);
    p.rect(x + inset, y + r, w - inset * 2, 1, slope);
    p.rect(x + w - inset, y + r, inset, 1, dark);
  }
  // Tiles: courses across the front slope, staggered joints.
  const course = tiles === "round" ? 5 : tiles === "slate" ? 4 : 6;
  for (let r = ridge + course; r < h - 2; r += course) {
    const inset = edge(r);
    const row = townShade(color, -0.2);
    if (tiles !== "plain") p.rect(x + inset, y + r, w - inset * 2, 1, row);
    const step = tiles === "round" ? 5 : tiles === "seam" ? 6 : 8;
    const offset = (Math.floor(r / course) % 2) * Math.floor(step / 2);
    if (tiles === "round" || tiles === "shingle" || tiles === "slate")
      for (let xx = x + inset + offset; xx < x + w - inset - 1; xx += step) {
        p.rect(xx, y + r - course + 1, 1, course - 1, row);
        if (tiles === "round")
          p.rect(xx + 1, y + r - course + 1, 2, 1, townShade(color, 0.2));
      }
  }
  if (tiles === "seam")
    for (let xx = x + 6; xx < x + w - 6; xx += 6)
      for (let r = 0; r < h - 2; r += 1) {
        const inset = edge(r);
        if (xx > x + inset && xx < x + w - inset)
          p.rect(xx, y + r, 1, 1, townShade(color, r < ridge ? -0.04 : -0.16));
      }
  // The ridge catches the light; the hips are crisp; the eave is dark.
  p.rect(x + hip, y + ridge - 1, w - hip * 2, 2, lit);
  for (let r = 0; r < h; r += 1) {
    const inset = edge(r);
    p.rect(x + inset, y + r, 1, 1, townShade(color, 0.42));
    p.rect(x + w - inset - 1, y + r, 1, 1, townShade(color, -0.42));
  }
  p.rect(x, y + h - 2, w, 2, townShade(color, -0.45));
}

/**
 * A gable end facing the street, apex at (cx, top), `half` wide at its
 * base row: its boards or plaster, and a barge board in `trim`.
 */
export function gable(
  p: ArtPaint,
  cx: number,
  top: number,
  base: number,
  half: number,
  color: string,
  trim: string,
  boards = false,
) {
  const h = base - top;
  for (let r = 0; r <= h; r += 1) {
    const hw = Math.round((r / h) * half);
    const fill =
      boards && r % 4 === 3
        ? townShade(color, -0.18)
        : townShade(color, r < 2 ? 0.2 : 0);
    p.rect(cx - hw, top + r, hw * 2, 1, fill);
    p.rect(cx + hw - 2, top + r, 2, 1, townShade(color, -0.16));
    p.rect(cx - hw - 2, top + r, 3, 1, trim);
    p.rect(cx + hw - 1, top + r, 3, 1, townShade(trim, -0.15));
  }
}

export type ArtWall = "plaster" | "boards" | "brick" | "card" | "stone";

/** A wall face with its material, its top row shaded by the eave. */
export function wall(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  kind: ArtWall,
) {
  p.rect(x, y, w, h, color);
  const joint = townShade(color, kind === "brick" ? -0.16 : -0.1);
  if (kind === "boards")
    for (let yy = y + 3; yy < y + h; yy += 4) p.rect(x, yy, w, 1, joint);
  else if (kind === "brick")
    for (let yy = y + 4, row = 0; yy < y + h; yy += 5, row += 1) {
      p.rect(x, yy, w, 1, joint);
      for (let xx = x + (row % 2) * 5; xx < x + w; xx += 10)
        p.rect(xx, yy - 4, 1, 4, joint);
    }
  else if (kind === "stone")
    for (let yy = y + 6, row = 0; yy < y + h; yy += 7, row += 1) {
      p.rect(x, yy, w, 1, joint);
      for (let xx = x + (row % 2) * 8; xx < x + w; xx += 16)
        p.rect(xx, yy - 6, 1, 6, joint);
    }
  else if (kind === "plaster")
    p.rect(x, y + h - 6, w, 6, townShade(color, -0.07));
  p.rect(x, y, w, 3, townShade(color, -0.3));
  p.rect(x + w - 2, y, 2, h, townShade(color, -0.12));
}

/** A window lit warm from inside: a frame, two panes, a sill. */
export function lit(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: string,
  { arch = false, sill = true, panes = 2, glass = ART.glass } = {},
) {
  const r = Math.floor(w / 2);
  if (arch) p.disc(x + r, y + r, r, frame);
  p.rect(x, y + (arch ? r : 0), w, h - (arch ? r : 0), frame);
  if (arch) p.disc(x + r, y + r, r - 2, glass);
  p.rect(x + 2, y + (arch ? r : 2), w - 4, h - (arch ? r : 2) - 2, glass);
  p.rect(
    x + 2,
    y + Math.round(h * 0.6),
    w - 4,
    h - Math.round(h * 0.6) - 2,
    ART.glassLow,
  );
  p.rect(x + 2, y + (arch ? r : 2), 2, 2, "#fff7d6");
  for (let i = 1; i < panes; i += 1)
    p.rect(x + Math.round((w * i) / panes) - 1, y + 2, 2, h - 3, frame);
  if (sill) p.rect(x - 2, y + h, w + 4, 2, townShade(frame, 0.25));
}

/** A door, `w` wide, standing on `foot`: panels, a knob, optional arch. */
export function door(
  p: ArtPaint,
  cx: number,
  foot: number,
  w: number,
  h: number,
  color: string,
  frame: string,
  { arch = false, double = false, fanlight = false } = {},
) {
  const x = Math.round(cx - w / 2);
  const top = foot - h;
  const r = Math.floor(w / 2) + 2;
  if (arch) p.disc(cx, top + r - 2, r, frame);
  p.rect(
    x - 2,
    top + (arch ? r - 2 : -2),
    w + 4,
    h - (arch ? r - 2 : -2),
    frame,
  );
  if (arch) p.disc(cx, top + r - 2, r - 2, fanlight ? ART.glass : color);
  p.rect(x, top + (arch ? r - 2 : 0), w, h - (arch ? r - 2 : 0), color);
  const panel = townShade(color, 0.16);
  const leaves = double ? 2 : 1;
  const lw = Math.floor(w / leaves);
  for (let i = 0; i < leaves; i += 1) {
    const lx = x + i * lw;
    p.rect(lx + 2, foot - h + Math.round(h * 0.4), lw - 4, 4, panel);
    p.rect(lx + 2, foot - 8, lw - 4, 4, panel);
  }
  if (double)
    p.rect(cx - 1, top + (arch ? r - 2 : 0), 1, h, townShade(color, -0.4));
  p.rect(x, top + (arch ? r - 2 : 0), w, 2, townShade(color, 0.3));
  p.rect(double ? cx + 2 : x + w - 4, foot - Math.round(h / 2), 2, 2, ART.gold);
}

/** A lantern on a bracket: iron, lit glass. */
export function lantern(p: ArtPaint, x: number, y: number) {
  p.rect(x + 1, y - 2, 2, 2, ART.iron);
  p.rect(x - 1, y, 6, 8, ART.iron);
  p.rect(x, y + 1, 4, 6, ART.glass);
  p.rect(x, y + 1, 4, 1, "#fff7d6");
  p.rect(x - 2, y - 1, 8, 2, ART.iron);
}

/** A round bush, lit from the top left, optionally in a pot. */
export function bush(
  p: ArtPaint,
  cx: number,
  cy: number,
  r: number,
  flower?: string,
) {
  p.disc(cx, cy, r, ART.leaf);
  p.disc(cx - 1, cy - 1, r - 2, ART.leafLight);
  p.disc(cx - 2, cy - 2, Math.max(1, r - 4), townShade(ART.leafLight, 0.2));
  if (flower) {
    p.rect(cx - 2, cy - 1, 2, 2, flower);
    p.rect(cx + 2, cy + 1, 2, 2, flower);
  }
}

/** Stone steps down from a door: `count` steps, widening. */
export function steps(
  p: ArtPaint,
  cx: number,
  foot: number,
  w: number,
  color: string,
  count = 2,
) {
  for (let i = 0; i < count; i += 1) {
    const sw = w + i * 6;
    const y = foot - (count - i) * 3;
    p.rect(cx - sw / 2, y, sw, 3, color);
    p.rect(cx - sw / 2, y, sw, 1, townShade(color, 0.25));
  }
}

/** Ground: courses of setts, cobbles or flags inside a kerb. */
export function paving(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  size: { w: number; h: number } = { w: 8, h: 5 },
) {
  p.rect(x, y, w, h, townShade(color, -0.16));
  for (let yy = y + 1, row = 0; yy < y + h - 1; yy += size.h, row += 1)
    for (
      let xx = x + 1 - (row % 2) * Math.floor(size.w / 2), i = 0;
      xx < x + w - 1;
      xx += size.w, i += 1
    ) {
      const x0 = Math.max(x + 1, xx);
      const sw = Math.min(xx + size.w - 1, x + w - 1) - x0;
      const sh = Math.min(size.h - 1, y + h - 1 - yy);
      if (sw <= 0 || sh <= 0) continue;
      const tone = ((row * 5 + i * 3) % 4) * 0.025 - 0.03;
      p.rect(x0, yy, sw, sh, townShade(color, tone));
      p.rect(x0, yy, sw, 1, townShade(color, 0.12));
    }
}

/**
 * A paper card layer for the paper direction: the shapes `draw` paints are
 * cut out of card, with a pale cut edge and a soft shadow on what lies
 * beneath, so a building reads as layers of a pop-up book.
 */
export function card(
  p: ArtPaint,
  draw: (layer: ArtPaint) => void,
  rim = "#fff8ea",
  depth = 3,
) {
  const layer = artPainter(p.W, p.H);
  draw(layer);
  const [shade, s] = townCanvas(p.W, p.H);
  s.drawImage(layer.canvas, 0, 0);
  s.globalCompositeOperation = "source-in";
  s.fillStyle = "rgba(40,22,30,.3)";
  s.fillRect(0, 0, p.W, p.H);
  // The shadow falls only on the cards already laid, never on the air.
  p.g.globalCompositeOperation = "source-atop";
  p.g.drawImage(shade, depth, depth + 1);
  p.g.globalCompositeOperation = "source-over";
  // A cut edge two pixels wide, the card's white core showing.
  p.g.drawImage(townOutline(townOutline(layer.canvas, rim), rim), 0, 0);
  p.g.drawImage(layer.canvas, 0, 0);
}

/** Text in a 3×5 pixel face, four pixels a letter. */
const GLYPHS: Record<string, readonly string[]> = {
  P: ["111", "101", "111", "100", "100"],
  O: ["111", "101", "101", "101", "111"],
  S: ["111", "100", "111", "001", "111"],
  T: ["111", "010", "010", "010", "010"],
};

export function word(
  p: ArtPaint,
  text: string,
  x: number,
  y: number,
  color: string,
) {
  for (const [index, letter] of [...text].entries())
    for (const [row, bits] of (GLYPHS[letter] ?? []).entries())
      for (const [column, bit] of [...bits].entries())
        if (bit === "1") p.rect(x + index * 4 + column, y + row, 1, 1, color);
}
