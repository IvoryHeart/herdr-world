import { useCallback, useMemo, useState } from "react";
import {
  createOfficeProjector,
  type HerdrOfficeProjection,
  TOWN_PRESENTATION_BOUNDS,
} from "../herdrOfficeProjection";
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
  const deskPins = useDeskPins();
  // Only which tabs are pinned matters to admission, not their cells.
  const pinnedTabKeys = Object.keys(deskPins).sort().join("\n");
  const pinnedTabs = useMemo(
    () => new Set(pinnedTabKeys ? pinnedTabKeys.split("\n") : []),
    [pinnedTabKeys],
  );
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
      projectOffice(world, Date.now(), selectedId, pinnedTabs, expandedRooms),
    [world, selectedId, projectOffice, pinnedTabs, expandedRooms],
  );
  return { office: observedOffice, deskPins, toggleRoomFold };
}
