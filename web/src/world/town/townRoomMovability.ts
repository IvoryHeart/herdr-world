import type { OfficeRoom } from "../herdrOfficeProjection";
import { officeSpaceForRoom } from "../officeRoomActions";
import type { WorldObject } from "../worldObject";

/** Room spots are World's layout; only TUI rooms also need native ordering. */
export function townRoomMoveReason(
  world: WorldObject,
  room: OfficeRoom | null,
): string | null {
  if (!room) return "the room is no longer available";
  const space = officeSpaceForRoom(world, room);
  if (!space) return "the room's connection changed";
  if (room.stale || space.stale) return "the room is stale";
  if (space.coreControl || space.actionable) return null;
  return "this connection cannot reorder workspaces now";
}
