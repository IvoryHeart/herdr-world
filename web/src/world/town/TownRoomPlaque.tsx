import type { CSSProperties } from "react";
import { ChevronsDown, ChevronsUp, Pencil, Trash2 } from "lucide-react";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import {
  TOWN_PRESENTATION_BOUNDS,
  type OfficeRoom,
} from "../herdrOfficeProjection";
import type { PlaceColorChoice, TownRoomActions } from "./TownCanvas";
import type { TownRoomCounts } from "./townModel";
import "./townRoomPlaque.css";

/** Constant-size text within the room's projected width, with optional actions below. */
export function TownRoomPlaque({
  room,
  label,
  width,
  counts,
  overflow,
  color,
  actions,
}: {
  room: OfficeRoom;
  label: string;
  width: number;
  counts: Pick<TownRoomCounts, "agents" | "working" | "blocked">;
  overflow: number;
  color: PlaceColorChoice | null;
  actions: TownRoomActions;
}) {
  const folded = room.deskFold === "folded";
  const active = counts.working + counts.blocked;
  const activityLabel = `${active} of ${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} active: ${counts.working} working, ${counts.blocked} waiting on you`;
  return (
    <div
      className="town-room-plaque"
      style={{ "--room-w": `${width}px` } as CSSProperties}
      role="group"
      aria-label={`${label}: ${activityLabel}`}
      tabIndex={0}
      onPointerDown={(event) => {
        if (event.pointerType === "touch")
          event.currentTarget.focus({ preventScroll: true });
      }}
    >
      <div className="town-room-plaque-heading">
        {color ? (
          <ColorSwatchButton
            className="town-plaque-action town-place-color"
            label={`Colour of room ${label}`}
            {...color}
          />
        ) : null}
        <span className="town-room-plaque-name" title={label}>
          {label}
        </span>
        {room.deskFold && actions.onToggleFold ? (
          <button
            className="world-room-overlay-action town-plaque-action town-room-fold"
            type="button"
            aria-expanded={!folded}
            aria-label={
              folded
                ? `Expand room ${label} toward ${Math.min(room.observedDeskCount, TOWN_PRESENTATION_BOUNDS.desksPerRoom)} desks`
                : `Fold room ${label} to its busiest desks`
            }
            title={
              folded
                ? `Expand toward ${Math.min(room.observedDeskCount, TOWN_PRESENTATION_BOUNDS.desksPerRoom)} desks; protected desks stay visible`
                : "Show only the busiest desks"
            }
            onClick={() => actions.onToggleFold?.(room.key)}
          >
            {folded ? (
              <ChevronsDown size={12} aria-hidden="true" />
            ) : (
              <ChevronsUp size={12} aria-hidden="true" />
            )}
            <span>{folded ? `+${overflow}` : "Fold"}</span>
          </button>
        ) : null}
        <span
          className={`town-room-plaque-count${active === 0 ? " is-inactive" : ""}`}
          title={activityLabel}
          aria-label={activityLabel}
        >
          <span>{active}</span>
          <span className="town-room-plaque-total">/{counts.agents}</span>
        </span>
        {counts.blocked ? (
          <span className="town-room-plaque-badge">!{counts.blocked}</span>
        ) : null}
      </div>
      <div
        className="town-room-plaque-actions"
        role="group"
        aria-label={`Room actions for ${label}`}
      >
        <button
          className="world-room-overlay-action world-room-overlay-action-rename town-plaque-action"
          type="button"
          aria-label={`Rename room ${label}`}
          title={`Rename ${label}`}
          disabled={!actions.canRenameRoom(room.key)}
          onClick={() => actions.onRenameRoom(room.key)}
        >
          <Pencil size={14} aria-hidden="true" />
        </button>
        <button
          className="world-room-overlay-action world-room-overlay-action-danger town-plaque-action"
          type="button"
          aria-label={`Close room ${label}`}
          title={`Close ${label}`}
          disabled={!actions.canCloseRoom(room.key)}
          onClick={() => actions.onCloseRoom(room.key)}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
