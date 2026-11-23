/**
 * The town center's **Buildings** (#1261): one first-ring entry that opens a
 * second ring of Town's places with a building. Choosing one opens what a
 * press on that building opens (townPlaces.ts, #1170), so the ring and the
 * building never differ. Counts stay on the buildings' own signs.
 */

import {
  Building2,
  Landmark,
  LibraryBig,
  Mail,
  Telescope,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import type { TownCenterAction } from "./TownCenterMenu";
import type { TownPlaceKey, TownPlaces } from "./townPlaces";

/** Every place with a building, in the second ring's order, clockwise. */
export const TOWN_CENTER_BUILDINGS: readonly {
  key: TownPlaceKey;
  label: string;
  icon: LucideIcon;
  /** What it opens, when its name does not say. */
  detail?: string;
}[] = [
  { key: "apartments", label: "Apartments", icon: Building2 },
  { key: "library", label: "Library", icon: LibraryBig },
  { key: "post", label: "Post office", icon: Mail, detail: "Needs you" },
  { key: "observatory", label: "Observatory", icon: Telescope },
  { key: "warehouse", label: "Warehouse", icon: Warehouse },
];

/**
 * The second ring: the places that open now (a Library no host serves, a
 * warehouse still reading GitHub open nothing, so they are left out).
 */
export function townCenterBuildings(
  places: Pick<TownPlaces, "opens" | "open">,
): TownCenterAction[] {
  return TOWN_CENTER_BUILDINGS.filter(({ key }) => places.opens(key)).map(
    ({ key, label, icon, detail }) => ({
      id: key,
      label,
      icon,
      detail,
      run: () => void places.open(key),
    }),
  );
}

/**
 * `actions` with **Buildings** after the Town master (else last), when any
 * place opens; the town center ring's actions as Town shows them.
 */
export function withBuildingsAction(
  actions: readonly TownCenterAction[],
  places: Pick<TownPlaces, "opens" | "open">,
): TownCenterAction[] {
  if (!TOWN_CENTER_BUILDINGS.some(({ key }) => places.opens(key)))
    return [...actions];
  const buildings: TownCenterAction = {
    id: "buildings",
    label: "Buildings",
    icon: Landmark,
    ring: () => townCenterBuildings(places),
    run: () => undefined,
  };
  const at = actions.findIndex((action) => action.id === "master");
  return at === -1
    ? [...actions, buildings]
    : [...actions.slice(0, at + 1), buildings, ...actions.slice(at + 1)];
}
