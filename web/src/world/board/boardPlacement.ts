import type { BoardModel } from "./boardModel";

/**
 * Where Board's cards sit. A workspace keeps an offset from its host's anchor
 * and a tab an offset from its workspace, so moving a workspace carries its
 * tabs. A pinned card holds an absolute board position instead. Placement is
 * pure and never depends on zoom: it uses each card's normal size.
 */

export type Point = { x: number; y: number };
export type Size = { w: number; h: number };
export type Rect = { x0: number; y0: number; x1: number; y1: number };

export type BoardLayout = {
  anchors: Map<string, Point>;
  offsets: Map<string, Point>;
  pinned: Map<string, Point>;
};

export const emptyLayout = (): BoardLayout => ({
  anchors: new Map(),
  offsets: new Map(),
  pinned: new Map(),
});

export function cloneLayout(layout: BoardLayout): BoardLayout {
  return {
    anchors: new Map(layout.anchors),
    offsets: new Map(layout.offsets),
    pinned: new Map(layout.pinned),
  };
}

export const DEFAULT_SIZE: Readonly<Record<"workspace" | "tab", Size>> = {
  workspace: { w: 236, h: 84 },
  tab: { w: 210, h: 66 },
};
const GAP = 16;
const GRID_COLS = 2;
const RING = { first: 150, step: 80, wide: 1.25, tall: 0.78 };

/**
 * A host's grid cell, sized for its busiest workspace so every workspace's
 * tabs fit around it without reaching the next workspace.
 */
function cellFor(model: BoardModel, hostKey: string): Point {
  const host = model.hostByKey.get(hostKey);
  let most = 0;
  for (const key of host?.workspaceKeys ?? [])
    most = Math.max(most, model.workspaceByKey.get(key)?.tabKeys.length ?? 0);
  const r = RING.first + RING.step * Math.max(0, Math.ceil((most - 5) / 7));
  const tab = DEFAULT_SIZE.tab;
  return {
    x: Math.max(640, Math.round(2 * (r * RING.wide + tab.w / 2) + 3 * GAP)),
    y: Math.max(480, Math.round(2 * (r * RING.tall + tab.h / 2) + 3 * GAP)),
  };
}
const HOST_GAP = 220;

export const rectAt = (size: Size, at: Point): Rect => ({
  x0: at.x - size.w / 2,
  y0: at.y - size.h / 2,
  x1: at.x + size.w / 2,
  y1: at.y + size.h / 2,
});
export const overlaps = (a: Rect, b: Rect, margin = GAP) =>
  a.x0 < b.x1 + margin &&
  a.x1 > b.x0 - margin &&
  a.y0 < b.y1 + margin &&
  a.y1 > b.y0 - margin;

/**
 * Free spots on rings around a centre, wider than tall because cards are wide.
 * Angles are visited in a spread order so a few cards end up evenly around;
 * each item takes the first spot that clears every taken rectangle.
 */
export function freeSpots(
  center: Point,
  items: readonly { key: string; size: Size }[],
  taken: Rect[],
  firstRing = RING.first,
): Map<string, Point> {
  const occupied = taken.slice();
  const spots = new Map<string, Point>();
  for (const item of items) {
    let spot: Point | null = null;
    for (let ring = 0; ring < 48 && !spot; ring++) {
      const r = firstRing + ring * RING.step;
      const steps = Math.max(
        6,
        Math.floor((2 * Math.PI * Math.max(r, 60)) / 140),
      );
      const seen = new Set<number>();
      for (let i = 0; i < steps && !spot; i++) {
        const k = Math.round(i * steps * 0.618) % steps;
        if (seen.has(k)) continue;
        seen.add(k);
        const angle = -Math.PI / 2 + (k * 2 * Math.PI) / steps;
        const at = {
          x: center.x + Math.cos(angle) * r * RING.wide,
          y: center.y + Math.sin(angle) * r * RING.tall,
        };
        if (!occupied.some((rect) => overlaps(rectAt(item.size, at), rect)))
          spot = at;
      }
    }
    // Past every ring: go straight down until clear.
    for (let y = center.y; !spot; y += item.size.h + GAP) {
      const at = { x: center.x, y };
      if (!occupied.some((rect) => overlaps(rectAt(item.size, at), rect)))
        spot = at;
    }
    spots.set(item.key, spot);
    occupied.push(rectAt(item.size, spot));
  }
  return spots;
}

export type SizeOf = (key: string, kind: "workspace" | "tab") => Size;
const defaultSizeOf: SizeOf = (_key, kind) => DEFAULT_SIZE[kind];

/** Absolute positions of every card the model admits. */
export function positions(model: BoardModel, layout: BoardLayout) {
  const out = new Map<string, Point>();
  for (const host of model.hosts) {
    const anchor = layout.anchors.get(host.key) ?? { x: 0, y: 0 };
    for (const workspaceKey of host.workspaceKeys) {
      const space = model.workspaceByKey.get(workspaceKey);
      if (!space) continue;
      const offset = layout.offsets.get(workspaceKey) ?? { x: 0, y: 0 };
      const at = layout.pinned.get(workspaceKey) ?? {
        x: anchor.x + offset.x,
        y: anchor.y + offset.y,
      };
      out.set(workspaceKey, at);
      for (const tabKey of space.tabKeys) {
        const tabOffset = layout.offsets.get(tabKey) ?? { x: 0, y: 0 };
        out.set(
          tabKey,
          layout.pinned.get(tabKey) ?? {
            x: at.x + tabOffset.x,
            y: at.y + tabOffset.y,
          },
        );
      }
    }
  }
  return out;
}

/**
 * Keep every card that already has a place and give new cards free space:
 * new hosts beside (desktop) or below (phone) the others, new workspaces in
 * the next free grid cell of their host, new tabs in free space around their
 * workspace. Existing cards never move. Entries for cards the model no longer
 * admits are kept; the caller prunes them only on authoritative absence.
 */
export function placeNew(
  model: BoardModel,
  previous: BoardLayout,
  options: { phone?: boolean; sizeOf?: SizeOf } = {},
): BoardLayout {
  const sizeOf = options.sizeOf ?? defaultSizeOf;
  const layout = cloneLayout(previous);
  let cursor = 0;
  for (const host of model.hosts) {
    if (layout.anchors.has(host.key)) continue;
    const extent = hostExtent(model, layout, sizeOf, options.phone ?? false);
    cursor = Math.max(cursor, extent);
    layout.anchors.set(
      host.key,
      options.phone ? { x: 0, y: cursor } : { x: cursor, y: 0 },
    );
    const cell = cellFor(model, host.key);
    const rows = Math.max(1, Math.ceil(host.workspaceKeys.length / GRID_COLS));
    cursor += options.phone
      ? rows * cell.y + HOST_GAP
      : GRID_COLS * cell.x + HOST_GAP;
  }
  for (const host of model.hosts) {
    const cell = cellFor(model, host.key);
    const used = new Set<string>();
    for (const key of host.workspaceKeys) {
      const offset = layout.offsets.get(key);
      if (offset)
        used.add(
          `${Math.round(offset.x / cell.x)},${Math.round(offset.y / cell.y)}`,
        );
    }
    for (const key of host.workspaceKeys) {
      if (layout.offsets.has(key) || layout.pinned.has(key)) continue;
      for (let index = 0; ; index++) {
        const col = index % GRID_COLS,
          row = Math.floor(index / GRID_COLS);
        if (used.has(`${col},${row}`)) continue;
        used.add(`${col},${row}`);
        layout.offsets.set(key, { x: col * cell.x, y: row * cell.y });
        break;
      }
    }
  }
  const at = positions(model, layout);
  const taken: Rect[] = [];
  for (const [key, point] of at) {
    const placed = layout.offsets.has(key) || layout.pinned.has(key);
    if (!placed) continue;
    taken.push(
      rectAt(
        sizeOf(key, model.workspaceByKey.has(key) ? "workspace" : "tab"),
        point,
      ),
    );
  }
  for (const space of model.workspaces) {
    const center = at.get(space.key);
    if (!center) continue;
    const fresh = space.tabKeys
      .filter((key) => !layout.offsets.has(key) && !layout.pinned.has(key))
      .map((key) => ({ key, size: sizeOf(key, "tab") }));
    if (!fresh.length) continue;
    const spots = freeSpots(center, fresh, taken);
    for (const { key, size } of fresh) {
      const spot = spots.get(key)!;
      layout.offsets.set(key, { x: spot.x - center.x, y: spot.y - center.y });
      taken.push(rectAt(size, spot));
    }
  }
  return layout;
}

function hostExtent(
  model: BoardModel,
  layout: BoardLayout,
  sizeOf: SizeOf,
  phone: boolean,
) {
  let extent = 0;
  let placedAny = false;
  const at = positions(model, layout);
  for (const host of model.hosts) {
    if (!layout.anchors.has(host.key)) continue;
    placedAny = true;
    for (const key of host.workspaceKeys) {
      const space = model.workspaceByKey.get(key);
      for (const cardKey of [key, ...(space?.tabKeys ?? [])]) {
        const point = at.get(cardKey);
        if (!point) continue;
        const size = sizeOf(cardKey, cardKey === key ? "workspace" : "tab");
        extent = Math.max(
          extent,
          phone ? point.y + size.h / 2 : point.x + size.w / 2,
        );
      }
    }
  }
  return placedAny ? extent + HOST_GAP : 0;
}

/**
 * Tidy one workspace's tabs (when `workspaceKey` is given) or the whole board.
 * Pinned cards stay where they are and are avoided. Returns a new layout; the
 * caller keeps the previous one for Undo.
 */
export function tidy(
  model: BoardModel,
  previous: BoardLayout,
  options: { workspaceKey?: string; phone?: boolean; sizeOf?: SizeOf } = {},
): BoardLayout {
  const sizeOf = options.sizeOf ?? defaultSizeOf;
  if (!options.workspaceKey)
    return tidyBoard(model, previous, sizeOf, options.phone ?? false);
  const space = model.workspaceByKey.get(options.workspaceKey);
  if (!space) return previous;
  const layout = cloneLayout(previous);
  for (const key of space.tabKeys)
    if (!layout.pinned.has(key)) layout.offsets.delete(key);
  const at = positions(model, layout);
  const center = at.get(space.key)!;
  const own = new Set(space.tabKeys.filter((key) => !layout.pinned.has(key)));
  const taken: Rect[] = [];
  for (const [key, point] of at) {
    if (own.has(key)) continue;
    taken.push(
      rectAt(
        sizeOf(key, model.workspaceByKey.has(key) ? "workspace" : "tab"),
        point,
      ),
    );
  }
  const items = [...own].map((key) => ({ key, size: sizeOf(key, "tab") }));
  const spots = freeSpots(center, items, taken);
  for (const { key } of items) {
    const spot = spots.get(key)!;
    layout.offsets.set(key, { x: spot.x - center.x, y: spot.y - center.y });
  }
  return layout;
}

/**
 * The whole board, rebuilt from measured sizes: each workspace's tabs are
 * laid out around it, the clusters are packed into columns and rows by their
 * real bounds, and each host starts past the previous host's real extent, so
 * no two cards overlap. Pinned cards keep their places and are avoided.
 */
function tidyBoard(
  model: BoardModel,
  previous: BoardLayout,
  sizeOf: SizeOf,
  phone: boolean,
): BoardLayout {
  const layout = emptyLayout();
  for (const [key, point] of previous.pinned) layout.pinned.set(key, point);
  const pinnedRects = [...layout.pinned].map(([key, point]) =>
    rectAt(
      sizeOf(key, model.workspaceByKey.has(key) ? "workspace" : "tab"),
      point,
    ),
  );
  let cursor = 0;
  for (const host of model.hosts) {
    // Each workspace's cluster, around its own origin.
    const clusters = host.workspaceKeys.flatMap((key) => {
      const space = model.workspaceByKey.get(key);
      if (!space || layout.pinned.has(key)) return [];
      const own = rectAt(sizeOf(key, "workspace"), { x: 0, y: 0 });
      const items = space.tabKeys
        .filter((tabKey) => !layout.pinned.has(tabKey))
        .map((tabKey) => ({ key: tabKey, size: sizeOf(tabKey, "tab") }));
      const spots = freeSpots({ x: 0, y: 0 }, items, [own]);
      const box = { ...own };
      for (const item of items) {
        const r = rectAt(item.size, spots.get(item.key)!);
        box.x0 = Math.min(box.x0, r.x0);
        box.y0 = Math.min(box.y0, r.y0);
        box.x1 = Math.max(box.x1, r.x1);
        box.y1 = Math.max(box.y1, r.y1);
      }
      return [{ key, spots, box }];
    });
    const cols = Math.min(GRID_COLS, Math.max(1, clusters.length));
    const widths = new Array<number>(cols).fill(0);
    const heights: number[] = [];
    clusters.forEach((cluster, i) => {
      const col = i % cols,
        row = Math.floor(i / cols);
      widths[col] = Math.max(widths[col]!, cluster.box.x1 - cluster.box.x0);
      heights[row] = Math.max(
        heights[row] ?? 0,
        cluster.box.y1 - cluster.box.y0,
      );
    });
    const anchor = phone ? { x: 0, y: cursor } : { x: cursor, y: 0 };
    layout.anchors.set(host.key, anchor);
    clusters.forEach((cluster, i) => {
      const col = i % cols,
        row = Math.floor(i / cols);
      let left = 0;
      for (let c = 0; c < col; c++) left += widths[c]! + 3 * GAP;
      let top = 0;
      for (let r = 0; r < row; r++) top += heights[r]! + 3 * GAP;
      const offset = { x: left - cluster.box.x0, y: top - cluster.box.y0 };
      layout.offsets.set(cluster.key, offset);
      for (const [tabKey, spot] of cluster.spots)
        layout.offsets.set(tabKey, spot);
    });
    let width = 0;
    for (const w of widths) width += w;
    width += Math.max(0, cols - 1) * 3 * GAP;
    let height = 0;
    for (const h of heights) height += h;
    height += Math.max(0, heights.length - 1) * 3 * GAP;
    cursor += (phone ? height : width) + HOST_GAP;
  }
  // Clusters that landed on a pinned card move clear of it, as one piece.
  if (pinnedRects.length) {
    const at = positions(model, layout);
    for (const space of model.workspaces) {
      if (layout.pinned.has(space.key)) continue;
      const keys = [
        space.key,
        ...space.tabKeys.filter((k) => !layout.pinned.has(k)),
      ];
      const hits = () =>
        keys.some((key) => {
          const point = at.get(key);
          if (!point) return false;
          const r = rectAt(
            sizeOf(key, key === space.key ? "workspace" : "tab"),
            point,
          );
          return pinnedRects.some((p) => overlaps(r, p));
        });
      for (let step = 0; step < 40 && hits(); step++) {
        const offset = layout.offsets.get(space.key)!;
        layout.offsets.set(space.key, { x: offset.x, y: offset.y + RING.step });
        for (const key of keys) {
          const point = at.get(key);
          if (point) at.set(key, { x: point.x, y: point.y + RING.step });
        }
      }
    }
  }
  return layout;
}

/**
 * Move each item to the nearest spot that clears every rectangle and the items
 * placed before it; an item already clear stays exactly where it is.
 */
export function clearSpots(
  items: readonly { key: string; size: Size; at: Point }[],
  taken: Rect[],
): Map<string, Point> {
  const occupied = taken.slice();
  const out = new Map<string, Point>();
  for (const item of items) {
    const spot = freeSpots(item.at, [item], occupied, 0).get(item.key)!;
    out.set(item.key, spot);
    occupied.push(rectAt(item.size, spot));
  }
  return out;
}
