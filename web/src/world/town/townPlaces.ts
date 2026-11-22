import { createContext, useContext, useEffect } from "react";
import { townApartmentsLot } from "./townApartmentsLot";
import { townHarbourLot } from "./townHarbour";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import { townLibraryLot } from "./townLibraryLot";
import { townObservatoryLot } from "./townObservatoryLot";
import { townPostLotBeside } from "./townPostLot";

/**
 * Town's places with a window (#1170): a press on the building itself, not
 * only on its sign, opens it. The town center keeps its own hit (its ring).
 */
export type TownPlaceKey =
  | "post"
  | "library"
  | "apartments"
  | "observatory"
  | "warehouse";

type Box = { x0: number; y0: number; x1: number; y1: number };

/** A tile of roof above a house's top row is still the building. */
const ROOF = T;

/**
 * Each place's building in world pixels: the house itself, never its yard,
 * whose letters, parcels and benches are their own targets. A narrow town
 * folds the library and observatory to signs, so they have no building.
 */
export function townPlaceBoxes(
  layout: TownLayout,
): readonly (readonly [TownPlaceKey, Box])[] {
  const boxes: [TownPlaceKey, Box][] = [];
  const house = (
    key: TownPlaceKey,
    lot: { x: number; y: number; w: number },
    bottom: number,
  ) =>
    boxes.push([
      key,
      {
        x0: lot.x * T,
        y0: lot.y * T - ROOF,
        x1: (lot.x + lot.w) * T,
        y1: bottom * T,
      },
    ]);
  const post = townPostLotBeside(layout.center);
  house("post", post, post.yardY);
  const library = townLibraryLot(layout);
  if (library) house("library", library, library.yardY);
  const observatory = townObservatoryLot(layout);
  if (observatory)
    house("observatory", observatory, observatory.y + observatory.h);
  const apartments = townApartmentsLot(layout);
  if (apartments) house("apartments", apartments, apartments.y + apartments.h);
  const warehouse = townHarbourLot(layout).warehouse;
  house("warehouse", warehouse, warehouse.yardY);
  return boxes;
}

/** The place whose building holds world point (x, y), if any. */
export function townPlaceAt(
  layout: TownLayout,
  x: number,
  y: number,
): TownPlaceKey | null {
  for (const [key, box] of townPlaceBoxes(layout))
    if (x >= box.x0 && x < box.x1 && y >= box.y0 && y < box.y1) return key;
  return null;
}

/**
 * What each place opens, registered by the place's own component with the
 * same action its sign takes, so the building and the sign never differ.
 * A place without an opener (a town drawn alone, a Library no host serves)
 * is not a target.
 */
export class TownPlaces {
  private readonly openers = new Map<TownPlaceKey, () => void>();
  private hovered: TownPlaceKey | null = null;

  register(key: TownPlaceKey, open: () => void) {
    this.openers.set(key, open);
    return () => {
      if (this.openers.get(key) === open) this.openers.delete(key);
    };
  }

  opens(key: TownPlaceKey) {
    return this.openers.has(key);
  }

  open(key: TownPlaceKey) {
    const open = this.openers.get(key);
    if (!open) return false;
    open();
    return true;
  }

  /** A mouse over a building lights its sign, as hovering the sign does. */
  hover(key: TownPlaceKey | null, root: ParentNode | null) {
    if (key === this.hovered) return;
    this.hovered = key;
    for (const sign of root?.querySelectorAll<HTMLElement>(
      "[data-town-place]",
    ) ?? [])
      sign.toggleAttribute(
        "data-place-hovered",
        sign.dataset.townPlace === key,
      );
  }
}

export const TownPlacesContext = createContext<TownPlaces | null>(null);

/**
 * Registers `open` (null: nothing to open now) as what pressing the place's
 * building does. Pass a stable callback, or the latest is registered each
 * render.
 */
export function useTownPlace(key: TownPlaceKey, open: (() => void) | null) {
  const places = useContext(TownPlacesContext);
  useEffect(
    () => (places && open ? places.register(key, open) : undefined),
    [places, key, open],
  );
}
