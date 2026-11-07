import { useState, type CSSProperties, type ReactNode } from "react";
import { Coins } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover";
import { formatOfficeUsage } from "../officeObservability";
import { TOWN_TILE as T } from "./townLayout";
import type { TownCenterLot } from "./townCenter";
import {
  townUsageStore,
  type TownUsageStore,
  type TownUsageWindow,
} from "./townPlaceUsage";
import {
  TOWN_WINDOW_LABEL,
  townCityExpenses,
  townCoverageNotes,
  townExpenseText,
  townHostExpenses,
  townUsd,
  useTownExpensesUsage,
  type TownExpenseTotal,
  type TownCityExpenses,
  type TownHostExpenses,
} from "./townExpenses";
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

function Notes({ notes }: { notes: readonly string[] }) {
  return notes.length ? (
    <p className="town-expenses-notes">{notes.join(" · ")}</p>
  ) : null;
}

/**
 * A board on its posts, or on a phone a sign that opens it: the boards stay
 * readable at any width.
 */
function Board({
  folded,
  label,
  summary,
  sign,
  className,
  style,
  children,
}: {
  folded: boolean;
  label: string;
  /** The headline figures in words, the folded sign's name. */
  summary: string;
  /** The folded sign's short text. */
  sign: string;
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  if (!folded)
    return (
      <section
        className={`town-expenses ${className}`}
        style={style}
        role="group"
        aria-label={label}
      >
        <div className="town-expenses-panel">{children}</div>
        <span className="town-expenses-posts" aria-hidden="true" />
      </section>
    );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`town-expenses-sign ${className}`}
          style={style}
          aria-label={`${label}: ${summary}. Open`}
          title={label}
        >
          <Coins size={12} aria-hidden="true" />
          <span>{sign}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="town-expenses-popover"
        collisionPadding={8}
        aria-label={label}
      >
        <div className="town-expenses-panel">{children}</div>
      </PopoverContent>
    </Popover>
  );
}

/** A listed room: its tokens, and its estimate when it has one. */
const townRoomText = (total: TownExpenseTotal) =>
  `${formatOfficeUsage(total.tokens)}${
    total.price === "priced" && total.costUsd !== null
      ? ` · ${townUsd(total.costUsd)}`
      : ""
  }`;

/** The figures in words, for the folded sign's name. */
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

/** The folded sign's few characters: the cost, else the tokens. */
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
 * today or over 7 days. It stands by the first street across from the town
 * center, or on a phone, where the center tops the stacked town, folds to a
 * sign in the center's empty corner beside its tower.
 */
export function TownCityBillboard({
  center,
  street,
  folded,
  stores = townUsageStore,
}: {
  center: TownCenterLot;
  /** The top row of the street the billboard stands beside. */
  street: number;
  folded: boolean;
  stores?: (span: TownUsageWindow) => TownUsageStore;
}) {
  const [span, setSpan] = useState<TownUsageWindow>("today");
  const expenses = townCityExpenses(useTownExpensesUsage(stores(span)));
  const style = folded
    ? { left: (center.x + 4) * T, top: (center.y + 2) * T }
    : { left: (center.x + center.w / 2) * T, top: street * T - 4 };
  return (
    <Board
      folded={folded}
      label="City expenses"
      summary={`${TOWN_WINDOW_LABEL[span]} ${spokenText(expenses)}`}
      sign={signText(expenses)}
      className="town-expenses-city"
      style={style}
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
        <Notes
          notes={townCoverageNotes(expenses.coverage, expenses.unattributed)}
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
        <Notes
          notes={townCoverageNotes(expenses.coverage, expenses.unattributed)}
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
