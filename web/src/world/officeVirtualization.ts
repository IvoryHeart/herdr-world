import type { OfficeReceptionRect, OfficeRoomRect } from "./officeGeometry";
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
) {
  const overscan = Math.max(1, viewportWidth);
  return receptions.flatMap((reception, index) => {
    const rect = rects[index];
    if (
      !rect ||
      rect.x + rect.width < scrollLeft - overscan ||
      rect.x > scrollLeft + viewportWidth + overscan
    ) {
      return [];
    }
    return [{ reception, index, rect }];
  });
}
