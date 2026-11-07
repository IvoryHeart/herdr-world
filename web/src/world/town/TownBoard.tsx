import { useState, type ReactNode } from "react";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
  type OfficeObservability,
} from "../officeObservability";
import type {
  TownPlaceSummary,
  TownSummary,
  TownSummaryCounts,
} from "./townSummary";
import type { TownPlaceEconomy } from "./townPlaceUsage";

/**
 * The Town board counts the whole town from the Town summary (townSummary.ts):
 * every building's agents, whichever rooms and desks the scene has admitted.
 */
export function TownBoard({
  counts,
  observability,
  onOpenSummary,
  sinceYouLeft,
}: {
  counts: TownSummary["counts"];
  observability: OfficeObservability;
  onOpenSummary?: () => void;
  /** "Since you left" after a return: on the sign, and under the phone chip. */
  sinceYouLeft?: { board: ReactNode; chip: ReactNode };
}) {
  const available =
    observability.health !== "unavailable" && observability.sourceCount > 0;
  // Phones show a compact chip; it opens the full board in place.
  const [open, setOpen] = useState(false);
  const closeOnEscape = (event: React.KeyboardEvent) => {
    if (open && event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  };
  const population = `${counts.agents} ${counts.agents === 1 ? "agent" : "agents"} in ${counts.buildings} ${counts.buildings === 1 ? "building" : "buildings"}`;
  const summary = `${counts.working} working, ${counts.needsYou} need you, ${counts.finished} done, ${counts.quiet} quiet; ${population}`;
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
        </p>
        <TownBoardEconomy
          {...(available
            ? {
                cost: formatOfficeCost(observability.totalCostUsd),
                detail: `${formatOfficeUsage(observability.totalUsage)} tokens${
                  observability.models.length
                    ? ` · ${formatOfficeModelNames(observability.models)}`
                    : ""
                }`,
              }
            : {
                detail:
                  "No cost data. Configure a metrics provider in settings.",
              })}
        />
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

/** The board's economy numbers: a cost, then tokens and models, or why not. */
function TownBoardEconomy({
  label = "ECONOMY",
  cost,
  detail,
}: {
  label?: string;
  cost?: string;
  detail: string;
}) {
  return (
    <div className="town-board-economy">
      <span>{label}</span>
      {cost === undefined ? null : <b>{cost}</b>}
      <small>{detail}</small>
    </div>
  );
}

const PLACE_ECONOMY: Record<
  Exclude<TownPlaceEconomy["status"], "ready">,
  string
> = {
  loading: "Reading today's usage…",
  unavailable: "Usage is unavailable right now.",
  none: "No usage recorded here today.",
};

/**
 * A room's or table's card: the Town board without its agents list, for
 * that place. The agent numbers are its part of the Town summary; the
 * economy numbers are today's harness usage there (townPlaceUsage.ts), since
 * the board's metrics provider has no places in it.
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
      </p>
      {economy.status === "ready" ? (
        <TownBoardEconomy
          label="ECONOMY TODAY"
          cost={formatOfficeCost(economy.costUsd, "estimated")}
          detail={`${formatOfficeUsage(economy.tokens)} tokens${
            economy.models.length
              ? ` · ${formatOfficeModelNames(economy.models.map((model) => ({ model })))}`
              : ""
          }${economy.partial ? " · partial" : ""}`}
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
