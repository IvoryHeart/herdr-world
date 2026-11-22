import { usageStopText } from "../../../../shared/usageStop";
import { Activity, Hourglass } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
} from "../officeObservability";
import { HELP_TRY_EVENT } from "../../help/helpEvents";
import type {
  TownPlaceSummary,
  TownSummary,
  TownSummaryCounts,
} from "./townSummary";
import type { TownPlaceEconomy, TownUsageStore } from "./townPlaceUsage";
import {
  townPriceNote,
  townCityExpenses,
  townExpenseText,
  townCoverageCaveats,
  TOWN_PARTIAL_CAVEAT,
  type TownExpenseCaveat,
  townCostText,
  useTownExpensesUsage,
} from "./townExpenses";
import {
  townFuelGauges,
  townFuelNotes,
  townLimits,
  useTownLimits,
} from "./townLimits";
import {
  TownFuel,
  TownFuelChip,
  townFuelLowest,
  townFuelLowestText,
} from "./TownFuelGauge";
import { TownExpenseCaveats } from "./TownExpenseCaveats";

/**
 * Working agents whose sessions have not moved (townQuietWork.ts), under the
 * board's Busy count: "2 quiet 10 m+", which finds the first one.
 */
export type TownBoardQuiet = {
  count: number;
  minutes: number;
  onFind(anchor: { x: number; y: number }): void;
};

/**
 * What Town shows of its quiet working agents (useTownQuiet.ts): their keys,
 * for the hourglass, when each last moved, for its time, and the board's
 * line while any are quiet.
 */
export type TownQuietMarks = {
  keys: ReadonlySet<string>;
  /** When each quiet agent last moved, for the time beside its hourglass. */
  since?: ReadonlyMap<string, number>;
  board?: TownBoardQuiet;
};

/**
 * The Town board counts the whole town from the Town summary (townSummary.ts):
 * every building's agents, whichever rooms and desks the scene has admitted.
 */
export function TownBoard({
  counts,
  usageStore,
  onOpenSummary,
  sinceYouLeft,
  quiet,
  harnesses = [],
}: {
  counts: TownSummary["counts"];
  quiet?: TownBoardQuiet;
  /** The town's agents' harnesses: one without a reading is named. */
  harnesses?: TownSummary["harnesses"];
  usageStore?: TownUsageStore;
  onOpenSummary?: () => void;
  /** "Since you left" after a return: on the sign, and under the phone chip. */
  sinceYouLeft?: { board: ReactNode; chip: ReactNode };
}) {
  const expenses = townCityExpenses(useTownExpensesUsage(usageStore));
  // One compact indicator; the board is its popover: a tap or click pins
  // it open, a mouse over the indicator shows it, and Escape or a tap
  // outside closes it (#1006).
  const [pinned, setPinned] = useState(false);
  const [hovered, setHovered] = useState(false);
  const open = pinned || hovered;
  const chipRef = useRef<HTMLButtonElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const leaveTimer = useRef<number | undefined>(undefined);
  const close = () => {
    window.clearTimeout(leaveTimer.current);
    setPinned(false);
    setHovered(false);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        (chipRef.current?.contains(target) ||
          boardRef.current?.contains(target))
      )
        return;
      close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  // Help's Try for the quiet agents (town.help.ts) pins the board open, so
  // the ring lands on the Busy line rather than on the folded chip.
  const quietShown = Boolean(quiet && quiet.count > 0);
  useEffect(() => {
    if (!quietShown) return;
    const onTry = (event: Event) => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id === "town.quiet")
        setPinned(true);
    };
    window.addEventListener(HELP_TRY_EVENT, onTry);
    return () => window.removeEventListener(HELP_TRY_EVENT, onTry);
  }, [quietShown]);
  const hoverIn = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(leaveTimer.current);
    setHovered(true);
  };
  const hoverOut = (event: React.PointerEvent) => {
    if (event.pointerType !== "mouse") return;
    window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setHovered(false), 240);
  };
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      close();
    }
  };
  const population = `${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} in ${counts.buildings} ${counts.buildings === 1 ? "building" : "buildings"}`;
  // Subscription fuel: each harness's limit windows, from harness usage.
  const usage = useTownLimits();
  const now = Date.now();
  const limits = townLimits(usage);
  const gauges = townFuelGauges(limits, now);
  const notes = townFuelNotes(limits, gauges, harnesses);
  const lowest = townFuelLowest(gauges);
  const summary = `${counts.working} working, ${counts.needsYou} need you, ${counts.finished} done, ${counts.quiet} quiet${
    counts.outOfFuel ? `, ${counts.outOfFuel} out of fuel` : ""
  }; ${population}${lowest ? `; ${townFuelLowestText(lowest, now)}` : ""}`;
  // Only what needs action shows on the indicator: the waiting count, and
  // fuel once a current reading runs low (never a dimmed or stale one).
  const lowFuel = lowest && (lowest.window.low || lowest.window.reached);
  return (
    <>
      <button
        ref={chipRef}
        type="button"
        className="town-board-chip"
        data-help="town.board-chip"
        // Try finds the quiet line through the chip when the board was
        // not mounted to pin itself open (Try switched to Town first).
        data-help-opens={quietShown ? "town.quiet" : undefined}
        aria-expanded={open}
        aria-controls="town-board"
        aria-label={`Town board: ${summary}`}
        data-attention={counts.needsYou > 0}
        // A click pins the board a hover opened; the next one closes it.
        onClick={() => (pinned ? close() : setPinned(true))}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
        onKeyDown={closeOnEscape}
      >
        <Activity size={14} aria-hidden="true" />
        {counts.needsYou > 0 ? (
          <span data-status="blocked" data-attention="true">
            !{counts.needsYou}
          </span>
        ) : null}
        {lowFuel ? <TownFuelChip lowest={lowest} now={now} /> : null}
      </button>
      {sinceYouLeft?.chip}
      <div
        ref={boardRef}
        id="town-board"
        className="town-board"
        data-open={open}
        role="group"
        aria-label="Town board"
        onKeyDown={closeOnEscape}
        onPointerEnter={hoverIn}
        onPointerLeave={hoverOut}
      >
        <div className="town-board-title">
          TOWN BOARD
          {onOpenSummary ? (
            <button
              type="button"
              className="town-board-open"
              onClick={() => {
                close();
                onOpenSummary();
              }}
            >
              Summary
            </button>
          ) : null}
        </div>
        {sinceYouLeft?.board}
        <TownBoardCounts
          counts={counts}
          busyNote={
            quiet && quiet.count > 0 ? (
              <button
                type="button"
                className="town-board-quiet"
                data-help="town.quiet"
                aria-label={`Find the ${quiet.count} working ${
                  quiet.count === 1 ? "agent" : "agents"
                } with no progress for ${quiet.minutes} minutes or more`}
                title="Working, but the session has not moved"
                onClick={(event) => {
                  const box = event.currentTarget.getBoundingClientRect();
                  close();
                  quiet.onFind({ x: box.right, y: box.top + box.height / 2 });
                }}
              >
                <Hourglass size={11} aria-hidden="true" />
                {quiet.count} quiet {quiet.minutes} m+
              </button>
            ) : null
          }
        />
        <p className="town-board-population">
          {population}
          {counts.unknown ? ` · ${counts.unknown} unknown` : ""}
          {counts.outOfFuel ? ` · ${counts.outOfFuel} out of fuel` : ""}
        </p>
        <TownBoardEconomy
          label={
            expenses.status === "ready" && expenses.coverage.testData
              ? "ECONOMY TODAY · UTC · TEST DATA"
              : "ECONOMY TODAY · UTC · HARNESS LOGS"
          }
          cost={
            expenses.status === "ready" && expenses.total.price === "priced"
              ? (townCostText(expenses.total) ?? undefined)
              : undefined
          }
          caveats={
            expenses.status === "ready"
              ? townCoverageCaveats(
                  expenses.coverage,
                  expenses.unattributed,
                  "pane",
                )
              : undefined
          }
          detail={
            expenses.status === "ready"
              ? expenses.total.price === "priced"
                ? `${formatOfficeUsage(expenses.total.tokens)} tokens`
                : townExpenseText(expenses.total)
              : expenses.status === "loading"
                ? "Reading usage…"
                : expenses.status === "stale"
                  ? "Usage is out of date."
                  : expenses.status === "no-data"
                    ? "No usage data from hosts."
                    : "Usage unavailable"
          }
        />
        <TownFuel gauges={gauges} notes={notes} now={now} />
      </div>
    </>
  );
}

/**
 * The board's agent numbers, one short word per column: busy, waiting, done
 * and quiet. Only a waiting count above zero takes the attention colour.
 */
function TownBoardCounts({
  counts,
  busyNote = null,
}: {
  counts: TownSummaryCounts;
  /** A line under Busy: the quiet working agents and their find. */
  busyNote?: ReactNode;
}) {
  return (
    <dl className="town-board-counts">
      <div>
        <dt>Busy</dt>
        <dd>{counts.working}</dd>
        {busyNote ? <dd className="town-board-note">{busyNote}</dd> : null}
      </div>
      <div data-status="blocked" data-attention={counts.needsYou > 0}>
        <dt>Waiting</dt>
        <dd>{counts.needsYou}</dd>
      </div>
      <div>
        <dt>Done</dt>
        <dd>{counts.finished}</dd>
      </div>
      <div>
        <dt>Quiet</dt>
        <dd>{counts.quiet}</dd>
      </div>
    </dl>
  );
}

/**
 * The board's economy numbers: a cost, then tokens and models, or why not,
 * and one short caveat line explained on hover or tap.
 */
function TownBoardEconomy({
  label = "ECONOMY",
  cost,
  detail,
  caveats = [],
}: {
  label?: string;
  cost?: string;
  detail: string;
  caveats?: readonly TownExpenseCaveat[];
}) {
  return (
    <div className="town-board-economy">
      <span>{label}</span>
      {cost === undefined ? null : <b>{cost}</b>}
      <small>{detail}</small>
      <TownExpenseCaveats
        caveats={caveats}
        className="town-board-economy-caveats"
      />
    </div>
  );
}

const PLACE_ECONOMY: Record<
  Exclude<TownPlaceEconomy["status"], "ready">,
  string
> = {
  loading: "Reading today's usage…",
  unavailable: "Usage is unavailable right now.",
  stale: "Usage is out of date: it could not be refreshed.",
  none: "No usage recorded here today.",
  "no-data": "No usage data from this host.",
  limited:
    "Place detail limited; usage is included in city and building totals.",
};

/**
 * A room's or table's card: the Town board without its agents list, for
 * that place. The agent numbers are its part of the Town summary; the
 * economy numbers are today's harness usage there (townPlaceUsage.ts).
 */
export function TownPlaceSummaryCard({
  place,
  economy,
}: {
  place: TownPlaceSummary;
  economy: TownPlaceEconomy;
}) {
  const { counts } = place;
  return (
    <div className="town-place-summary">
      <TownBoardCounts counts={counts} />
      <p className="town-board-population">
        {counts.agents} {counts.agents === 1 ? "agent" : "agents"}
        {counts.unknown ? ` · ${counts.unknown} unknown` : ""}
        {counts.outOfFuel ? ` · ${counts.outOfFuel} out of fuel` : ""}
      </p>
      {place.fuel.map(({ label, stop }, index) => (
        <p key={index} className="town-place-fuel">
          {place.fuel.length > 1 ? `${label}: ` : ""}
          {usageStopText(stop, Date.now())}
        </p>
      ))}
      {economy.status === "ready" ? (
        <TownBoardEconomy
          label="ECONOMY TODAY"
          cost={
            economy.price === "priced"
              ? formatOfficeCost(economy.costUsd, "estimated")
              : undefined
          }
          detail={`${formatOfficeUsage(economy.tokens)} tokens${
            economy.models.length
              ? ` · ${formatOfficeModelNames(economy.models.map((model) => ({ model })))}`
              : ""
          }${economy.price === "priced" ? "" : ` · ${townPriceNote(economy.price)}`}`}
          caveats={economy.partial ? [TOWN_PARTIAL_CAVEAT] : []}
        />
      ) : (
        <TownBoardEconomy
          label="ECONOMY TODAY"
          detail={PLACE_ECONOMY[economy.status]}
        />
      )}
    </div>
  );
}
