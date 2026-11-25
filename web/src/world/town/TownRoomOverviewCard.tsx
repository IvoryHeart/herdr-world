import { useRef, type CSSProperties } from "react";
import type { OfficeRoom } from "../herdrOfficeProjection";
import { townRoomCardMeta } from "./townNameplates";
import type { TownRoomCounts } from "./townModel";
import { TownRuntimeIcon } from "./TownRuntimeIcon";
import type { TownRoomPress } from "./TownWorldLayer";

/**
 * A room zoomed out to its slim overview card: its name, waiting badge and
 * status bar, and in a building of more than one runtime its runtime icon.
 * The card and the icon stand side by side in one frame, since the icon takes
 * its own presses (a tap names the runtime and zooms nowhere) and a button
 * cannot hold another; the card keeps a slot where the icon stands over it.
 */
export function TownRoomOverviewCard({
  room,
  label,
  counts: c,
  overflow,
  width,
  carpet,
  selected,
  onPress,
  onActivate,
}: {
  room: OfficeRoom;
  label: string;
  counts: TownRoomCounts;
  /** Desks hidden by the room's fold. */
  overflow: number;
  /** The room's width in world pixels. */
  width: number;
  carpet: string;
  selected: boolean;
  /** A press on the card, passed to the town: true when the town took it. */
  onPress?(event: PointerEvent, press: TownRoomPress): boolean;
  onActivate(): void;
}) {
  // A card press the town took ends as the town's tap; only keyboard
  // activation (or an untaken press) zooms through the card's own click.
  const pressTaken = useRef(false);
  const total = Math.max(1, c.agents);
  const runtime =
    room.runtimeTag && room.runtimeKind
      ? { kind: room.runtimeKind, tag: room.runtimeTag }
      : null;
  return (
    <div
      className="town-room-card-frame"
      style={{ "--room-w": `${width}px` } as CSSProperties}
    >
      <button
        type="button"
        className={`town-room-card${c.blocked ? " town-room-card-waiting" : ""}${selected ? " town-selected" : ""}${runtime ? " has-runtime" : ""}`}
        style={
          {
            "--carpet": carpet,
            // Presses pass to the town: a pan, or a hold that lifts the
            // table beneath.
            touchAction: "none",
          } as CSSProperties
        }
        aria-label={`${label}${runtime ? ` (${runtime.tag})` : ""}: ${c.desks} desks, ${c.working} working${c.blocked ? `, ${c.blocked} need you` : ""}${c.done ? `, ${c.done} done` : ""}. Zoom in.`}
        onPointerDown={(event) => {
          pressTaken.current =
            onPress?.(
              event.nativeEvent,
              (event.target as Element).closest?.(".town-room-card-name")
                ? "card-name"
                : "card",
            ) ?? false;
        }}
        onClick={(event) => {
          const taken = pressTaken.current && event.detail > 0;
          pressTaken.current = false;
          if (!taken) onActivate();
        }}
        tabIndex={-1}
      >
        {runtime ? (
          <span className="town-room-card-runtime-slot" aria-hidden="true" />
        ) : null}
        <span className="town-room-card-name">{label}</span>
        {c.blocked ? (
          <span className="town-room-card-badge">!{c.blocked}</span>
        ) : null}
        <span className="town-room-card-meta">
          {townRoomCardMeta(c, overflow)}
        </span>
        <span className="town-room-card-bar" aria-hidden="true">
          {(["working", "blocked", "done", "idle"] as const).map((status) =>
            c[status] ? (
              <i
                key={status}
                data-status={status}
                style={{ flexGrow: c[status] / total }}
              />
            ) : null,
          )}
        </span>
      </button>
      {runtime ? (
        <TownRuntimeIcon
          kind={runtime.kind}
          tag={runtime.tag}
          size={10}
          className="town-room-card-runtime"
        />
      ) : null}
    </div>
  );
}
