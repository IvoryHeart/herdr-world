import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOfficeProjector,
  type HerdrOfficeProjection,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { townAttentionDesks } from "./townAttention";
import type { TownCall } from "./TownRail";
import type { WorldAsk } from "../worldAsks";
import { withTownFinished } from "./townFinished";
import { useDeskPins } from "../useDeskPins";
import type { WorldObject } from "../worldObject";

/**
 * The Office projection Town shows: pinned desks admitted first, and rooms
 * past TOWN_PRESENTATION_BOUNDS.foldedDesksPerRoom folded to their busiest
 * desks until the user expands them into a longer room.
 */
export function useTownOffice(world: WorldObject, selectedId: string | null) {
  const projectOffice = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
  // Separate caches avoid alternating semantic and protected presentation inputs.
  const projectPresentation = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
  const deskPins = useDeskPins();
  // Only which tabs are pinned matters to admission, not their cells.
  const pinnedTabKeys = Object.keys(deskPins).sort().join("\n");
  const pinnedTabs = useMemo(
    () => new Set(pinnedTabKeys ? pinnedTabKeys.split("\n") : []),
    [pinnedTabKeys],
  );
  const sequence = useRef(0);
  const [requestedRoom, requestRoom] = useState<{
    roomKey: string;
    seq: number;
    worldId: string;
    generation: number;
  } | null>(null);
  const source = requestedRoom
    ? world.nodeById.get(requestedRoom.worldId)
    : null;
  const roomFocus =
    source?.kind === "space" && source.generation === requestedRoom?.generation
      ? requestedRoom
      : null;
  useEffect(() => {
    if (requestedRoom && !roomFocus) requestRoom(null);
  }, [requestedRoom, roomFocus]);
  const [expandedRooms, setExpandedRooms] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const toggleRoomFold = useCallback(
    (roomKey: string) =>
      setExpandedRooms((current) => {
        const next = new Set(current);
        if (!next.delete(roomKey)) next.add(roomKey);
        return next;
      }),
    [],
  );
  const observedOffice = useMemo(
    (): HerdrOfficeProjection =>
      projectOffice(
        world,
        Date.now(),
        selectedId,
        pinnedTabs,
        expandedRooms,
        undefined,
        roomFocus?.roomKey ?? null,
      ),
    [
      world,
      selectedId,
      projectOffice,
      pinnedTabs,
      expandedRooms,
      roomFocus?.roomKey,
    ],
  );
  const present = useCallback(
    (protectedDesks: ReadonlySet<string>) =>
      projectPresentation(
        world,
        Date.now(),
        selectedId,
        pinnedTabs,
        expandedRooms,
        protectedDesks,
        roomFocus?.roomKey ?? null,
      ),
    [
      world,
      selectedId,
      pinnedTabs,
      expandedRooms,
      projectPresentation,
      roomFocus?.roomKey,
    ],
  );
  const focusRoom = useCallback(
    (roomKey: string) => {
      const room = observedOffice.roomRoster.find(
        (entry) => entry.key === roomKey,
      );
      if (room)
        requestRoom({
          roomKey,
          seq: ++sequence.current,
          worldId: room.workspaceRef.worldId,
          generation: room.workspaceRef.generation,
        });
    },
    [observedOffice.roomRoster],
  );
  return {
    office: observedOffice,
    deskPins,
    toggleRoomFold,
    present,
    roomFocus,
    focusRoom,
  };
}

/** Admit attention from the full semantic roster, then apply its same finish overlay. */
export function useTownPresentation(
  present: (desks: ReadonlySet<string>) => HerdrOfficeProjection,
  office: HerdrOfficeProjection,
  calls: readonly TownCall[],
  asks: readonly WorldAsk[],
  finished: ReadonlySet<string>,
  seen: ReadonlySet<string>,
) {
  const desks = useMemo(
    () => townAttentionDesks(calls, asks, office.roster),
    [calls, asks, office.roster],
  );
  return useMemo(
    () => withTownFinished(present(desks), finished, seen),
    [present, desks, finished, seen],
  );
}
