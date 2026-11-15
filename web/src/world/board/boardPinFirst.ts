import type { Point, Rect, Size } from "./boardPlacement";

/**
 * Pinned goes first on Board (as in Herdr's labels guide): a workspace's
 * pinned tab cards take its first places, a shelf directly above the
 * workspace card, in tab order, under one tinted band (the group cue). The
 * shelf is derived, never saved: it follows its workspace card, a pinned card
 * dragged away glides back, and an unpinned card takes free space around its
 * workspace like a new one. A pinned workspace card still keeps its absolute
 * place (boardPlacement.ts).
 */

/** Pinned cards per shelf row; more pins add rows above. */
export const SHELF_COLUMNS = 3;
const GAP = 16;
/** The band's margin around its pinned cards. */
export const SHELF_BAND_PAD = 10;

/** A workspace's pinned tab cards, in its tab order. */
export function shelfKeys(
  tabKeys: readonly string[],
  pinned: { has(key: string): boolean },
): string[] {
  return tabKeys.filter((key) => pinned.has(key));
}

/**
 * Each pinned card's offset from its workspace card's centre: rows of up to
 * SHELF_COLUMNS, centred, read left to right and top to bottom, the last row
 * just above the workspace card.
 */
export function shelfOffsets(
  keys: readonly string[],
  workspace: Size,
  sizeOf: (key: string) => Size,
): Map<string, Point> {
  const out = new Map<string, Point>();
  if (!keys.length) return out;
  const rows: string[][] = [];
  for (let i = 0; i < keys.length; i += SHELF_COLUMNS)
    rows.push(keys.slice(i, i + SHELF_COLUMNS));
  // From the workspace card up: the last row first.
  let bottom = -workspace.h / 2 - 2 * GAP;
  for (let r = rows.length - 1; r >= 0; r--) {
    const row = rows[r]!;
    const sizes = row.map(sizeOf);
    const height = Math.max(...sizes.map((size) => size.h));
    const width =
      sizes.reduce((sum, size) => sum + size.w, 0) + (row.length - 1) * 2 * GAP;
    let left = -width / 2;
    const y = bottom - height / 2;
    row.forEach((key, i) => {
      const size = sizes[i]!;
      out.set(key, { x: left + size.w / 2, y });
      left += size.w + 2 * GAP;
    });
    bottom -= height + 2 * GAP;
  }
  return out;
}

/** The band behind a shelf's cards, from their centres and sizes. */
export function shelfBand(
  cards: readonly { at: Point; size: Size }[],
): Rect | null {
  if (!cards.length) return null;
  const band = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const { at, size } of cards) {
    band.x0 = Math.min(band.x0, at.x - size.w / 2 - SHELF_BAND_PAD);
    band.y0 = Math.min(band.y0, at.y - size.h / 2 - SHELF_BAND_PAD);
    band.x1 = Math.max(band.x1, at.x + size.w / 2 + SHELF_BAND_PAD);
    band.y1 = Math.max(band.y1, at.y + size.h / 2 + SHELF_BAND_PAD);
  }
  return band;
}

/**
 * Board's pin bands, one element per workspace with pinned cards, kept in
 * `layer` and placed in board space each frame.
 */
export function paintShelfBands(
  layer: HTMLElement,
  bands: ReadonlyMap<string, Rect>,
  els: Map<string, HTMLElement>,
) {
  for (const [key, el] of els)
    if (!bands.has(key)) {
      el.remove();
      els.delete(key);
    }
  for (const [key, band] of bands) {
    let el = els.get(key);
    if (!el) {
      el = document.createElement("div");
      el.className = "board-pin-band";
      el.setAttribute("aria-hidden", "true");
      layer.appendChild(el);
      els.set(key, el);
    }
    const style = `translate(${band.x0}px, ${band.y0}px)`;
    if (el.style.transform !== style) el.style.transform = style;
    const w = `${band.x1 - band.x0}px`;
    const h = `${band.y1 - band.y0}px`;
    if (el.style.width !== w) el.style.width = w;
    if (el.style.height !== h) el.style.height = h;
  }
}
