import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { OFFICE_GEOMETRY, deskAnchor } from "./officeGeometry";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type { PublishedOfficeLayout } from "./officeLayout";
import {
  officeSemanticTargets,
  type OfficeSemanticTarget,
} from "./officeSemanticTargets";
import { yieldWorldTask } from "./worldObject";

export function OfficeSemanticTargetsOverlay({
  layout,
  projection,
  renderedRevision,
  selectedKey,
  onSelect,
  onActivateAgent,
  onActivateDesk,
  onActivateRoom,
}: {
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  renderedRevision: number;
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivateAgent(key: string): void;
  onActivateDesk(key: string): void;
  onActivateRoom(key: string): void;
}) {
  const targets = useMemo(
    () => officeSemanticTargets(projection, layout),
    [projection, layout],
  );
  // Admission follows qualified identities, not the allocation of a new snapshot.
  // Labels, actions and geometry still come from the current projection.
  const identity = useMemo(
    () => JSON.stringify(targets.map(({ kind, key }) => [kind, key])),
    [targets],
  );
  const [progress, setProgress] = useState<{
    identity: string;
    limit: number;
  } | null>(null);
  const limit = progress?.identity === identity ? progress.limit : 64;
  const rendered = targets.filter(
    (target, index) => index < limit || target.key === selectedKey,
  );
  const pending = targets.length - rendered.length;
  const handlers = useRef({
    onSelect,
    onActivateAgent,
    onActivateDesk,
    onActivateRoom,
  });
  handlers.current = {
    onSelect,
    onActivateAgent,
    onActivateDesk,
    onActivateRoom,
  };
  const actions = useMemo(
    () => ({
      select: (key: string) => handlers.current.onSelect(key),
      activate: (key: string, kind: OfficeSemanticTarget["kind"]) => {
        if (kind === "agent") handlers.current.onActivateAgent(key);
        if (kind === "desk" || kind === "pane")
          handlers.current.onActivateDesk(key);
        if (kind === "room") handlers.current.onActivateRoom(key);
      },
    }),
    [],
  );
  useEffect(() => {
    if (!pending) return;
    let current = true;
    // Admit independently of animation frames, which may be browser-throttled.
    void yieldWorldTask().then(() => {
      if (current) setProgress({ identity, limit: limit + 64 });
    });
    return () => {
      current = false;
    };
  }, [identity, limit, pending]);
  const interactive =
    layout.layoutRevision > 0 && layout.layoutRevision === renderedRevision;
  return (
    <div
      className="world-semantic-targets-overlay"
      aria-label="Office scene targets"
      aria-busy={pending > 0}
      aria-hidden={!interactive}
    >
      {pending ? (
        <span role="status">Rendering {pending} more observed targets</span>
      ) : null}
      {rendered.map((target) => (
        <OfficeSemanticButton
          key={`${target.kind}:${target.key}`}
          targetKey={target.key}
          kind={target.kind}
          label={target.label}
          canActivate={target.canActivate}
          x={target.rect.x}
          y={target.rect.y}
          width={target.rect.width}
          height={target.rect.height}
          selected={selectedKey === target.key}
          interactive={interactive}
          actions={actions}
        />
      ))}
    </div>
  );
}

const OfficeSemanticButton = memo(function OfficeSemanticButton({
  targetKey,
  kind,
  label,
  canActivate,
  x,
  y,
  width,
  height,
  selected,
  interactive,
  actions,
}: {
  targetKey: string;
  kind: OfficeSemanticTarget["kind"];
  label: string;
  canActivate: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
  selected: boolean;
  interactive: boolean;
  actions: {
    select(key: string): void;
    activate(key: string, kind: OfficeSemanticTarget["kind"]): void;
  };
}) {
  return (
    <button
      className="world-semantic-target"
      type="button"
      data-kind={kind}
      data-target-key={targetKey}
      aria-label={label}
      aria-pressed={selected}
      disabled={!interactive}
      title={label}
      style={{ left: x, top: y, width, height }}
      onClick={() => actions.select(targetKey)}
      onDoubleClick={() => {
        if (canActivate) actions.activate(targetKey, kind);
      }}
    />
  );
});

export function OfficeRoomActionsOverlay({
  layout,
  projection,
  renderedRevision,
  selectedRoomKey,
  showCreateSeat,
  canCreateSeat,
  createSeatReason,
  onCreateSeat,
  showCreateRoom,
  canCreateRoom,
  createRoomReason,
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
  showCreateSeat(roomKey: string): boolean;
  canCreateSeat(roomKey: string): boolean;
  createSeatReason(roomKey: string): string | null;
  onCreateSeat(roomKey: string): void;
  showCreateRoom(roomKey: string | null): boolean;
  canCreateRoom(roomKey: string | null): boolean;
  createRoomReason(roomKey: string | null): string | null;
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
        if (!rect || !showCreateSeat(room.key)) return null;
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
                : (createSeatReason(room.key) ??
                  `Start a new seat in ${room.accessibleLabel ?? room.displayLabel}`)
            }
            disabled={!layoutReady || full || !canCreateSeat(room.key)}
            style={{ left: anchor.x - 25, top: anchor.deskY }}
            onClick={() => onCreateSeat(room.key)}
          />
        );
      })}
      {showCreateRoom(selectedRoomKey) ? (
        <button
          className="world-new-room-canvas-action"
          type="button"
          aria-label="New room"
          title={
            createRoomReason(selectedRoomKey) ?? "Create a new Herdr workspace"
          }
          disabled={!layoutReady || !canCreateRoom(selectedRoomKey)}
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
