import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createOfficeProjector,
  type HerdrOfficeProjection,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
import { useDeskPins } from "../useDeskPins";
import { DEVTOOLS } from "../devtools/flag";
import { countWorldWork } from "../devtools/renderer";
import type { WorldObject } from "../worldObject";

/** Town reveals the first 24 native-order tabs, then 20 more per expansion. */
export function useTownOffice(world: WorldObject, selectedId: string | null) {
  const projectOffice = useMemo(
    () => createOfficeProjector(TOWN_PRESENTATION_BOUNDS),
    [],
  );
  const deskPins = useDeskPins();
  // Preserve the pin-key identity across cell changes; pins do not promote tabs.
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
  const [expandedDeskLimits, setExpandedDeskLimits] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  // Explicit layout requests commit with their admission state. TownCanvas
  // uses this revision to distinguish a requested reflow from background work.
  const [foldRevision, setFoldRevision] = useState(0);
  const toggleRoomFold = useCallback((roomKey: string, nextLimit?: number) => {
    setFoldRevision((revision) => revision + 1);
    if (nextLimit !== undefined) {
      setExpandedRooms((current) => new Set(current).add(roomKey));
      setExpandedDeskLimits((current) => {
        const next = new Map(current);
        next.set(roomKey, nextLimit);
        return next;
      });
      return;
    }
    setExpandedRooms((current) => {
      const next = new Set(current);
      next.delete(roomKey);
      return next;
    });
    setExpandedDeskLimits((limits) => {
      if (!limits.has(roomKey)) return limits;
      const next = new Map(limits);
      next.delete(roomKey);
      return next;
    });
  }, []);
  const observedOffice = useMemo((): HerdrOfficeProjection => {
    if (DEVTOOLS) countWorldWork("office.project");
    return projectOffice(
      world,
      Date.now(),
      selectedId,
      pinnedTabs,
      expandedRooms,
      roomFocus?.roomKey ?? null,
      expandedDeskLimits,
    );
  }, [
    world,
    selectedId,
    projectOffice,
    pinnedTabs,
    expandedRooms,
    expandedDeskLimits,
    roomFocus?.roomKey,
  ]);
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
    foldRevision,
    roomFocus,
    focusRoom,
  };
}
