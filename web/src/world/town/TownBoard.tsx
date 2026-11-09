import { usageStopText } from "../../../../shared/usageStop";
import { useState, type ReactNode } from "react";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
} from "../officeObservability";
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
 * The Town board counts the whole town from the Town summary (townSummary.ts):
 * every building's agents, whichever rooms and desks the scene has admitted.
 */
export function TownBoard({
  counts,
  usageStore,
  onOpenSummary,
  sinceYouLeft,
}: {
  counts: TownSummary["counts"];
  usageStore?: TownUsageStore;
  onOpenSummary?: () => void;
  /** "Since you left" after a return: on the sign, and under the phone chip. */
  sinceYouLeft?: { board: ReactNode; chip: ReactNode };
}) {
  const expenses = townCityExpenses(useTownExpensesUsage(usageStore));
  // Phones show a compact chip; it opens the full board in place.
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };
  const population = `${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} in ${counts.buildings} ${counts.buildings === 1 ? "building" : "buildings"}`;
  // Subscription fuel: each harness's limit windows, from harness usage.
  const usage = useTownLimits();
  const now = Date.now();
  const limits = townLimits(usage);
  const gauges = townFuelGauges(limits, now);
  const notes = townFuelNotes(limits, gauges);
  const lowest = townFuelLowest(gauges);
  const summary = `${counts.working} working, ${counts.needsYou} need you, ${counts.finished} done, ${counts.quiet} quiet${
    counts.outOfFuel ? `, ${counts.outOfFuel} out of fuel` : ""
  }; ${population}${lowest ? `; ${townFuelLowestText(lowest, now)}` : ""}`;
  return (
    <>
      <button
        type="button"
        className="town-board-chip"
        // With a summary to open, the chip opens it; otherwise the board.
        {...(onOpenSummary
          ? { "aria-haspopup": "dialog" as const }
          : { "aria-expanded": open, "aria-controls": "town-board" })}
        aria-label={`${onOpenSummary ? "Town summary" : "Town board"}: ${summary}`}
        title={
          onOpenSummary
            ? "Open the Town summary"
            : open
              ? "Hide the Town board"
              : "Show the Town board"
        }
        onClick={() =>
          onOpenSummary ? onOpenSummary() : setOpen((value) => !value)
        }
        onKeyDown={closeOnEscape}
      >
        <span data-status="working">{counts.working}</span>
        <span data-status="blocked">!{counts.needsYou}</span>
        <span data-status="done">✓{counts.finished}</span>
        {lowest ? <TownFuelChip lowest={lowest} now={now} /> : null}
      </button>
      {sinceYouLeft?.chip}
      <div
        id="town-board"
        className="town-board"
        data-open={open}
        role="group"
        aria-label="Town board"
        onKeyDown={closeOnEscape}
      >
        <div className="town-board-title">
          TOWN BOARD
          {onOpenSummary ? (
            <button
              type="button"
              className="town-board-open"
              onClick={onOpenSummary}
            >
              Summary
            </button>
          ) : null}
        </div>
        {sinceYouLeft?.board}
        <TownBoardCounts counts={counts} />
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

/** The board's agent numbers, one short word per column: busy, waiting, done and quiet. */
function TownBoardCounts({ counts }: { counts: TownSummaryCounts }) {
  return (
    <dl className="town-board-counts">
      <div>
        <dt>Busy</dt>
        <dd>{counts.working}</dd>
      </div>
      <div>
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
