/**
 * Moving a building to another lot. Buildings stand on the town's lots in
 * order (townPlaceLots), so a move is a new order: the building takes the
 * lot it is dropped nearest, and the buildings between shift one lot along,
 * with the streets, roads and bus stops laid out for the new order. The
 * order is saved with Board's layout (townBuildingPins.ts).
 */

import { townPlaceLots } from "./townLots";
import type { OfficeHost } from "../herdrOfficeProjection";
import { TOWN_FACADE, type TownInput, type TownLayout } from "./townLayout";

/** A building's lot, in tiles. */
export type TownLot = { x: number; y: number; w: number; h: number };

/** Where every building would stand with the moved one at `index`. */
export type TownBuildingPlacement = {
  hostKey: string;
  /** The moved building's place in the order. */
  index: number;
  /** The buildings' host keys in their new order. */
  order: readonly string[];
  /** Each building's lot (top-left of its floor, its floor and façade). */
  lots: ReadonlyMap<string, TownLot>;
  /** False when the building stays on its own lot. */
  changed: boolean;
};

/** The buildings' host keys in the order they stand. */
export const townBuildingOrder = (layout: TownLayout): string[] =>
  layout.buildings.map((b) => b.hostKey);

/** `order` with `key` taken out and put back at `index`. */
function moved(order: readonly string[], key: string, index: number) {
  const rest = order.filter((other) => other !== key);
  rest.splice(index, 0, key);
  return rest;
}

/** The building's lot with its façade, as drawn below its floor. */
const lotOf = (lot: { x: number; y: number; w: number; h: number }) => ({
  x: lot.x,
  y: lot.y,
  w: lot.w,
  h: lot.h + TOWN_FACADE,
});

/**
 * Every lot the building could take, in order: for each place in the
 * order, where every building would stand. The floors keep their own
 * heights; a lot grows toward its street as its row needs (townPlaceLots).
 */
export function townBuildingPlacements(
  layout: TownLayout,
  hostKey: string,
): TownBuildingPlacement[] {
  const order = townBuildingOrder(layout);
  const from = order.indexOf(hostKey);
  if (from < 0) return [];
  const floors = new Map(
    layout.buildings.map((b) => [b.hostKey, { w: b.w, h: b.floorH }]),
  );
  return order.map((_, index) => {
    const next = moved(order, hostKey, index);
    const placed = townPlaceLots(
      next.map((key) => floors.get(key)!),
      layout.shape,
      layout.perStreet,
    ).buildings;
    return {
      hostKey,
      index,
      order: next,
      lots: new Map(next.map((key, at) => [key, lotOf(placed[at]!)])),
      changed: index !== from,
    };
  });
}

/**
 * The placement whose lot for the moved building is nearest tile point
 * (x, y), the centre of where it is carried. On its own lot nothing moves.
 */
export function townBuildingPlacementAt(
  placements: readonly TownBuildingPlacement[],
  x: number,
  y: number,
): TownBuildingPlacement | null {
  let best: TownBuildingPlacement | null = null;
  let bestDistance = Infinity;
  for (const placement of placements) {
    const lot = placement.lots.get(placement.hostKey)!;
    const distance = Math.hypot(lot.x + lot.w / 2 - x, lot.y + lot.h / 2 - y);
    if (distance < bestDistance) {
      best = placement;
      bestDistance = distance;
    }
  }
  return best;
}

/** The building just before (-1) or after (1) this one, or null. */
export function townBuildingNeighbor(
  layout: TownLayout,
  hostKey: string,
  step: -1 | 1,
): string | null {
  const order = townBuildingOrder(layout);
  const at = order.indexOf(hostKey);
  return at < 0 ? null : (order[at + step] ?? null);
}

/** The order with the building swapped with its neighbour, or null. */
export function townBuildingSwap(
  layout: TownLayout,
  hostKey: string,
  step: -1 | 1,
): readonly string[] | null {
  const order = townBuildingOrder(layout);
  const at = order.indexOf(hostKey);
  if (at < 0 || !order[at + step]) return null;
  return moved(order, hostKey, at + step);
}

/**
 * Whether the buildings both layouts show stand in a different order: a
 * building was moved, so the change is the user's, not a reflow.
 */
export function townBuildingsReordered(
  previous: TownLayout,
  next: TownLayout,
): boolean {
  const now = new Set(townBuildingOrder(next));
  const was = townBuildingOrder(previous).filter((key) => now.has(key));
  const shared = new Set(was);
  const is = townBuildingOrder(next).filter((key) => shared.has(key));
  return was.some((key, index) => key !== is[index]);
}

/**
 * Where the buildings were placed (Board's layout): each one's rank in the
 * town's reading order by connection ID (`building_pins`), and the lots per
 * street of a wide town (`building_columns`), saved with the first move.
 */
export type BuildingPins = Readonly<{
  ranks: Readonly<Record<string, number>>;
  perStreet?: number;
}>;

export const NO_BUILDING_PINS: BuildingPins = Object.freeze({
  ranks: Object.freeze({}),
});

/**
 * The town's hosts in their saved order: ranked hosts first by rank, then
 * the others in host order, on the saved lots per street. Without a saved
 * placement the input is unchanged.
 */
export function townOrderHosts(
  input: TownInput,
  hosts: ReadonlyMap<string, Pick<OfficeHost, "connectionId">>,
  pins: BuildingPins,
): TownInput {
  const { ranks, perStreet } = pins;
  if (!Object.keys(ranks).length && perStreet === undefined) return input;
  const rank = (key: string) => {
    const id = hosts.get(key)?.connectionId;
    return id === undefined ? undefined : ranks[id];
  };
  const sorted = [...input.hosts].sort((a, b) => {
    const ra = rank(a.key);
    const rb = rank(b.key);
    if (ra !== undefined && rb !== undefined && ra !== rb) return ra - rb;
    if (ra !== undefined && rb === undefined) return -1;
    if (ra === undefined && rb !== undefined) return 1;
    return a.displayOrder - b.displayOrder || a.key.localeCompare(b.key);
  });
  return {
    ...input,
    hosts: sorted.map((host, displayOrder) => ({
      key: host.key,
      displayOrder,
    })),
    ...(perStreet === undefined ? {} : { perStreet }),
  };
}
