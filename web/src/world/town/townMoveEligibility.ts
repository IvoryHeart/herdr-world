import type { OfficeDesk, OfficeRoom } from "../herdrOfficeProjection";

/**
 * A desk moving to another runtime (Herdr TUI ↔ herdr-core) is handed over:
 * its agent resumes there. Within one runtime the runtime's own move keeps
 * it running.
 */
export const needsAgentHandoff = (desk: OfficeDesk, room: OfficeRoom) =>
  desk.tabRef.connectionId !== room.workspaceRef.connectionId;

/** One agent alone at its desk: the only desk a handoff moves. */
export const canHandoffDesk = (desk: OfficeDesk) =>
  !desk.stale &&
  (desk.canOpenInSpaces || Boolean(desk.coreOpen)) &&
  desk.observedPaneCount === 1 &&
  desk.paneDevices.length === 1 &&
  Boolean(desk.paneDevices[0]?.agentKey);

export function canMoveDeskToRoom(desk: OfficeDesk, room: OfficeRoom) {
  return (
    !desk.stale &&
    !room.stale &&
    (room.canOpenInSpaces || Boolean(room.coreOpen)) &&
    (needsAgentHandoff(desk, room)
      ? canHandoffDesk(desk)
      : desk.canOpenInSpaces || Boolean(desk.coreOpen))
  );
}
