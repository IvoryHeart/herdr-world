import type { OfficeRoomRect } from "./officeGeometry";

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
