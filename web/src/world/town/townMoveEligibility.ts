import type { OfficeDesk, OfficeRoom } from "../herdrOfficeProjection";

/** Native TUI relocation preserves running panes; all other room moves resume. */
export const needsAgentHandoff = (desk: OfficeDesk, room: OfficeRoom) =>
  Boolean(desk.coreOpen) ||
  desk.tabRef.connectionId !== room.workspaceRef.connectionId;

export const canHandoffDesk = (desk: OfficeDesk) =>
  !desk.stale &&
  (desk.canOpenInSpaces || desk.coreOpen) &&
  desk.observedPaneCount === 1 &&
  desk.paneDevices.length === 1 &&
  Boolean(desk.paneDevices[0]?.agentKey);

export function canMoveDeskToRoom(desk: OfficeDesk, room: OfficeRoom) {
  return (
    !desk.stale &&
    !room.stale &&
    (room.canOpenInSpaces || room.coreOpen) &&
    (needsAgentHandoff(desk, room)
      ? canHandoffDesk(desk)
      : desk.canOpenInSpaces)
  );
}
