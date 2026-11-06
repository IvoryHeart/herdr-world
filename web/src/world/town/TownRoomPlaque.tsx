import type { CSSProperties } from "react";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import type { OfficeRoom } from "../herdrOfficeProjection";
import type { PlaceColorChoice } from "./TownCanvas";
import type { TownRoomCounts } from "./townModel";
import type { ShowTownPlaceSummary } from "./TownPlaceSummary";
import "./townRoomPlaque.css";

/** Constant-size text within the room's projected width; opens its actions/summary card. */
export function TownRoomPlaque({
  room,
  label,
  width,
  counts,
  color,
  onSummary,
}: {
  room: OfficeRoom;
  label: string;
  width: number;
  counts: Pick<TownRoomCounts, "agents" | "working" | "blocked">;
  color: PlaceColorChoice | null;
  onSummary?: ShowTownPlaceSummary;
}) {
  const summaryAnchor = (element: HTMLElement) =>
    element.getBoundingClientRect();
  const active = counts.working + counts.blocked;
  const activityLabel = `${active} of ${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} active: ${counts.working} working, ${counts.blocked} waiting on you`;
  return (
    <div
      className="town-room-plaque"
      style={{ "--room-w": `${width}px` } as CSSProperties}
      role="group"
      aria-label={`${label}: ${activityLabel}`}
      tabIndex={0}
      aria-haspopup="dialog"
      data-town-place-summary-trigger="room"
      onPointerEnter={(event) =>
        onSummary?.(room.key, summaryAnchor(event.currentTarget))
      }
      onPointerLeave={() => onSummary?.(null)}
      onFocus={(event) =>
        onSummary?.(room.key, summaryAnchor(event.currentTarget), true)
      }
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          onSummary?.(null);
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "touch") {
          event.currentTarget.focus({ preventScroll: true });
          onSummary?.(room.key, summaryAnchor(event.currentTarget), true);
        }
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
    </div>
  );
}
