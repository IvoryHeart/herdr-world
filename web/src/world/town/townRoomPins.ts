/**
 * Where the user put Town's rooms: a view setting World's service keeps with
 * Board's layout (board-store.ts `room_pins`), keyed by each workspace's card
 * key, so a reload and every device show the same arrangement.
 */

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import {
  sharedBoardStore,
  type BoardDocumentStore,
  type RoomSpot,
} from "../board/boardDocument";
import type { TownRoomActions } from "./TownCanvas";
import { townRoomDrag } from "./townDrag";
import type { TownLayout } from "./townLayout";
import type { RoomPins, TownModel } from "./townModel";
import { townRoomNeighbor, townRoomSwap } from "./townRoomPlace";

const NONE: RoomPins = Object.freeze({});

const sameSpots = (a: RoomPins, b: RoomPins) => {
  const keys = Object.keys(b);
  return (
    keys.length === Object.keys(a).length &&
    keys.every((key) => a[key]?.x === b[key]!.x && a[key]?.y === b[key]!.y)
  );
};

/** The saved room spots, kept current from the World service. */
export function useRoomPins(
  store: BoardDocumentStore = sharedBoardStore(),
): RoomPins {
  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);
  const last = useRef<RoomPins>(NONE);
  const snapshot = () => {
    const next = store.get().document?.layout.room_pins ?? NONE;
    if (!sameSpots(last.current, next)) last.current = next;
    return last.current;
  };
  return useSyncExternalStore(store.subscribe, snapshot, snapshot);
}

/**
 * Save where a host's rooms stand (spots by workspace card key): replaces
 * that host's saved spots. Resolves with a conflict message, or null.
 */
export function saveRoomSpots(
  connectionId: string,
  spots: Record<string, RoomSpot>,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch([
    { op: "room.place", connection_id: connectionId, spots },
  ]);
}

/**
 * The room actions the plaques use, with room moves filled in from the town
 * shown: a room can move when its host can change rooms and it has another
 * room in its building, and Move before or after swaps it with its
 * neighbour in reading order.
 */
export function useTownRoomMoves(
  roomActions: TownRoomActions,
  model: TownModel,
  layout: TownLayout,
): TownRoomActions {
  return useMemo(() => {
    const { onPlaceRooms, canMoveRoom } = roomActions;
    if (!onPlaceRooms) return roomActions;
    const movable = (roomKey: string) =>
      (canMoveRoom?.(roomKey) ?? true) && townRoomDrag(roomKey, model) !== null;
    return {
      ...roomActions,
      canMoveRoom: movable,
      roomMoveNeighbor: (roomKey, step) => {
        const other = movable(roomKey)
          ? townRoomNeighbor(layout, roomKey, step)
          : null;
        return other
          ? { label: model.rooms.get(other.key)?.displayLabel ?? "room" }
          : null;
      },
      onMoveRoom: (roomKey, step) => {
        const placement = townRoomSwap(layout, roomKey, step);
        if (placement?.changed) void onPlaceRooms(roomKey, placement);
      },
    };
  }, [roomActions, model, layout]);
}
