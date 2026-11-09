import { useEffect, useRef, type ReactNode } from "react";
import {
  TownPlaceCardSummary,
  usePlaceCard,
  type TownPlaceCardContent,
} from "./TownRoomPlaque";
import { TownGroupSelectButton } from "./TownGroupCard";

/**
 * A table's nameplate and card. Hovering or tapping the table on the canvas
 * (`open`), or hovering, focusing or tapping the plate, opens the table's card
 * below it: its part of the Town summary, styled as the room plaques are. A
 * mouse click on the plate selects the table and a double click opens it, as
 * on the table itself; a tap only opens the card.
 */
export function TownDeskTitle({
  deskKey,
  label,
  card,
  open: shown = false,
  onSelect,
  onActivate,
  children,
}: {
  deskKey: string;
  label: string;
  card: TownPlaceCardContent;
  /** The table is hovered or tapped on the canvas beneath the plate. */
  open?: boolean;
  onSelect(key: string): void;
  onActivate(key: string): void;
  /** The plate's contents: the name and its work badge. */
  children?: ReactNode;
}) {
  const { opened, open } = usePlaceCard();
  const touched = useRef(false);
  // Once built, the card stays built: the pointer may leave the table for
  // the card itself, which keeps it open by hover.
  useEffect(() => {
    if (shown) open();
  });
  return (
    <div
      className={`town-desk-title${shown ? " is-open" : ""}`}
      role="group"
      aria-label={`Table ${label}`}
      tabIndex={-1}
      onFocus={open}
    >
      <span
        className="town-desk-tag"
        onPointerEnter={open}
        onPointerDown={(event) => {
          touched.current = event.pointerType === "touch";
          if (touched.current)
            (event.currentTarget.parentElement as HTMLElement).focus({
              preventScroll: true,
            });
        }}
        // The work badge is a link of its own.
        onClick={(event) => {
          if (!touched.current && !(event.target as Element).closest("a"))
            onSelect(deskKey);
        }}
        onDoubleClick={(event) => {
          if (!touched.current && !(event.target as Element).closest("a"))
            onActivate(deskKey);
        }}
      >
        {children}
      </span>
      <div className="town-place-card town-desk-card">
        {opened || shown ? <TownPlaceCardSummary content={card} /> : null}
        {opened || shown ? (
          // Select this table's agents; then taps add or remove agents.
          <TownGroupSelectButton deskKey={deskKey} />
        ) : null}
      </div>
    </div>
  );
}
