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
import type { OfficeRoom } from "../herdrOfficeProjection";
import {
  townPlaceConnectionOf,
  townRoomColorKey,
  type RoomPins,
  type TownModel,
} from "./townModel";
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
 * Room spots by owning runtime's connection ID (the anchor view's, for a
 * room Town shows through another view of its endpoint: townModel.ts
 * `townPlaceConnectionOf`), each keyed by the room's workspace card key. A
 * building per machine can hold several runtimes' rooms, but each runtime
 * keeps its own spots.
 */
export function roomSpotsByRuntime(
  placed: Iterable<readonly [OfficeRoom, RoomSpot]>,
): Map<string, Record<string, RoomSpot>> {
  const spots = new Map<string, Record<string, RoomSpot>>();
  for (const [room, spot] of placed) {
    const id = townPlaceConnectionOf(room);
    const owned = spots.get(id) ?? {};
    owned[townRoomColorKey(room)] = spot;
    spots.set(id, owned);
  }
  return spots;
}

/**
 * Save where rooms stand (spots by workspace card key, by owning runtime's
 * connection ID): replaces each of those runtimes' saved spots, in one patch,
 * so a building holding several runtimes' rooms saves them together.
 * Resolves with a conflict message, or null.
 */
export function saveRoomSpots(
  spotsByConnection: ReadonlyMap<string, Record<string, RoomSpot>>,
  store: BoardDocumentStore = sharedBoardStore(),
) {
  return store.patch(
    [...spotsByConnection].map(([connectionId, spots]) => ({
      op: "room.place" as const,
      connection_id: connectionId,
      spots,
    })),
  );
}

/** What Tidy rooms' Undo reads later: the actions and town shown by then. */
export type TownRoomMovesLatest = {
  readonly current: { roomActions: TownRoomActions; layout: TownLayout };
};

/**
 * The room actions the plaques use, with room moves filled in from the town
 * shown: a room can move when its runtime permits placement and it has another
 * room in its building, and Move before or after swaps it with its
 * neighbour in reading order. Tidy rooms (any building with a movable room,
 * even just one) lays its movable rooms out around the fixed ones
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
  const canPlace = (key: string) => {
    const room = model.rooms.get(key);
    return Boolean(room && !room.stale && (canMoveRoom?.(key) ?? true));
  };
  const movable = (roomKey: string) =>
    townRoomDrag(roomKey, model, canPlace) !== null;
  // Tidy rooms needs only a movable room: unlike a drag, a lone
  // room left far from its spot still has a building to compact.
  const tidyRoom = (hostKey: string) =>
    layout.buildings
      .find((b) => b.hostKey === hostKey)
      ?.rooms.find((placed) => canPlace(placed.key))?.key;
  const currentCanPlace = (key: string) =>
    latest.current.roomActions.canMoveRoom?.(key) ?? canPlace(key);
  const stayedRooms = (placement: TownRoomPlacement) =>
    placement.order.filter((key) => !currentCanPlace(key));
  const reportStayed = (keys: readonly string[]) => {
    if (keys.length) latest.current.roomActions.onRoomsStayed?.(keys);
  };
  /** Save a building's rooms where they glide to. */
  const glide = async (
    hostKey: string,
    placement: TownRoomPlacement,
    label: string,
  ) => {
    const place = latest.current.roomActions.onPlaceRooms ?? onPlaceRooms;
    const kept = stayedRooms(placement);
    renderer?.current?.beginGlide(hostKey);
    const result = await place(placement.order[0]!, placement, label);
    renderer?.current?.finishGlide(result);
    if (result === "moved") reportStayed(kept);
    return result;
  };
  return {
    ...roomActions,
    canMoveRoom: movable,
    roomMoveNeighbor: (roomKey, step) => {
      const other = movable(roomKey)
        ? townRoomNeighbor(layout, roomKey, step)
        : null;
      return other && canPlace(other.key)
        ? { label: model.rooms.get(other.key)?.displayLabel ?? "room" }
        : null;
    },
    onMoveRoom: (roomKey, step) => {
      const placement = townRoomSwap(layout, roomKey, step, canPlace);
      if (placement?.changed) void onPlaceRooms(roomKey, placement);
    },
    canTidyRooms: (hostKey) => tidyRoom(hostKey) !== undefined,
    onTidyRooms: (hostKey) => {
      const placement = tidyRoom(hostKey)
        ? townRoomTidy(latest.current.layout, hostKey, currentCanPlace)
        : null;
      if (!placement) return;
      const host = model.hosts.get(hostKey)?.displayLabel ?? "This building";
      const tidied = latest.current.roomActions.onRoomsTidied;
      if (!placement.changed) {
        reportStayed(stayedRooms(placement));
        return tidied?.(host, null);
      }
      const before = townBuildingSpots(latest.current.layout, hostKey);
      void glide(hostKey, placement, `${host}'s rooms`).then((result) => {
        if (result !== "moved") return;
        tidied?.(host, async () => {
          const undo = townRoomRestore(
            latest.current.layout,
            hostKey,
            before,
            currentCanPlace,
          );
          if (undo?.changed) return glide(hostKey, undo, `${host}'s rooms`);
          if (undo) reportStayed(stayedRooms(undo));
          return "returned";
        });
      });
    },
  };
}
