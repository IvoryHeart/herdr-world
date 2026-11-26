import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowRight,
  GitBranch,
  Move,
  Pencil,
  Trash2,
} from "lucide-react";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import type { OfficeRoom } from "../herdrOfficeProjection";
import type { PlaceColorChoice, TownRoomActions } from "./TownCanvas";
import type { TownRoomCounts } from "./townModel";
import type { TownPlaceSummary } from "./townSummary";
import { TownPlaceSummaryCard } from "./TownBoard";
import {
  townPlaceEconomy,
  townUsageStore,
  useTownCurrentUsage,
  type TownUsagePlace,
} from "./townPlaceUsage";
import { TownRuntimeIcon } from "./TownRuntimeIcon";
import { townPlaqueCard, useTownPlaqueCardOpen } from "./townPlaqueCard";
import "./townRoomPlaque.css";

/** A place card's content: its summary is made when the card first opens. */
export type TownPlaceCardContent = {
  summary(): TownPlaceSummary;
  /** The Herdr workspace or tab whose usage the card shows. */
  usage: TownUsagePlace;
};

/**
 * The card a place's name opens (a room's on a click or tap of its plaque, a
 * table's on hover, focus or a tap): its part of the Town summary and its
 * economy today. Nothing is built or read until the card
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
  const usage = useTownCurrentUsage();
  return (
    <TownPlaceSummaryCard
      place={content.summary()}
      economy={townPlaceEconomy(usage, content.usage)}
    />
  );
}

/**
 * A room zoomed out to its overview card, where its name is too small to
 * point at: a mouse anywhere over the room on the canvas (`open`), or over
 * its card, shows the room's summary under the card, as its plaque does
 * further in. The summary is built when it first shows.
 */
export function TownRoomOverviewSummary({
  card,
  open: shown,
  children,
}: {
  card: TownPlaceCardContent;
  /** The mouse is over the room on the canvas. */
  open: boolean;
  /** The room's overview card. */
  children: ReactNode;
}) {
  const { opened, open } = usePlaceCard();
  useEffect(() => {
    if (shown) open();
  });
  return (
    <div
      className={`town-room-overview${shown ? " is-open" : ""}`}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") open();
      }}
    >
      {children}
      <div
        className="town-place-card town-room-overview-card"
        aria-hidden="true"
      >
        {opened || shown ? <TownPlaceCardSummary content={card} /> : null}
      </div>
    </div>
  );
}

/**
 * Constant-size text standing just above the room's floor, within its
 * projected width, so no desk or agent of its top row sits under it. A click
 * or tap on the title (Enter or Space when focused) opens one card below it:
 * the room's summary, then Move before, the Move handle, Move after, Rename
 * and Close. Hover and focus alone open nothing; another click on the title,
 * a press outside the plaque or Escape closes the card, and only one room's
 * card is open at a time (townPlaqueCard.ts). Dragging the handle, or the
 * name (a touch hold on a phone), carries the room anywhere in its building;
 * a tap on the name reaches the card through the town's gesture
 * (townInteraction.ts), so a drag never opens it.
 */
export function TownRoomPlaque({
  room,
  label,
  width,
  counts,
  color,
  actions,
  card,
  onNamePress,
}: {
  room: OfficeRoom;
  label: string;
  width: number;
  counts: Pick<TownRoomCounts, "agents" | "working" | "blocked"> &
    Partial<Pick<TownRoomCounts, "outOfFuel">>;
  color: PlaceColorChoice | null;
  actions: TownRoomActions;
  /** The room's summary for its card; without it the card holds the actions. */
  card?: TownPlaceCardContent;
  /**
   * A press on the name or the Move handle, passed to the town: a drag there
   * carries the room, and a tap on the name toggles the card.
   */
  onNamePress?(
    event: PointerEvent,
    press: "plaque-name" | "plaque-move",
  ): boolean;
}) {
  const { opened, open } = usePlaceCard();
  const shown = useTownPlaqueCardOpen(room.key);
  const plaque = useRef<HTMLDivElement>(null);
  // The town took the name's last press: its tap toggles the card there.
  const namePressTaken = useRef(false);
  useEffect(() => {
    if (shown) open();
  });
  useEffect(() => {
    if (!shown) return;
    const outside = (event: PointerEvent) => {
      if (!plaque.current?.contains(event.target as Node))
        townPlaqueCard.close(room.key);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      townPlaqueCard.close(room.key);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [shown, room.key]);
  useEffect(() => () => townPlaqueCard.close(room.key), [room.key]);
  const movable = Boolean(
    actions.onMoveRoom && actions.canMoveRoom?.(room.key),
  );
  const before = movable ? actions.roomMoveNeighbor?.(room.key, -1) : null;
  const after = movable ? actions.roomMoveNeighbor?.(room.key, 1) : null;
  const carry =
    (press: "plaque-name" | "plaque-move") =>
    (event: ReactPointerEvent<HTMLElement>) => {
      if (event.pointerType === "mouse" ? event.button === 0 : event.isPrimary)
        namePressTaken.current =
          (onNamePress?.(event.nativeEvent, press) ?? false) &&
          press === "plaque-name";
    };
  const active = counts.working + counts.blocked;
  // Agents out of fuel are not active: they wait for their limit to reset.
  const activityLabel = `${active} of ${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} active: ${counts.working} working, ${counts.blocked} waiting on you${
    counts.outOfFuel ? `, ${counts.outOfFuel} out of fuel` : ""
  }`;
  // In a building of more than one runtime, the room's runtime tells two
  // rooms of the same name apart (townBuildings.ts): an icon beside the
  // name, so the name reads first, and words in its tooltip and label.
  const tag = room.runtimeTag;
  return (
    <div
      ref={plaque}
      className={`town-room-plaque${shown ? " is-open" : ""}`}
      style={{ "--room-w": `${width}px` } as CSSProperties}
      role="group"
      aria-label={`${label}${tag ? ` (${tag})` : ""}: ${activityLabel}`}
      aria-expanded={shown}
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          (event.key !== "Enter" && event.key !== " ")
        )
          return;
        event.preventDefault();
        townPlaqueCard.toggle(room.key);
      }}
    >
      <div
        className="town-room-plaque-heading"
        // Each press starts untaken; the name's own press may take it.
        onPointerDownCapture={() => {
          namePressTaken.current = false;
        }}
        onClick={(event) => {
          // The town's gesture already toggled the card for a pressed name.
          const taken = namePressTaken.current && event.detail > 0;
          namePressTaken.current = false;
          if (taken || (event.target as Element).closest?.("button")) return;
          townPlaqueCard.toggle(room.key);
        }}
      >
        {color ? (
          <ColorSwatchButton
            className="town-plaque-action town-place-color"
            label={`Colour of room ${label}`}
            {...color}
          />
        ) : null}
        {tag && room.runtimeKind ? (
          <TownRuntimeIcon kind={room.runtimeKind} tag={tag} />
        ) : null}
        <span
          className={`town-room-plaque-name${movable ? " is-movable" : ""}${
            room.derivedLabelHint ? " is-derived" : ""
          }`}
          title={
            room.derivedLabelHint ? `${label}: ${room.derivedLabelHint}` : label
          }
          onPointerDown={
            movable && onNamePress ? carry("plaque-name") : undefined
          }
        >
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
        {tag ? (
          <p className="town-room-plaque-runtime-line">Runtime: {tag}</p>
        ) : null}
        {card && (opened || shown) ? (
          <TownPlaceCardSummary content={card} />
        ) : null}
        <div
          className="town-room-plaque-actions"
          role="group"
          aria-label={`Room actions for ${label}`}
        >
          {before ? (
            <button
              className="world-room-overlay-action town-plaque-action"
              type="button"
              aria-label={`Move room ${label} before ${before.label}`}
              title={`Move before ${before.label}`}
              onClick={() => actions.onMoveRoom?.(room.key, -1)}
            >
              <ArrowLeft size={14} aria-hidden="true" />
            </button>
          ) : null}
          {movable && onNamePress ? (
            <button
              className="world-room-overlay-action town-plaque-action town-plaque-move"
              type="button"
              aria-label={`Move room ${label}: drag it anywhere in its building`}
              title={`Drag to move ${label}`}
              onPointerDown={carry("plaque-move")}
            >
              <Move size={14} aria-hidden="true" />
            </button>
          ) : null}
          {after ? (
            <button
              className="world-room-overlay-action town-plaque-action"
              type="button"
              aria-label={`Move room ${label} after ${after.label}`}
              title={`Move after ${after.label}`}
              onClick={() => actions.onMoveRoom?.(room.key, 1)}
            >
              <ArrowRight size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="world-room-overlay-action world-room-overlay-action-rename town-plaque-action"
            type="button"
            aria-label={`Rename room ${label}`}
            title={actions.roomViewOnly?.(room.key) ?? `Rename ${label}`}
            disabled={!actions.canRenameRoom(room.key)}
            onClick={() => actions.onRenameRoom(room.key)}
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          {actions.canManageWorktrees?.(room.key) ? (
            <button
              className="world-room-overlay-action town-plaque-action"
              type="button"
              aria-label={`Worktrees of room ${label}`}
              title="Worktrees: new, open or remove"
              onClick={() => actions.onWorktrees?.(room.key)}
            >
              <GitBranch size={14} aria-hidden="true" />
            </button>
          ) : null}
          <button
            className="world-room-overlay-action world-room-overlay-action-danger town-plaque-action"
            type="button"
            aria-label={`Close room ${label}`}
            title={actions.roomViewOnly?.(room.key) ?? `Close ${label}`}
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
