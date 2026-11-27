/**
 * The Town landmarks in an art direction (#1117, docs/design/town-art.md):
 * the post office, town center, library, apartments, warehouse, piers and
 * lighthouse, each one plan painted in a style (townArtStyles.ts). The plans
 * keep today's sizes, doors, sign places, yard props and lamp room, so only
 * the paint changes. Every direction is drawn with the art kit's light,
 * outline and texture rules, so each reads beside the agents and desks.
 */

import { TOWN_CENTER_FRIEZE_Y } from "./townCenter";
import { TOWN_LIGHTHOUSE } from "./townHarbour";
import { TOWN_PIER_ART } from "./townHarbourArt";
import {
  ART,
  type ArtPaint,
  artFinish,
  artPainter,
  bush,
  card,
  door,
  face,
  gable,
  hipRoof,
  lantern,
  lit,
  paving,
  steps,
  wall,
  word,
} from "./townArtKit";
import { townArtDirection } from "./townArtDirection";
import {
  type ArtBuilding,
  type ArtStyle,
  TOWN_ART_STYLES,
} from "./townArtStyles";
import { TOWN_LIBRARY_SPINES } from "./townLibraryPaint";
import { townShade, type TownCanvas } from "./townSprites";

type Layer = (p: ArtPaint) => void;
type Box = readonly [x: number, y: number, w: number, h: number];

/**
 * The building from its layers, back to front, over its ground shadows: in
 * one ink drawing, or for a paper style as cards laid one on another.
 */
function compose(
  style: ArtStyle,
  W: number,
  H: number,
  shadows: readonly Box[],
  layers: readonly Layer[],
  ground?: Layer,
): TownCanvas {
  const base = artPainter(W, H);
  ground?.(base);
  for (const [x, y, w, h] of shadows) base.rect(x, y, w, h, ART.shadow);
  const art = artPainter(W, H);
  if (style.finish === "card")
    for (const layer of layers) card(art, layer, style.rim);
  else for (const layer of layers) layer(art);
  return artFinish(base, art);
}

/** A roof over a block: hipped, gabled toward the street, or flat card. */
function roof(
  p: ArtPaint,
  style: ArtStyle,
  b: ArtBuilding,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  if (style.finish === "card") return cardRoof(p, x, y, w, h, b.roof);
  if (style.roof === "gable") hipRoof(p, x, y, w, h, b.roof, b.tiles, 3);
  else hipRoof(p, x, y, w, h, b.roof, b.tiles);
}

/**
 * A paper roof: one flat card folded along its ridge, its eave cut in
 * scallops that hang over the wall below.
 */
function cardRoof(
  p: ArtPaint,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
) {
  const ridge = Math.round(h * 0.35);
  const inset = Math.min(10, Math.round(h * 0.4));
  for (let r = 0; r < h; r += 1) {
    const i = Math.round(inset * (1 - r / h));
    p.rect(
      x + i,
      y + r,
      w - i * 2,
      1,
      r < ridge ? townShade(color, 0.22) : color,
    );
  }
  p.rect(x + inset, y + ridge, w - inset * 2, 1, townShade(color, -0.18));
  for (let xx = x + 4; xx <= x + w - 4; xx += 8) p.disc(xx, y + h, 4, color);
}

/** The walls of a block from `top` to `foot`, with corner posts or quoins. */
function walls(
  p: ArtPaint,
  style: ArtStyle,
  b: ArtBuilding,
  x: number,
  top: number,
  w: number,
  foot: number,
) {
  wall(p, x, top, w, foot - top, b.wall, b.wallKind);
  if (style.corners) {
    face(p, x, top, 4, foot - top, b.trim, { top: 0, under: 0 });
    face(p, x + w - 4, top, 4, foot - top, b.trim, { top: 0, under: 0 });
  }
  face(p, x - 2, foot, w + 4, 4, style.plinth, { right: 0, under: -0.2 });
}

/** A gable facing the street over a door, in the style's barge trim. */
function frontGable(
  p: ArtPaint,
  style: ArtStyle,
  b: ArtBuilding,
  cx: number,
  top: number,
  base: number,
  half: number,
) {
  gable(
    p,
    cx,
    top,
    base,
    half,
    b.gable ?? b.wall,
    style.barge ?? b.trim,
    b.wallKind === "boards",
  );
}

/** A window between `top` and `top + h`, its glass showing `inside`. */
function window(
  p: ArtPaint,
  style: ArtStyle,
  b: ArtBuilding,
  x: number,
  top: number,
  w: number,
  h: number,
  options: {
    arch?: boolean;
    inside?: (x: number, y: number, w: number, h: number) => void;
  } = {},
) {
  lit(p, x, top, w, h, b.frame ?? b.trim, {
    arch: options.arch ?? style.arches,
  });
  options.inside?.(x + 2, top + 2, w - 4, h - 4);
  if (style.shutters) {
    face(p, x - 5, top, 4, h, b.accent, { top: 0.2, under: 0 });
    face(p, x + w + 1, top, 4, h, b.accent, { top: 0.2, under: 0 });
  }
}

/** A flower box under a window. */
function flowers(p: ArtPaint, x: number, y: number, w: number, color: string) {
  p.rect(x - 1, y, w + 2, 4, ART.woodDark);
  for (let xx = x; xx < x + w; xx += 4) {
    p.rect(xx, y - 3, 3, 3, ART.leafLight);
    p.rect(xx + 1, y - 3, 2, 2, color);
  }
}

/* ---------- the post office ---------- */

/** A post horn: a gold coil, its bell to the right. */
function postHorn(
  p: ArtPaint,
  cx: number,
  cy: number,
  color: string = ART.gold,
) {
  // The coil, the mouthpiece left, the flared bell right.
  p.disc(cx, cy, 5, color);
  p.disc(cx, cy, 3, townShade(color, -0.5));
  p.disc(cx, cy, 1, color);
  p.rect(cx - 9, cy - 1, 5, 2, color);
  p.rect(cx + 4, cy - 1, 6, 2, color);
  p.rect(cx + 9, cy - 3, 2, 6, color);
  p.rect(cx + 11, cy - 5, 2, 10, color);
  p.rect(cx - 3, cy - 5, 4, 1, townShade(color, 0.45));
}

/** A red pillar box with its slot and cap. */
function pillarBox(p: ArtPaint, x: number, foot: number, red: string) {
  p.rect(x, foot - 18, 10, 18, red);
  p.disc(x + 5, foot - 18, 5, red);
  p.rect(x + 1, foot - 21, 3, 6, townShade(red, 0.3));
  p.rect(x + 8, foot - 18, 2, 18, townShade(red, -0.25));
  p.rect(x + 2, foot - 14, 6, 2, ART.inside);
  p.rect(x - 1, foot - 2, 12, 2, townShade(red, -0.4));
}

/** Letters in pigeonholes behind the glass. */
function racks(p: ArtPaint, x: number, y: number, w: number, h: number) {
  for (let yy = y + 1; yy < y + h - 2; yy += 5)
    for (let xx = x + 1; xx < x + w - 2; xx += 5)
      if ((xx + yy) % 3) p.rect(xx, yy, 3, 2, ART.paper);
}

export function artPostHouse(style: ArtStyle, W: number, H: number) {
  const b = style.post;
  const mid = Math.round(W / 2);
  const foot = H - 6;
  const eave = style.roof === "gable" ? 30 : 42;
  const windows = [22, 56, W - 78, W - 44] as const;
  return compose(
    style,
    W,
    H,
    [[8, H - 7, W - 12, 7]],
    [
      (p) => {
        // The chimney behind the roof.
        face(p, 30, 2, 12, 18, b.chimney ?? style.plinth);
        p.rect(28, 2, 16, 3, townShade(b.chimney ?? style.plinth, -0.3));
        roof(p, style, b, 6, 6, W - 12, eave - 4);
      },
      (p) => {
        walls(p, style, b, 12, eave, W - 24, foot);
        if (style.roof === "gable")
          frontGable(p, style, b, mid, 6, eave + 6, 40);
        else frontGable(p, style, b, mid, 18, eave + 4, 28);
      },
      (p) => {
        postHorn(p, mid - 3, style.roof === "gable" ? 26 : 34, style.horn);
        // The fascia: POST over the door.
        const sign = eave + 6;
        face(p, mid - 16, sign, 32, 9, b.sign ?? ART.iron, { under: 0 });
        word(p, "POST", mid - 7, sign + 2, ART.gold);
        door(p, mid, foot, 22, foot - sign - 14, b.door, b.frame ?? b.trim, {
          double: true,
          arch: style.arches,
          fanlight: style.arches,
        });
        for (const x of windows) {
          window(p, style, b, x, eave + 12, 20, 20, {
            inside: (ix, iy, iw, ih) => racks(p, ix, iy, iw, ih),
          });
          if (style.flowers) flowers(p, x, eave + 36, 20, b.accent);
        }
        lantern(p, mid - 22, eave + 18);
        lantern(p, mid + 18, eave + 18);
        pillarBox(p, mid + 32, foot, style.postRed);
        steps(p, mid, H - 2, 26, style.plinth);
      },
    ],
  );
}

export function artPostYard(style: ArtStyle, W: number, H: number) {
  const mid = Math.round(W / 2);
  return compose(
    style,
    W,
    H,
    [],
    [
      (p) => {
        // Mail sacks by the left kerb.
        for (const [sx, sy] of [
          [12, 26],
          [26, 30],
          [18, 38],
        ] as const) {
          p.disc(sx + 6, sy + 7, 7, style.sack);
          p.rect(sx + 4, sy - 2, 4, 4, style.sack);
          p.rect(sx + 3, sy + 1, 6, 2, ART.woodDark);
          p.disc(sx + 4, sy + 5, 2, townShade(style.sack, 0.25));
          p.rect(sx + 4, sy + 8, 4, 3, style.postRed);
        }
        // The postman's bicycle, its basket of letters.
        const bx = 120;
        const by = 30;
        for (const wx of [bx, bx + 22]) {
          p.disc(wx, by + 10, 7, ART.iron);
          p.disc(wx, by + 10, 4, townShade(style.paving, -0.05));
          p.disc(wx, by + 10, 1, ART.iron);
        }
        p.rect(bx, by + 8, 22, 3, style.postRed);
        p.rect(bx + 10, by + 1, 3, 10, style.postRed);
        p.rect(bx + 10, by + 1, 12, 3, style.postRed);
        p.rect(bx + 20, by - 3, 2, 12, ART.iron);
        p.rect(bx + 6, by - 1, 7, 2, ART.iron);
        face(p, bx + 22, by - 2, 10, 8, ART.wood);
        p.rect(bx + 23, by - 5, 4, 4, ART.paper);
        p.rect(bx + 28, by - 4, 3, 3, "#f6c9d6");
        // The mail trolley at the right end, laden.
        const cx = W - 32;
        p.disc(cx + 7, 19, 5, style.sack);
        p.disc(cx + 17, 18, 5, style.sack);
        face(p, cx, 22, 24, 18, style.postRed);
        p.rect(cx + 9, 32, 6, 4, ART.gold);
        p.rect(cx - 7, 25, 8, 2, ART.iron);
        p.disc(cx + 5, 42, 4, ART.inside);
        p.disc(cx + 19, 42, 4, ART.inside);
        // Two potted shrubs beside the path.
        for (const tx of [mid - 26, mid + 16]) {
          face(p, tx, 12, 10, 8, style.post.chimney ?? style.plinth);
          bush(p, tx + 5, 8, 6, "#f2a5c4");
        }
      },
    ],
    (g) => {
      paving(g, 1, 1, W - 4, H - 6, style.paving);
      paving(g, mid - 14, 1, 28, H - 6, style.path, { w: 14, h: 8 });
    },
  );
}

/* ---------- the library ---------- */

/** Books on shelves behind the glass, in the library's spine colours. */
function shelves(p: ArtPaint, x: number, y: number, w: number, h: number) {
  for (let shelf = y + h, row = 0; shelf > y + 4; shelf -= 7, row += 1) {
    for (let xx = x, i = row; xx < x + w - 1; i += 1) {
      const bw = 2;
      const bh = 5 - ((i * 7) % 2);
      p.rect(xx, shelf - bh - 1, bw, bh, TOWN_LIBRARY_SPINES[i % 6]!);
      xx += bw + (i % 4 === 0 ? 1 : 0);
    }
    p.rect(x, shelf - 1, w, 1, ART.woodDark);
  }
}

/** An open book: two pages and a spine. */
function openBook(p: ArtPaint, cx: number, cy: number, cover: string) {
  p.rect(cx - 12, cy - 6, 24, 12, cover);
  p.rect(cx - 10, cy - 7, 9, 11, ART.paper);
  p.rect(cx + 1, cy - 7, 9, 11, townShade(ART.paper, -0.08));
  for (let r = 0; r < 3; r += 1) {
    p.rect(cx - 8, cy - 4 + r * 3, 6, 1, townShade(ART.paper, -0.3));
    p.rect(cx + 3, cy - 4 + r * 3, 6, 1, townShade(ART.paper, -0.3));
  }
  p.rect(cx - 1, cy - 7, 2, 12, townShade(cover, -0.3));
}

export function artLibraryHouse(style: ArtStyle, W: number, H: number) {
  const b = style.library;
  const mid = Math.round(W / 2);
  const foot = H - 6;
  const gabled = style.roof === "gable";
  const eave = gabled ? 34 : 40;
  const windows = [20, 50, W - 72, W - 42] as const;
  return compose(
    style,
    W,
    H,
    [[8, H - 7, W - 12, 7]],
    [
      (p) => {
        if (!gabled) {
          // A lantern on the ridge, lit.
          face(p, mid - 10, 0, 20, 12, b.trim);
          lit(p, mid - 6, 2, 12, 8, b.frame ?? b.trim, { sill: false });
        }
        roof(p, style, b, 6, 8, W - 12, eave - 6);
      },
      (p) => {
        walls(p, style, b, 12, eave, W - 24, foot);
        if (gabled)
          // Three gables along the street, the middle one the tallest.
          for (const [cx, top, half] of [
            [44, 12, 30],
            [W - 44, 12, 30],
            [mid, 4, 34],
          ] as const)
            frontGable(p, style, b, cx, top, eave + 4, half);
        else frontGable(p, style, b, mid, 18, eave + 2, 26);
      },
      (p) => {
        openBook(p, mid, gabled ? 26 : 32, b.accent);
        for (const x of windows)
          window(p, style, b, x, eave + 8, 22, 30, {
            arch: true,
            inside: (ix, iy, iw, ih) => shelves(p, ix, iy + 4, iw, ih - 2),
          });
        door(p, mid, foot, 20, 34, b.door, b.frame ?? b.trim, {
          arch: true,
          fanlight: true,
        });
        lantern(p, mid - 20, eave + 14);
        lantern(p, mid + 16, eave + 14);
        steps(p, mid, H - 2, 24, style.plinth);
      },
    ],
  );
}

export function artLibraryYard(style: ArtStyle, W: number, H: number) {
  const mid = Math.round(W / 2);
  return compose(
    style,
    W,
    H,
    [],
    [
      (p) => {
        // A flower bed on the left, a bench below it.
        face(p, 10, 12, 44, 10, "#6b4a33", { top: 0 });
        for (let x = 13; x < 52; x += 5)
          bush(
            p,
            x,
            14,
            3,
            ["#e8607a", "#f2d24b", "#f6f2e6", "#9a6ad0"][x % 4],
          );
        face(p, 14, 28, 34, 4, ART.wood);
        p.rect(14, 32, 34, 3, ART.woodDark);
        p.rect(16, 35, 2, 6, ART.woodDark);
        p.rect(44, 35, 2, 6, ART.woodDark);
        // A cart of books to be shelved: memory waiting for you.
        const cx = W - 54;
        face(p, cx, 20, 36, 16, ART.wood);
        shelves(p, cx + 2, 12, 32, 10);
        p.rect(cx + 36, 14, 2, 14, ART.woodDark);
        p.disc(cx + 6, 40, 4, ART.inside);
        p.disc(cx + 30, 40, 4, ART.inside);
        // Clipped box hedges at the path's mouth.
        for (const x of [mid - 22, mid + 16]) bush(p, x + 3, H - 12, 5);
      },
    ],
    (g) => {
      g.rect(2, 2, W - 4, H - 6, style.lawn);
      for (let x = 4; x < W - 6; x += 7)
        g.rect(x, 6 + ((x * 5) % 11) * 4, 2, 2, townShade(style.lawn, -0.1));
      g.rect(2, H - 6, W - 4, 3, townShade(style.lawn, -0.3));
      paving(g, mid - 12, 0, 24, H - 4, style.path, { w: 12, h: 6 });
    },
  );
}

/* ---------- the warehouse ---------- */

/** Crates stacked inside an open door. */
function crates(p: ArtPaint, x: number, foot: number, w: number) {
  const tones = ["#c9925c", "#b07a47", "#d6a46b"] as const;
  for (let i = 0, xx = x + 2; xx + 12 <= x + w - 2; i += 1, xx += 13) {
    face(p, xx, foot - 12, 12, 12, tones[i % 3]!);
    p.rect(xx + 2, foot - 7, 8, 1, townShade(tones[i % 3]!, -0.3));
    if (i % 2 === 0) face(p, xx + 2, foot - 22, 10, 10, tones[(i + 1) % 3]!);
  }
}

export function artWarehouseHouse(style: ArtStyle, W: number, H: number) {
  const b = style.warehouse;
  const mid = Math.round(W / 2);
  const foot = H - 6;
  const gabled = style.roof === "gable";
  const eave = gabled ? 44 : 38;
  const bay = 60;
  return compose(
    style,
    W,
    H,
    [[8, H - 7, W - 12, 7]],
    [
      (p) => {
        if (!gabled) roof(p, style, b, 4, 6, W - 8, eave - 4);
        else hipRoof(p, 4, 30, W - 8, 16, b.roof, b.tiles, 3);
      },
      (p) => {
        walls(p, style, b, 10, eave, W - 20, foot);
        if (gabled) frontGable(p, style, b, mid, 4, eave + 2, 80);
        else frontGable(p, style, b, mid, 14, eave + 2, 30);
      },
      (p) => {
        // The loft door and the hoist beam over it, its rope and hook.
        const loft = gabled ? 18 : 24;
        face(p, mid - 9, loft, 18, 18, b.door);
        p.rect(mid - 1, loft, 2, 18, townShade(b.door, -0.35));
        p.rect(mid - 2, loft - 6, 22, 3, ART.woodDark);
        p.rect(mid + 16, loft - 3, 1, 14, ART.paper);
        p.rect(mid + 15, loft + 11, 3, 3, ART.iron);
        // The loading door, open on lit crates, its leaves swung out.
        const top = eave + 10;
        p.rect(mid - bay / 2, top, bay, foot - top, ART.inside);
        p.rect(mid - bay / 2, top, bay, 4, townShade(ART.inside, 0.2));
        p.rect(mid - bay / 2 + 2, top + 4, bay - 4, foot - top - 4, "#5a4a3c");
        p.rect(
          mid - bay / 2 + 2,
          top + 4,
          bay - 4,
          6,
          townShade(ART.glass, -0.3),
        );
        crates(p, mid - bay / 2, foot, bay);
        for (const x of [mid - bay / 2 - 14, mid + bay / 2 + 2]) {
          face(p, x, top, 12, foot - top, b.door);
          if (style.barnX) {
            for (let i = 0; i < foot - top; i += 1)
              p.rect(
                x + Math.round((i * 11) / (foot - top)),
                top + i,
                2,
                1,
                b.trim,
              );
            p.rect(x, top, 12, 2, b.trim);
            p.rect(x, foot - 2, 12, 2, b.trim);
          }
        }
        face(p, mid - bay / 2 - 2, top - 4, bay + 4, 4, b.trim, { under: 0 });
        // High lit windows either side.
        for (const x of [22, W - 44])
          window(p, style, b, x, eave + 10, 22, 16, {});
        // Barrels left of the door, a life ring right.
        for (const x of [20, 34]) {
          face(p, x, foot - 14, 12, 14, ART.wood);
          p.rect(x, foot - 11, 12, 2, ART.iron);
          p.rect(x, foot - 5, 12, 2, ART.iron);
        }
        p.disc(W - 30, eave + 40, 6, "#e04a3a");
        p.disc(W - 30, eave + 40, 3, b.wall);
        p.rect(W - 36, eave + 39, 3, 2, ART.paper);
        p.rect(W - 27, eave + 39, 3, 2, ART.paper);
        lantern(p, W - 52, eave + 30);
      },
    ],
  );
}

export function artWarehouseYard(style: ArtStyle, W: number, H: number) {
  return compose(
    style,
    W,
    H,
    [],
    [
      (p) => {
        // The hand cart at the right end, its handle up.
        const cx = W - 34;
        face(p, cx, 16, 24, 13, ART.wood);
        for (let x = cx + 5; x < cx + 24; x += 6)
          p.rect(x, 18, 1, 9, ART.woodDark);
        p.rect(cx + 23, 6, 2, 12, ART.iron);
        p.rect(cx + 22, 5, 6, 2, ART.iron);
        for (const x of [cx + 4, cx + 18]) {
          p.disc(x, 33, 5, ART.woodDark);
          p.disc(x, 33, 1, ART.ironLight);
        }
        // A mooring bollard at the corner.
        face(p, W - 10, H - 15, 6, 7, ART.iron);
      },
    ],
    (g) => {
      g.rect(3, 4, W - 3, H - 4, "rgba(0,0,0,.16)");
      paving(g, 1, 1, W - 4, H - 4, style.setts);
      g.rect(2, H - 7, W - 6, 2, "#e3c35a");
      for (let x = 6; x < W - 6; x += 12) g.rect(x, H - 7, 6, 2, "#c9a63c");
    },
  );
}

/* ---------- the apartments ---------- */

export function artApartments(style: ArtStyle, W: number, H: number) {
  const b = style.apartments;
  const mid = Math.round(W / 2);
  const foot = H - 6;
  const gabled = style.roof === "gable";
  const eave = gabled ? 26 : 20;
  const floors = [eave + 6, eave + 28] as const;
  const columns = [16, mid - 10, W - 36] as const;
  return compose(
    style,
    W,
    H,
    [[6, H - 6, W - 8, 6]],
    [
      (p) => {
        if (!gabled) {
          face(p, W - 34, 0, 16, 10, ART.woodDark);
          p.rect(W - 32, 8, 2, 4, ART.iron);
          roof(p, style, b, 4, 4, W - 8, eave - 4);
        } else hipRoof(p, 4, 14, W - 8, 14, b.roof, b.tiles, 3);
      },
      (p) => {
        walls(p, style, b, 8, eave, W - 16, foot);
        if (gabled) {
          // Twin townhouses, a gable each.
          frontGable(p, style, b, 36, 2, eave + 4, 30);
          frontGable(p, style, b, W - 36, 2, eave + 4, 30);
        }
        face(p, 8, eave + 23, W - 16, 3, b.trim, { right: 0 });
        face(p, 8, eave + 45, W - 16, 3, b.trim, { right: 0 });
      },
      (p) => {
        for (const y of floors)
          for (const x of columns) {
            window(p, style, b, x, y, 20, 14, { arch: false });
            if (style.flowers && y === floors[1])
              flowers(p, x, y + 16, 20, b.accent);
          }
        // The door under a canopy, letterboxes beside it.
        const top = eave + 50;
        face(p, mid - 14, top, 28, 4, b.accent, { under: -0.3 });
        door(p, mid, foot, 16, foot - top - 6, b.door, b.frame ?? b.trim, {});
        for (const x of [16, W - 36])
          window(p, style, b, x, top + 4, 20, 12, { arch: false });
        for (let i = 0; i < 3; i += 1)
          face(p, mid + 12, top + 10 + i * 5, 6, 4, ART.ironLight);
        steps(p, mid, H - 2, 18, style.plinth, 1);
      },
    ],
  );
}

/* ---------- the town center ---------- */

/** A clock face: a gold rim, a cream dial, hands at ten past ten. */
function clock(p: ArtPaint, cx: number, cy: number, r: number) {
  p.disc(cx, cy, r, ART.gold);
  p.disc(cx, cy, r - 2, ART.paper);
  p.rect(cx - 1, cy - r + 3, 2, r - 3, ART.ink);
  p.rect(cx, cy - 1, r - 3, 2, ART.ink);
  p.rect(cx - 1, cy - 1, 2, 2, townShade(ART.gold, -0.4));
}

/** A banner on a pole. */
function banner(p: ArtPaint, x: number, y: number, color: string) {
  p.rect(x, y, 2, 30, ART.iron);
  face(p, x + 2, y + 2, 10, 18, color, { under: 0 });
  p.rect(x + 2, y + 20, 5, 3, color);
  p.rect(x + 7, y + 20, 5, 2, color);
  p.rect(x + 5, y + 8, 4, 4, ART.gold);
}

export function artCenter(style: ArtStyle, W: number, H: number) {
  const b = style.center;
  const wing = style.centerWing;
  const mid = Math.round(W / 2);
  const front = TOWN_CENTER_FRIEZE_Y - 5; // the plaque hangs on this band
  const plinth = 200;
  const block = W >= 500 ? 168 : 144;
  const bx0 = mid - block / 2;
  const pavilion = W >= 500 ? 44 : 32;
  const gabled = style.roof === "gable";
  const columns = 6;
  return compose(
    style,
    W,
    H,
    [[14, plinth - 4, W - 20, 12]],
    [
      // Wings and their end pavilions.
      (p) => {
        roof(p, style, wing, 6, 104, W - 12, 34);
        walls(p, style, wing, 10, 136, W - 20, plinth);
        for (const x of [4, W - 4 - pavilion]) {
          if (gabled) {
            hipRoof(p, x, 88, pavilion, 14, wing.roof, wing.tiles, 3);
            walls(p, style, wing, x + 2, 100, pavilion - 4, plinth);
            frontGable(p, style, wing, x + pavilion / 2, 72, 104, pavilion / 2);
          } else {
            roof(p, style, wing, x, 86, pavilion, 26);
            walls(p, style, wing, x + 2, 110, pavilion - 4, plinth);
          }
        }
      },
      (p) => {
        // The wings' windows, two storeys.
        for (const x0 of [12, mid + block / 2 + 6]) {
          const x1 = x0 === 12 ? bx0 - 6 : W - 12;
          for (let x = x0 + pavilion + 2; x + 16 <= x1 - 4; x += 26) {
            window(p, style, wing, x, 146, 14, 18, {});
            window(p, style, wing, x, 172, 14, 18, {});
          }
        }
        for (const x of [4, W - 4 - pavilion]) {
          window(p, style, wing, x + pavilion / 2 - 8, 120, 16, 22, {
            arch: true,
          });
          door(
            p,
            x + pavilion / 2,
            plinth,
            12,
            24,
            wing.door,
            wing.frame ?? wing.trim,
            {},
          );
        }
      },
      // The tower behind the central block.
      (p) => {
        const tw = 56;
        const tx = mid - tw / 2;
        if (gabled) {
          // A white tower under a tall black spire.
          for (let r = 0; r < 44; r += 1) {
            const half = Math.round((r / 44) * (tw / 2 - 4));
            p.rect(
              mid - half,
              4 + r,
              half * 2,
              1,
              townShade(b.roof, r < 2 ? 0.25 : 0),
            );
            p.rect(mid + half - 2, 4 + r, 2, 1, townShade(b.roof, -0.3));
          }
          p.rect(mid - 1, 0, 2, 6, ART.gold);
          face(p, tx + 4, 48, tw - 8, 64, b.gable ?? b.wall);
        } else {
          hipRoof(p, tx - 2, 6, tw + 4, 26, style.towerCap, "slate", 24);
          p.rect(mid - 1, 0, 2, 8, ART.gold);
          face(p, tx, 30, tw, 80, b.gable ?? b.wall);
          face(p, tx - 2, 30, tw + 4, 4, b.trim, { right: 0 });
        }
        clock(p, mid, gabled ? 70 : 54, 12);
        lit(p, mid - 6, gabled ? 88 : 74, 12, 16, b.frame ?? b.trim, {
          arch: true,
          sill: false,
        });
      },
      // The central block: roof, frieze band, portico and doors.
      (p) => {
        roof(p, style, b, bx0 - 6, 96, block + 12, front - 92);
        if (gabled) frontGable(p, style, b, mid, 84, front + 2, block / 2 - 10);
        walls(p, style, b, bx0, front, block, plinth);
        // The frieze: a plain band for the town's name plaque.
        face(p, bx0 - 4, front, block + 8, 12, b.trim, { right: -0.1 });
        // Columns, the doors between them lit from inside.
        const span = (block - 24) / (columns - 1);
        p.rect(
          bx0 + 8,
          front + 12,
          block - 16,
          plinth - front - 12,
          townShade(b.wall, -0.32),
        );
        door(p, mid, plinth, 24, 34, b.door, b.frame ?? b.trim, {
          double: true,
          arch: style.arches,
          fanlight: style.arches,
        });
        for (const x of [mid - span * 1.5, mid + span * 1.5])
          lit(p, x - 7, front + 20, 14, 22, b.frame ?? b.trim, {
            arch: style.arches,
          });
        for (let i = 0; i < columns; i += 1) {
          const x = bx0 + 12 + i * span;
          face(p, x - 4, front + 14, 8, plinth - front - 14, style.column, {
            top: 0.1,
          });
          face(p, x - 6, front + 12, 12, 3, style.column, {
            right: 0,
            under: 0,
          });
          face(p, x - 6, plinth - 3, 12, 3, style.column, {
            right: 0,
            under: 0,
          });
        }
        banner(p, bx0 - 18, front + 6, style.banner);
        banner(p, bx0 + block + 6, front + 6, style.banner);
        lantern(p, bx0 + 4, front + 26);
        lantern(p, bx0 + block - 8, front + 26);
      },
      // Wide steps down to the forecourt; potted bushes at their ends.
      (p) => {
        for (let i = 0; i < 4; i += 1) {
          const sw = block - 20 + i * 12;
          face(p, mid - sw / 2, plinth + 4 + i * 6, sw, 6, style.plinth, {
            right: 0,
            under: -0.2,
          });
        }
        for (const x of [mid - block / 2 - 4, mid + block / 2 + 4]) {
          face(
            p,
            x - 6,
            plinth + 14,
            12,
            10,
            style.post.chimney ?? style.plinth,
          );
          bush(p, x, plinth + 10, 7, style.banner);
        }
      },
    ],
  );
}

/* ---------- the harbour ---------- */

/** The pier in the style's timber; the plan is the default pier's. */
export function artPier(
  style: ArtStyle,
  w: number,
  slipway: { x: number; w: number },
  bollards: readonly number[],
) {
  const p = artPainter(w, TOWN_PIER_ART.h);
  const top = TOWN_PIER_ART.deck;
  const deck = 12;
  const head = { x: w - 44, w: 44 };
  const draw: Layer[] = [
    (q) => {
      q.rect(2, top + deck + 2, w - 2, 5, "rgba(20,40,70,.35)");
      for (let x = 6; x < w - 4; x += 24)
        face(q, x, top + deck, 4, 7, style.piling, { top: 0 });
      face(q, head.x, top - 6, head.w, deck + 12, style.deck);
      for (let x = head.x + 3; x < w - 2; x += 5)
        q.rect(x, top - 4, 1, deck + 8, townShade(style.deck, -0.18));
      face(q, 0, top, head.x + 1, deck, style.deck);
      for (let x = 3; x < head.x; x += 4)
        q.rect(x, top + 2, 1, deck - 4, townShade(style.deck, -0.18));
    },
    (q) => {
      face(q, slipway.x, top, slipway.w, deck, style.plinth, { right: 0 });
      q.rect(slipway.x, top + 3, slipway.w, 1, ART.iron);
      q.rect(slipway.x, top + 8, slipway.w, 1, ART.iron);
      for (const [i, x] of bollards.entries()) {
        face(q, x - 2, top - 2, 5, 5, ART.iron, {
          top: 0.3,
          right: 0,
          under: 0,
        });
        if (!i) {
          q.disc(x + 8, top + 5, 3, "#c9a46a");
          q.disc(x + 8, top + 5, 1, "#7a5a32");
        }
      }
    },
  ];
  if (style.finish === "card")
    for (const layer of draw) card(p, layer, style.rim);
  else for (const layer of draw) layer(p);
  return artFinish(artPainter(w, TOWN_PIER_ART.h), p);
}

/** The lighthouse in the style's colours; its lamp room is unchanged. */
export function artLighthouse(style: ArtStyle) {
  const { w: W, h: H, lamp } = TOWN_LIGHTHOUSE;
  const base = artPainter(W, H);
  base.rect(1, H - 4, 18, 3, ART.shadow);
  const p = artPainter(W, H);
  const foot = H - 2;
  const tower = 11;
  const [light, band] = style.lighthouse;
  for (let y = tower; y < foot; y += 1) {
    const half = 5 + Math.round(((y - tower) / (foot - tower)) * 3);
    const fill = Math.floor((y - tower) / 4) % 2 ? band : light;
    p.rect(10 - half, y, half * 2, 1, fill);
    p.rect(10 - half, y, 2, 1, townShade(fill, 0.2));
    p.rect(10 + half - 3, y, 3, 1, townShade(fill, -0.22));
  }
  p.rect(8, foot - 6, 4, 6, ART.woodDark);
  p.rect(2, 9, 16, 2, ART.iron);
  p.rect(lamp.x - 1, lamp.y - 1, lamp.w + 2, lamp.h + 1, ART.iron);
  p.rect(lamp.x, lamp.y, lamp.w, lamp.h, "#2b2f3a");
  for (let i = 0; i < 3; i += 1) p.rect(4 + i * 2, 2 - i, 12 - i * 4, 1, band);
  return artFinish(base, p);
}

/* ---------- the switch ---------- */

const painted = new Map<string, TownCanvas>();

/**
 * The landmark `key` in the page's art direction, painted once per
 * direction; null when the page shows today's art.
 */
export function townArtLandmark(
  key: string,
  draw: (style: ArtStyle) => TownCanvas,
): TownCanvas | null {
  const direction = townArtDirection();
  if (!direction) return null;
  const id = `${direction}:${key}`;
  let canvas = painted.get(id);
  if (!canvas) {
    canvas = draw(TOWN_ART_STYLES[direction]);
    painted.set(id, canvas);
  }
  return canvas;
}
