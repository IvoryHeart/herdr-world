import { useState, type CSSProperties } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import type { OfficeRoom } from "../herdrOfficeProjection";
import type { PlaceColorChoice, TownRoomActions } from "./TownCanvas";
import type { TownRoomCounts } from "./townModel";
import type { TownPlaceSummary } from "./townSummary";
import { TownPlaceSummaryCard } from "./TownBoard";
import {
  townPlaceEconomy,
  townUsageStore,
  useTownUsage,
  type TownUsagePlace,
} from "./townPlaceUsage";
import "./townRoomPlaque.css";

/** A place card's content: its summary is made when the card first opens. */
export type TownPlaceCardContent = {
  summary(): TownPlaceSummary;
  /** The Herdr workspace or tab whose usage the card shows. */
  usage: TownUsagePlace;
};

/**
 * The card a place's name opens on hover, focus or a tap: its part of the
 * Town summary and its economy today. Nothing is built or read until the card
 * opens, so a dense town pays only for the names someone points at; each
 * opening refreshes the usage, at most once per the service's interval.
 */
export function usePlaceCard() {
  const [opened, setOpened] = useState(false);
  const open = () => {
    townUsageStore().request();
    if (!opened) setOpened(true);
  };
  return { opened, open };
}

export function TownPlaceCardSummary({
  content,
}: {
  content: TownPlaceCardContent;
}) {
  const usage = useTownUsage();
  return (
    <TownPlaceSummaryCard
      place={content.summary()}
      economy={townPlaceEconomy(usage, content.usage)}
    />
  );
}

/**
 * Constant-size text within the room's projected width. Hover, focus or a tap
 * opens one card below it: the room's summary, then Rename and Close.
 */
export function TownRoomPlaque({
  room,
  label,
  width,
  counts,
  color,
  actions,
  card,
}: {
  room: OfficeRoom;
  label: string;
  width: number;
  counts: Pick<TownRoomCounts, "agents" | "working" | "blocked">;
  color: PlaceColorChoice | null;
  actions: TownRoomActions;
  /** The room's summary for its card; without it the card holds the actions. */
  card?: TownPlaceCardContent;
}) {
  const { opened, open } = usePlaceCard();
  const active = counts.working + counts.blocked;
  const activityLabel = `${active} of ${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} active: ${counts.working} working, ${counts.blocked} waiting on you`;
  return (
    <div
      className="town-room-plaque"
      style={{ "--room-w": `${width}px` } as CSSProperties}
      role="group"
      aria-label={`${label}: ${activityLabel}`}
      tabIndex={0}
      onPointerEnter={open}
      onFocus={open}
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
      <div className="town-place-card town-room-plaque-card">
        {card && opened ? <TownPlaceCardSummary content={card} /> : null}
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
    </div>
  );
}
