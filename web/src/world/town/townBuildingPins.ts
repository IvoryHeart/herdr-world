/**
 * Which lot each Town building stands on: a view setting World's service
 * keeps with Board's layout (board-store.ts `building_pins`), by each host's
 * connection ID, so a reload and every device show the same town. A
 * building's pin is its rank in the town's reading order, and the first
 * move also saves how many lots stand on each street (`building_columns`),
 * so a host without a pin (a new host) stands after every placed building,
 * in host order: it takes the next free lot and moves none of them.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  sharedBoardStore,
  type BoardDocumentStore,
} from "../board/boardDocument";
import { NO_BUILDING_PINS, type BuildingPins } from "./townBuildingPlace";

const samePins = (a: BuildingPins, b: BuildingPins) => {
  const keys = Object.keys(b.ranks);
  return (
    a.perStreet === b.perStreet &&
    keys.length === Object.keys(a.ranks).length &&
    keys.every((key) => a.ranks[key] === b.ranks[key])
  );
};

/** The saved building placement, kept current from the World service. */
export function useBuildingPins(
  store: BoardDocumentStore = sharedBoardStore(),
): BuildingPins {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<BuildingPins>(NO_BUILDING_PINS);
  const snapshot = () => {
    const layout = store.get().document?.layout;
    const perStreet = layout?.building_columns;
    const next: BuildingPins = {
      ranks: layout?.building_pins ?? NO_BUILDING_PINS.ranks,
      ...(perStreet === undefined ? {} : { perStreet }),
    };
    if (!samePins(last.current, next)) last.current = next;
    return last.current;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/**
 * Save the buildings shown in this order (their connection IDs): they take
 * the lots they hold among the saved ones, in this order, and hosts not
 * shown keep theirs. `hosts` is every host of the town in host order, the
 * hidden ones too, so a first move places them all where they stood;
 * `perStreet` the lots per street to keep if this is the first move
 * (townFirstLotsPerStreet; World keeps the first saved). Resolves with a
 * conflict message, or null.
 */
export function saveBuildingOrder(
  connectionIds: readonly string[],
  hosts: readonly string[],
  perStreet: number,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    {
      op: "building.place",
      order: [...connectionIds],
      hosts: [...hosts],
      columns: perStreet,
    },
  ]);
}
