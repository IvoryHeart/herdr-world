import { useMemo, useState } from "react";
import {
  formatOfficeCost,
  formatOfficeModelNames,
  formatOfficeUsage,
  type OfficeObservability,
} from "../officeObservability";
import type { TownModel } from "./townModel";
import { townSummary, type TownSummary } from "./townSummary";
import { townCalls, unseenTownCompletions } from "./TownRail";

export function TownBoard({
  model,
  observability,
  summaryCounts,
  onOpenSummary,
}: {
  model: TownModel;
  observability: OfficeObservability;
  summaryCounts?: TownSummary["counts"];
  onOpenSummary?: () => void;
}) {
  // The scene admits only some rooms; even the standalone board must use
  // the complete projection and the same summary code as the Town window.
  const totals = useMemo(() => {
    if (summaryCounts) return summaryCounts;
    const office = model.projection;
    const entries = new Map(
      office.roster.map((entry) => [entry.agent.key, entry]),
    );
    const calls = townCalls(
      office.roster,
      new Map(),
      unseenTownCompletions(office.roster, new Set()),
      (key) => entries.get(key),
      office.generatedAt,
    );
    return townSummary(office, calls, observability).counts;
  }, [model.projection, summaryCounts, observability]);
  const counts = {
    working: totals.working,
    blocked: totals.needsYou,
    done: totals.finished,
  };
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
  const summary = `${counts.working} working, ${counts.blocked} need you, ${counts.done} done`;
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
        <span data-status="blocked">!{counts.blocked}</span>
        <span data-status="done">✓{counts.done}</span>
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
            <dd>{counts.blocked}</dd>
          </div>
          <div>
            <dt>Done</dt>
            <dd>{counts.done}</dd>
          </div>
        </dl>
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
