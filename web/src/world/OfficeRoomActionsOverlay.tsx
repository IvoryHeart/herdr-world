import { Pencil, Plus, Trash2 } from "lucide-react";
import { OFFICE_GEOMETRY, deskAnchor } from "./officeGeometry";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type { PublishedOfficeLayout } from "./officeLayout";

export function OfficeRoomActionsOverlay({
  layout,
  projection,
  renderedRevision,
  selectedRoomKey,
  canCreateSeat,
  onCreateSeat,
  canCreateRoom,
  onCreateRoom,
  canRenameRoom,
  onRenameRoom,
  canCloseRoom,
  onCloseRoom,
}: {
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  renderedRevision: number;
  selectedRoomKey: string | null;
  canCreateSeat(roomKey: string): boolean;
  onCreateSeat(roomKey: string): void;
  canCreateRoom(roomKey: string | null): boolean;
  onCreateRoom(roomKey: string | null): void;
  canRenameRoom(roomKey: string): boolean;
  onRenameRoom(roomKey: string): void;
  canCloseRoom(roomKey: string): boolean;
  onCloseRoom(roomKey: string): void;
}) {
  const layoutReady =
    layout.layoutRevision > 0 && layout.layoutRevision === renderedRevision;
  const roomBottom = layout.rooms.reduce(
    (bottom, room) => Math.max(bottom, room.y + room.height),
    layout.roomStartY,
  );
  return (
    <div
      className="world-room-actions-overlay"
      aria-label="Office room actions"
    >
      {projection.rooms.map((room, index) => {
        const rect = layout.rooms.find(
          ({ index: roomIndex }) => roomIndex === index,
        );
        if (!rect) return null;
        const header = rect.header;
        return (
          <div
            key={room.key}
            className={`world-room-actions${layoutReady ? "" : " world-room-actions-stale"}`}
            aria-hidden={!layoutReady}
            style={{
              left: rect.headerRect.x,
              top: rect.headerRect.y,
              width: rect.headerRect.width,
              height: rect.headerRect.height,
            }}
          >
            <button
              className="world-room-overlay-action world-room-overlay-action-rename"
              type="button"
              aria-label={`Rename room ${room.accessibleLabel ?? room.displayLabel}`}
              title={`Rename ${room.accessibleLabel ?? room.displayLabel}`}
              disabled={!layoutReady || !canRenameRoom(room.key)}
              style={{
                left:
                  header?.renameX ?? Math.max(0, rect.headerRect.width - 52),
                top: 2,
              }}
              onClick={() => onRenameRoom(room.key)}
            >
              <Pencil size={12} aria-hidden="true" />
            </button>
            <button
              className="world-room-overlay-action world-room-overlay-action-danger"
              type="button"
              aria-label={`Close room ${room.accessibleLabel ?? room.displayLabel}`}
              title={`Close ${room.accessibleLabel ?? room.displayLabel}`}
              disabled={!layoutReady || !canCloseRoom(room.key)}
              style={{
                left:
                  header?.closeX ??
                  Math.max(
                    0,
                    rect.headerRect.width -
                      OFFICE_GEOMETRY.roomHeaderActionWidth,
                  ),
                top: 2,
              }}
              onClick={() => onCloseRoom(room.key)}
            >
              <Trash2 size={12} aria-hidden="true" />
            </button>
          </div>
        );
      })}
      {projection.rooms.map((room, index) => {
        const rect = layout.rooms.find(
          ({ index: roomIndex }) => roomIndex === index,
        );
        if (!rect || !canCreateSeat(room.key)) return null;
        const full = room.desks.length >= OFFICE_GEOMETRY.desksPerRoom;
        const anchor = full
          ? { x: rect.x + rect.width / 2, deskY: rect.y + rect.height - 40 }
          : deskAnchor(rect, room.desks.length);
        return (
          <button
            key={`${room.key}:new-seat`}
            className={`world-new-seat-canvas-action${full ? " world-new-seat-canvas-action-full" : ""}`}
            type="button"
            aria-label={
              full
                ? `${room.accessibleLabel ?? room.displayLabel} room full`
                : `New seat in ${room.accessibleLabel ?? room.displayLabel}`
            }
            title={
              full
                ? `${room.accessibleLabel ?? room.displayLabel} is full`
                : `Start a new seat in ${room.accessibleLabel ?? room.displayLabel}`
            }
            disabled={!layoutReady || full}
            style={{ left: anchor.x - 25, top: anchor.deskY }}
            onClick={() => onCreateSeat(room.key)}
          />
        );
      })}
      {canCreateRoom(selectedRoomKey) ? (
        <button
          className="world-new-room-canvas-action"
          type="button"
          aria-label="New room"
          title="Create a new Herdr workspace"
          disabled={!layoutReady}
          style={{ left: layout.officeWidth / 2 - 28, top: roomBottom + 8 }}
          onClick={() => onCreateRoom(selectedRoomKey)}
        >
          <Plus size={24} aria-hidden="true" />
          <span>NEW ROOM</span>
        </button>
      ) : null}
    </div>
  );
}
