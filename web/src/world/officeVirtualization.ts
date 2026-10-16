import { OFFICE_GEOMETRY } from "./officeGeometry";
import type {
  OfficeRect,
  OfficeReceptionRect,
  OfficeRoomRect,
} from "./officeGeometry";
import type { OfficeReception } from "./herdrOfficeProjection";

export function officeVisibleRooms(
  rooms: readonly OfficeRoomRect[],
  scrollTop: number,
  viewportHeight: number,
) {
  // One adjacent viewport bounds paint work independently of distant room size.
  // Semantic rosters and the layout remain complete for search and reveal.
  const overscan = Math.max(1, viewportHeight);
  return rooms.filter(
    (room) =>
      room.y + room.height >= scrollTop - overscan &&
      room.y <= scrollTop + viewportHeight + overscan,
  );
}

export function officeVisibleReceptions(
  receptions: readonly OfficeReception[],
  rects: readonly OfficeReceptionRect[],
  scrollLeft: number,
  viewportWidth: number,
  verticalViewport?: { y: number; height: number },
) {
  const overscan = Math.max(1, viewportWidth);
  return receptions.flatMap((reception, index) => {
    const rect = rects[index];
    if (
      !rect ||
      rect.width <= 0 ||
      rect.height <= 0 ||
      rect.x + rect.width < scrollLeft - overscan ||
      rect.x > scrollLeft + viewportWidth + overscan ||
      (verticalViewport &&
        (rect.y + rect.height < verticalViewport.y - verticalViewport.height ||
          rect.y > verticalViewport.y + 2 * verticalViewport.height))
    ) {
      return [];
    }
    return [{ reception, index, rect }];
  });
}

export function officeIntersects(rect: OfficeRect, viewport?: OfficeRect) {
  return (
    !viewport ||
    (rect.x + rect.width >= viewport.x &&
      rect.x <= viewport.x + viewport.width &&
      rect.y + rect.height >= viewport.y &&
      rect.y <= viewport.y + viewport.height)
  );
}

/** Keep original desk indices; slicing a room must never renumber its tabs. */
export function officeDeskRange(
  rect: OfficeRoomRect,
  count: number,
  viewport?: OfficeRect,
) {
  if (rect.collapsed) return [0, 0] as const;
  if (!viewport) return [0, count] as const;
  const startY = rect.y + 42 + OFFICE_GEOMETRY.deskTopOffset;
  const first = Math.max(
    0,
    Math.floor((viewport.y - startY - rect.deskRowHeight) / rect.deskRowHeight),
  );
  const end = Math.max(
    first,
    Math.ceil((viewport.y + viewport.height - startY) / rect.deskRowHeight),
  );
  return [
    Math.min(count, first * rect.deskColumns),
    Math.min(count, end * rect.deskColumns),
  ] as const;
}
