/**
 * Which lot each Town building stands on: a view setting World's service
 * keeps with Board's layout (board-store.ts `building_pins`), by each host's
 * connection ID, so a reload and every device show the same town. A
 * building's pin is its rank in the town's reading order; a host without
 * one (a new host) stands after every placed building, in host order, so it
 * takes the next free lot and moves none of them.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  sharedBoardStore,
  type BoardDocumentStore,
} from "../board/boardDocument";
import { NO_BUILDING_PINS, type BuildingPins } from "./townBuildingPlace";

const samePins = (a: BuildingPins, b: BuildingPins) => {
  const keys = Object.keys(b);
  return (
    keys.length === Object.keys(a).length &&
    keys.every((key) => a[key] === b[key])
  );
};

/** The saved building ranks, kept current from the World service. */
export function useBuildingPins(
  store: BoardDocumentStore = sharedBoardStore(),
): BuildingPins {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<BuildingPins>(NO_BUILDING_PINS);
  const snapshot = () => {
    const next = store.get().document?.layout.building_pins ?? NO_BUILDING_PINS;
    if (!samePins(last.current, next)) last.current = next;
    return last.current;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/**
 * Save the buildings shown in this order (their connection IDs): they take
 * the lots they hold among the saved ones, in this order, and hosts not
 * shown keep theirs. Resolves with a conflict message, or null.
 */
export function saveBuildingOrder(
  connectionIds: readonly string[],
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([{ op: "building.place", order: [...connectionIds] }]);
}
