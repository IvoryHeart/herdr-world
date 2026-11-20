import { useState, type CSSProperties, type ReactNode, type Ref } from "react";
import { Coins } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { formatOfficeUsage } from "../officeObservability";
import { TOWN_TILE as T } from "./townLayout";
import { TOWN_CITY_BOARD_GAP, type TownCenterLot } from "./townCenter";
import {
  townUsageStore,
  type TownUsageStore,
  type TownUsageWindow,
} from "./townPlaceUsage";
import {
  TOWN_WINDOW_LABEL,
  townCityExpenses,
  townCoverageCaveats,
  townExpenseText,
  townHostExpenses,
  townUsd,
  useTownExpensesUsage,
  type TownExpenseTotal,
  type TownCityExpenses,
  type TownHostExpenses,
} from "./townExpenses";
import { TownExpenseCaveats } from "./TownExpenseCaveats";
import "./townExpenses.css";

const WAITING_TEXT = {
  loading: "Reading usage…",
  unavailable: "Usage unavailable",
  stale: "out of date",
  "no-data": "no data",
} as const;

/** The figures line, or what stands in for it. */
function Headline({
  span,
  expenses,
}: {
  span: TownUsageWindow;
  expenses: TownCityExpenses | TownHostExpenses;
}) {
  return (
    <p className="town-expenses-headline">
      <span>{TOWN_WINDOW_LABEL[span]}</span>
      {" · "}
      <b>
        {expenses.status === "ready"
          ? townExpenseText(expenses.total)
          : WAITING_TEXT[expenses.status]}
      </b>
    </p>
  );
}

/** A board on its posts, readable at any width. */
function Board({
  label,
  className,
  style,
  boardRef,
  children,
}: {
  label: string;
  className: string;
  style?: CSSProperties;
  /** The board, measured to keep other boards off it. */
  boardRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <section
      ref={boardRef}
      className={`town-expenses ${className}`}
      style={style}
      role="group"
      aria-label={label}
    >
      <div className="town-expenses-panel">{children}</div>
      <span className="town-expenses-posts" aria-hidden="true" />
    </section>
  );
}

/** A listed room: its tokens, and its estimate when it has one. */
const townRoomText = (total: TownExpenseTotal) =>
  `${formatOfficeUsage(total.tokens)}${
    total.price === "priced" && total.costUsd !== null
      ? ` · ${townUsd(total.costUsd)}`
      : ""
  }`;

/** The figures in words, for a folded sign's name. */
const spokenText = (expenses: TownCityExpenses | TownHostExpenses) =>
  expenses.status === "ready"
    ? townExpenseText(expenses.total)
    : WAITING_TEXT[expenses.status];

const SIGN_WAITING = {
  loading: "…",
  unavailable: "n/a",
  stale: "old",
  "no-data": "no data",
};

/** A folded sign's few characters: the cost, else the tokens. */
const signText = (expenses: TownCityExpenses | TownHostExpenses) => {
  if (expenses.status !== "ready") return SIGN_WAITING[expenses.status];
  const { total } = expenses;
  if (!total.records) return "none";
  return total.price === "priced" && total.costUsd !== null
    ? townUsd(total.costUsd)
    : `${formatOfficeUsage(total.tokens)} tok`;
};

/**
 * The city expenses billboard: the whole World's tokens and estimated cost,
 * today or over 7 days. It stands on the lawn above the town center, never
 * over it, on a phone's stacked town too (#1033).
 */
export function TownCityBillboard({
  center,
  boardRef,
  stores = townUsageStore,
}: {
  center: TownCenterLot;
  boardRef?: Ref<HTMLElement>;
  stores?: (span: TownUsageWindow) => TownUsageStore;
}) {
  const [span, setSpan] = useState<TownUsageWindow>("today");
  const expenses = townCityExpenses(useTownExpensesUsage(stores(span)));
  return (
    <Board
      label="City expenses"
      className="town-expenses-city"
      style={{
        left: (center.x + center.w / 2) * T,
        top: center.y * T - TOWN_CITY_BOARD_GAP,
      }}
      boardRef={boardRef}
    >
      <header className="town-expenses-title">
        <span>CITY EXPENSES</span>
        <span
          className="town-expenses-window"
          role="group"
          aria-label="Expenses window"
        >
          {(["today", "7d"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={span === option}
              onClick={() => setSpan(option)}
            >
              {TOWN_WINDOW_LABEL[option]}
            </button>
          ))}
        </span>
      </header>
      <Headline span={span} expenses={expenses} />
      {expenses.status === "ready" ? (
        <TownExpenseCaveats
          caveats={townCoverageCaveats(
            expenses.coverage,
            expenses.unattributed,
            "pane",
          )}
        />
      ) : null}
    </Board>
  );
}

/**
 * A building's expenses, part of its reception board: the host's totals today
 * and its costliest rooms under the queue. On a phone, where the reception is
 * compact, they fold to a sign in its title that opens them.
 */
export function TownReceptionExpenses({
  connectionId,
  hostLabel,
  roomLabel,
  folded,
  store = townUsageStore("today"),
}: {
  connectionId: string;
  hostLabel: string;
  /** A room's name by its workspace, or null for one Town no longer has. */
  roomLabel(workspaceId: string, generation: number): string | null;
  folded: boolean;
  store?: TownUsageStore;
}) {
  const expenses = townHostExpenses(useTownExpensesUsage(store), connectionId);
  const label = `${hostLabel} expenses`;
  const details = (
    <>
      <p className="town-expenses-headline">
        <b>{spokenText(expenses)}</b>
      </p>
      {expenses.status === "ready" && expenses.rooms.length ? (
        <ol className="town-expenses-rooms" aria-label="Top rooms by spend">
          {expenses.rooms.map((room) => (
            <li key={room.workspaceId}>
              <span>
                {roomLabel(room.workspaceId, room.generation) ?? "closed room"}
              </span>
              <b>{townRoomText(room.total)}</b>
            </li>
          ))}
          {expenses.moreRooms ? (
            <li className="town-expenses-more">
              +{expenses.moreRooms} more{" "}
              {expenses.moreRooms === 1 ? "room" : "rooms"}
            </li>
          ) : null}
        </ol>
      ) : null}
      {expenses.status === "ready" ? (
        <TownExpenseCaveats
          caveats={townCoverageCaveats(
            expenses.coverage,
            expenses.unattributed,
            "room",
          )}
        />
      ) : null}
    </>
  );
  if (!folded)
    return (
      <section
        className="town-reception-expenses"
        role="group"
        aria-label={label}
      >
        <header className="town-reception-expenses-title">
          EXPENSES TODAY
        </header>
        {details}
      </section>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="town-expenses-sign"
          aria-label={`${label}: ${spokenText(expenses)}. Open`}
          title={label}
        >
          <Coins size={12} aria-hidden="true" />
          <span>{signText(expenses)}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-expenses-popover"
        collisionPadding={8}
        aria-label={label}
      >
        <div className="town-expenses-panel">
          <header className="town-expenses-title">
            <span>EXPENSES TODAY</span>
          </header>
          {details}
        </div>
      </PopoverContent>
    </Popover>
  );
}
