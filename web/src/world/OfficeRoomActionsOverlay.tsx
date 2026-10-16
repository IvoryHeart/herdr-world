import {
  memo,
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Pencil, Trash2 } from "lucide-react";
import type { OfficeRect } from "./officeGeometry";
import { resolveOfficeAnchors } from "./officeRendererAnchors";
import { officeIntersects } from "./officeVirtualization";
import { OFFICE_GEOMETRY, deskAnchor } from "./officeGeometry";
import type { HerdrOfficeProjection } from "./herdrOfficeProjection";
import type { PublishedOfficeLayout } from "./officeLayout";
import {
  officeSemanticTargets,
  type OfficeSemanticTarget,
} from "./officeSemanticTargets";
import { yieldWorldTask } from "./worldObject";

const OFFICE_CONTROL_BATCH_SIZE = 16;

export function OfficeSemanticTargetsOverlay({
  layout,
  projection,
  renderedRevision,
  selectedKey,
  onSelect,
  onActivateAgent,
  onActivateDesk,
  onActivateRoom,
  viewport,
}: {
  viewport?: OfficeRect;
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  renderedRevision: number;
  selectedKey: string | null;
  onSelect(key: string): void;
  onActivateAgent(key: string): void;
  onActivateDesk(key: string): void;
  onActivateRoom(key: string): void;
}) {
  const overlay = useRef<HTMLDivElement>(null);
  const targets = useMemo(() => {
    const visible = officeSemanticTargets(projection, layout, viewport);
    const active = document.activeElement as HTMLElement | null;
    if (!active || !overlay.current?.contains(active)) return visible;
    const key = active.dataset.targetKey,
      kind = active.dataset.kind;
    if (
      !key ||
      visible.some((target) => target.key === key && target.kind === kind)
    )
      return visible;
    const anchors = resolveOfficeAnchors(projection, layout, key, key);
    const point = anchors.agent ?? anchors.workbench;
    if (!point) return visible;
    const focused = officeSemanticTargets(projection, layout, {
      x: point.x - 150,
      y: point.y - 150,
      width: 300,
      height: 300,
    }).find((target) => target.key === key && target.kind === kind);
    return focused ? [...visible, focused] : visible;
  }, [projection, layout, viewport]);
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
  const limit =
    progress?.identity === identity
      ? progress.limit
      : OFFICE_CONTROL_BATCH_SIZE;
  const admitted = useRef(new Set<string>());
  const rendered = targets.filter(
    (target, index) =>
      index < limit ||
      target.key === selectedKey ||
      admitted.current.has(`${target.kind}:${target.key}`),
  );
  useLayoutEffect(() => {
    admitted.current = new Set(
      rendered.map(({ kind, key }) => `${kind}:${key}`),
    );
  });
  const pending = targets.length - rendered.length;
  const interactive =
    layout.layoutRevision > 0 && layout.layoutRevision === renderedRevision;
  const acknowledgedRevision = useRef(0);
  if (interactive) acknowledgedRevision.current = renderedRevision;
  const active = document.activeElement as HTMLElement | null;
  const focusedKey =
    active && overlay.current?.contains(active)
      ? active.dataset.targetKey
      : null;
  const retainsPreparedGeometry =
    renderedRevision < 0 &&
    acknowledgedRevision.current === -renderedRevision &&
    Boolean(focusedKey && targets.some((target) => target.key === focusedKey));
  const handlers = useRef({
    interactive,
    onSelect,
    onActivateAgent,
    onActivateDesk,
    onActivateRoom,
  });
  useLayoutEffect(() => {
    // React 18 does not forward the boolean inert attribute. Update the native
    // subtree flag once, instead of disabling every admitted button.
    if (overlay.current)
      overlay.current.inert = !interactive && !retainsPreparedGeometry;
    handlers.current = {
      interactive,
      onSelect,
      onActivateAgent,
      onActivateDesk,
      onActivateRoom,
    };
  }, [
    interactive,
    retainsPreparedGeometry,
    onSelect,
    onActivateAgent,
    onActivateDesk,
    onActivateRoom,
  ]);
  const actions = useMemo(
    () => ({
      select: (key: string) => {
        if (handlers.current.interactive) handlers.current.onSelect(key);
      },
      activate: (key: string, kind: OfficeSemanticTarget["kind"]) => {
        if (!handlers.current.interactive) return;
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
      if (current)
        setProgress({ identity, limit: limit + OFFICE_CONTROL_BATCH_SIZE });
    });
    return () => {
      current = false;
    };
  }, [identity, limit, pending]);
  return (
    <div
      className="world-semantic-targets-overlay"
      aria-label="Office scene targets"
      aria-busy={pending > 0 || !interactive}
      aria-hidden={!interactive && !retainsPreparedGeometry}
      ref={overlay}
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
          disabled={
            !interactive &&
            !(retainsPreparedGeometry && target.key === focusedKey)
          }
          actions={actions}
        />
      ))}
    </div>
  );
}

// Identity keys share one parent so topology insertions preserve DOM and focus.
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
  disabled,
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
  disabled: boolean;
  actions: {
    select(key: string): void;
    activate(key: string, kind: OfficeSemanticTarget["kind"]): void;
  };
}) {
  return (
    <button
      className="world-semantic-target"
      type="button"
      disabled={disabled}
      data-kind={kind}
      data-target-key={targetKey}
      aria-label={label}
      aria-pressed={selected}
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
  showCreateSeat,
  canCreateSeat,
  createSeatReason,
  onCreateSeat,
  canRenameRoom,
  onRenameRoom,
  canCloseRoom,
  onCloseRoom,
  viewport,
  onToggleRoom,
}: {
  viewport?: OfficeRect;
  onToggleRoom?(roomKey: string): void;
  layout: PublishedOfficeLayout;
  projection: HerdrOfficeProjection;
  renderedRevision: number;
  showCreateSeat(roomKey: string): boolean;
  canCreateSeat(roomKey: string): boolean;
  createSeatReason(roomKey: string): string | null;
  onCreateSeat(roomKey: string): void;
  canRenameRoom(roomKey: string): boolean;
  onRenameRoom(roomKey: string): void;
  canCloseRoom(roomKey: string): boolean;
  onCloseRoom(roomKey: string): void;
}) {
  const layoutReady =
    layout.layoutRevision > 0 && layout.layoutRevision === renderedRevision;
  return (
    <div
      className="world-room-actions-overlay"
      aria-label="Office room actions"
    >
      {layout.rooms
        .filter(
          (rect) => !rect.hiddenByHost && officeIntersects(rect, viewport),
        )
        .map((rect) => {
          const room = projection.rooms[rect.index];
          if (!room || !officeIntersects(rect.headerRect, viewport))
            return null;
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
              {onToggleRoom ? (
                <button
                  className="world-room-overlay-action"
                  type="button"
                  aria-label={`${rect.collapsed ? "Expand" : "Collapse"} room ${room.accessibleLabel ?? room.displayLabel}`}
                  data-room-key={room.key}
                  aria-expanded={!rect.collapsed}
                  disabled={!layoutReady}
                  style={{ left: 0, top: 2 }}
                  onClick={() => onToggleRoom(room.key)}
                >
                  {rect.collapsed ? "+" : "−"}
                </button>
              ) : null}
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
      {layout.rooms
        .filter(
          (rect) => !rect.hiddenByHost && officeIntersects(rect, viewport),
        )
        .map((rect) => {
          const room = projection.rooms[rect.index];
          if (
            !room ||
            !officeIntersects(rect, viewport) ||
            rect.collapsed ||
            !showCreateSeat(room.key)
          )
            return null;
          const full = room.desks.length >= rect.deskRows * rect.deskColumns;
          const anchor = full
            ? { x: rect.x + rect.width / 2, deskY: rect.y + rect.height - 40 }
            : deskAnchor(rect, room.desks.length);
          if (
            !officeIntersects(
              { x: anchor.x - 25, y: anchor.deskY, width: 50, height: 60 },
              viewport,
            )
          )
            return null;
          const reason = createSeatReason(room.key);
          return (
            <Fragment key={`${room.key}:new-seat`}>
              <button
                className={`world-new-seat-canvas-action${full ? " world-new-seat-canvas-action-full" : ""}`}
                type="button"
                aria-label={`New seat in ${room.accessibleLabel ?? room.displayLabel}`}
                title={
                  createSeatReason(room.key) ??
                  `Start a new seat in ${room.accessibleLabel ?? room.displayLabel}`
                }
                disabled={!layoutReady || !canCreateSeat(room.key)}
                style={{ left: anchor.x - 25, top: anchor.deskY }}
                onClick={() => onCreateSeat(room.key)}
              />
              {reason ? (
                <span
                  className="world-creation-reason"
                  role="status"
                  style={{ left: anchor.x - 90, top: anchor.deskY + 48 }}
                >
                  {reason}
                </span>
              ) : null}
            </Fragment>
          );
        })}
    </div>
  );
}
