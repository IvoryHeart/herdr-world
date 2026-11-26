/**
 * Where the library's and the observatory's signs stand, in world pixels,
 * each centred on its lot. Both keep a readable screen size as the town
 * zooms (townLibrary.css, townObservatory.css), so how far apart they must
 * stand depends on the zoom and on what they say, not on the lawn between
 * the lots.
 *
 * The observatory's sign stands on its dome, its foot at `y`. A wide town
 * stands the library's on its eave the same way. A narrow (phone) town opens
 * zoomed out far enough that the signs are wider than the lawn between the
 * buildings, so there the library's hangs from its top-left corner at
 * (`x`, `y`) over its roof, just below the observatory sign's foot, and grows
 * only right and down: never up into the observatory's sign nor left over
 * the town center's plaque, at any zoom and whatever the signs say (#1351).
 */

import type { TownLayout } from "./townLayout";
import { townLibraryLot } from "./townLibraryLot";
import { townObservatoryLot } from "./townObservatoryLot";

/**
 * World pixels between the observatory sign's foot and a hanging library sign.
 * @internal
 */
export const TOWN_CIVIC_SIGN_GAP = 4;

export function townCivicSigns(layout: TownLayout, tile: number) {
  const library = townLibraryLot(layout);
  const observatory = townObservatoryLot(layout);
  const observatorySign = {
    x: (observatory.x + observatory.w / 2) * tile,
    y: observatory.y * tile + 2,
  };
  const librarySign =
    layout.formFactor === "narrow"
      ? {
          x: library.x * tile,
          y: observatorySign.y + TOWN_CIVIC_SIGN_GAP,
          hangs: true,
        }
      : {
          x: (library.x + library.w / 2) * tile,
          y: library.y * tile + 30,
          hangs: false,
        };
  return { library: librarySign, observatory: observatorySign };
}
