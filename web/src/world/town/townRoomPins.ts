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
import type { TownRendererHandle } from "./townRenderer";
import {
  townBuildingSpots,
  townRoomNeighbor,
  townRoomRestore,
  townRoomSwap,
  townRoomTidy,
  type TownRoomPlacement,
} from "./townRoomPlace";

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

/** What Tidy rooms' Undo reads later: the actions and town shown by then. */
export type TownRoomMovesLatest = {
  readonly current: { roomActions: TownRoomActions; layout: TownLayout };
};

/**
 * The room actions the plaques use, with room moves filled in from the town
 * shown: a room can move when its host can change rooms and it has another
 * room in its building, and Move before or after swaps it with its
 * neighbour in reading order. Tidy rooms (any building whose host can change
 * its rooms, even with one room) lays a building's rooms out afresh
 * and glides them there (`renderer`); its Undo puts them back.
 */
export function useTownRoomMoves(
  roomActions: TownRoomActions,
  model: TownModel,
  layout: TownLayout,
  renderer?: { readonly current: TownRendererHandle | null },
): TownRoomActions {
  // Undo comes later: it places the rooms in the town shown by then.
  const latest = useRef({ roomActions, layout });
  latest.current = { roomActions, layout };
  return useMemo(
    () => townRoomMoves(roomActions, model, layout, latest, renderer),
    [roomActions, model, layout, renderer],
  );
}

/** useTownRoomMoves' actions for one town shown. */
export function townRoomMoves(
  roomActions: TownRoomActions,
  model: TownModel,
  layout: TownLayout,
  latest: TownRoomMovesLatest,
  renderer?: { readonly current: TownRendererHandle | null },
): TownRoomActions {
  const { onPlaceRooms, canMoveRoom } = roomActions;
  if (!onPlaceRooms) return roomActions;
  const movable = (roomKey: string) =>
    (canMoveRoom?.(roomKey) ?? true) && townRoomDrag(roomKey, model) !== null;
  // Tidy rooms needs only a room its host can change: unlike a drag, a lone
  // room left far from its spot still has a building to compact.
  const tidyRoom = (hostKey: string) =>
    layout.buildings
      .find((b) => b.hostKey === hostKey)
      ?.rooms.find((placed) => {
        const room = model.rooms.get(placed.key);
        return (
          room?.canOpenInSpaces &&
          !room.stale &&
          (canMoveRoom?.(placed.key) ?? true)
        );
      })?.key;
  /** Save a building's rooms where they glide to. */
  const glide = async (
    hostKey: string,
    placement: TownRoomPlacement,
    label: string,
  ) => {
    const place = latest.current.roomActions.onPlaceRooms ?? onPlaceRooms;
    renderer?.current?.beginGlide(hostKey);
    const result = await place(placement.order[0]!, placement, label);
    renderer?.current?.finishGlide(result);
    return result;
  };
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
    canTidyRooms: (hostKey) => tidyRoom(hostKey) !== undefined,
    onTidyRooms: (hostKey) => {
      const placement = tidyRoom(hostKey)
        ? townRoomTidy(layout, hostKey)
        : null;
      if (!placement) return;
      const host = model.hosts.get(hostKey)?.displayLabel ?? "This building";
      const tidied = latest.current.roomActions.onRoomsTidied;
      if (!placement.changed) return tidied?.(host, null);
      const before = townBuildingSpots(layout, hostKey);
      void glide(hostKey, placement, `${host}'s rooms`).then((result) => {
        if (result !== "moved") return;
        tidied?.(host, async () => {
          const undo = townRoomRestore(latest.current.layout, hostKey, before);
          return undo?.changed
            ? glide(hostKey, undo, `${host}'s rooms`)
            : "returned";
        });
      });
    },
  };
}
