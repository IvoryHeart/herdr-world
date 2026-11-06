import { useState } from "react";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
  type OfficeObservability,
} from "../officeObservability";
import type { TownSummary } from "./townSummary";

/**
 * The Town board counts the whole town from the Town summary (townSummary.ts):
 * every building's agents, whichever rooms and desks the scene has admitted.
 */
export function TownBoard({
  counts,
  observability,
  onOpenSummary,
}: {
  counts: TownSummary["counts"];
  observability: OfficeObservability;
  onOpenSummary?: () => void;
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
        <dl>
          <div>
            <dt>Working</dt>
            <dd>{counts.working}</dd>
          </div>
          <div>
            <dt>Need you</dt>
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
        <p className="town-board-population">
          {population}
          {counts.unknown ? ` · ${counts.unknown} unknown` : ""}
        </p>
        <div className="town-board-economy">
          <span>ECONOMY</span>
          {available ? (
            <>
              <b>{formatOfficeCost(observability.totalCostUsd)}</b>
              <small>
                {formatOfficeUsage(observability.totalUsage)} tokens
                {observability.models.length
                  ? ` · ${formatOfficeModelNames(observability.models)}`
                  : ""}
              </small>
            </>
          ) : (
            <small>
              No cost data. Configure a metrics provider in settings.
            </small>
          )}
        </div>
      </div>
    </>
  );
}
