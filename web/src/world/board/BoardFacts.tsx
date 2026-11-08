/**
 * Town's facts on Board (#787), in Board's own way: a summary over the board,
 * a line on each host zone and workspace card, and what each agent is doing
 * on its tab card. Every figure is read from the read model Town reads
 * (useBoardFacts.ts, town/townExpenses.ts, town/townPlaceUsage.ts,
 * town/townLimits.ts, town/townSteps.ts); nothing here keeps its own copy.
 */

import { BarChart3 } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
} from "react";
import type { WorldLeafObject, WorldAgentStatus } from "../worldObject";
import {
  TOWN_WINDOW_LABEL,
  townCityExpenses,
  townCoverageNotes,
  townExpenseText,
  townHostExpenses,
  useTownExpensesUsage,
  type TownCityExpenses,
} from "../town/townExpenses";
import {
  townFuelGauges,
  townFuelNotes,
  townLimits,
  useTownLimits,
} from "../town/townLimits";
import {
  townPlaceEconomy,
  townUsageCurrent,
  townUsageStore,
  useTownUsage,
  type TownUsageWindow,
} from "../town/townPlaceUsage";
import { townLocation } from "../town/TownRail";
import type { TownStepStore } from "../town/townStepStore";
import {
  townSummaryAge,
  type TownSummary,
  type TownSummaryHost,
} from "../town/townSummary";
import { useBoardNow } from "./boardClock";
import {
  boardAgentNow,
  boardCountsText,
  boardFuelText,
  boardHostGauges,
  boardPlaceText,
  boardTotalText,
} from "./boardFactsText";
import "./boardFacts.css";

const WINDOWS: readonly TownUsageWindow[] = ["today", "7d"];

/** A window's usage as it may be shown now, on Board's one clock. */
function useBoardUsage(window: TownUsageWindow) {
  const store = townUsageStore(window);
  const state = useTownUsage(store);
  return townUsageCurrent(state, useBoardNow());
}

const WAITING_WORDS = {
  loading: "Reading usage…",
  unavailable: "Usage unavailable",
  stale: "Usage is out of date",
  "no-data": "No usage data from hosts",
} as const;

function cityLine(expenses: TownCityExpenses) {
  return expenses.status === "ready"
    ? townExpenseText(expenses.total)
    : WAITING_WORDS[expenses.status];
}

/**
 * The Board summary: Town's counts on a chip at the top of the board, which
 * opens the rest: expenses today and over 7 days, each harness's limits with
 * the reading's age, finished work not yet reviewed, and each host.
 */
export const BoardSummary = memo(function BoardSummary({
  summary,
  onSelectAgent,
}: {
  summary: TownSummary;
  /** Show an agent on the board: select it and bring its workspace in. */
  onSelectAgent(nodeId: string): void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  // Read usage while Board is shown, as Town's board does.
  useTownExpensesUsage(townUsageStore("7d"));
  const usage = useTownLimits();
  const today = townCityExpenses(useBoardUsage("today"));
  const week = townCityExpenses(useBoardUsage("7d"));
  const now = useBoardNow();
  const limits = townLimits(usage);
  const gauges = townFuelGauges(limits, now);
  const notes = townFuelNotes(limits, gauges);
  const { counts } = summary;
  const countsText = `${counts.working} busy, ${counts.needsYou} waiting, ${counts.finished} done, ${counts.quiet} quiet`;
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  return (
    <div className="board-facts" data-open={open}>
      <button
        type="button"
        className="board-facts-chip"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Board summary: ${countsText}`}
        title={open ? "Hide the Board summary" : "Show the Board summary"}
        onClick={() => setOpen((value) => !value)}
      >
        <BarChart3 size={14} aria-hidden="true" />
        <span data-status="working">{counts.working}</span>
        <span data-status="blocked">!{counts.needsYou}</span>
        <span data-status="done">✓{counts.finished}</span>
        <span data-status="idle">{counts.quiet}</span>
      </button>
      {open ? (
        <div
          id={panelId}
          className="board-facts-panel"
          role="group"
          aria-label="Board summary"
        >
          <section aria-label="Agents">
            <dl className="board-facts-counts">
              <div data-status="working">
                <dt>Busy</dt>
                <dd>{counts.working}</dd>
              </div>
              <div data-status="blocked">
                <dt>Waiting</dt>
                <dd>{counts.needsYou}</dd>
              </div>
              <div data-status="done">
                <dt>Done</dt>
                <dd>{counts.finished}</dd>
              </div>
              <div data-status="idle">
                <dt>Quiet</dt>
                <dd>{counts.quiet}</dd>
              </div>
            </dl>
            <p className="board-facts-note">
              {counts.agents} {counts.agents === 1 ? "agent" : "agents"} on{" "}
              {counts.buildings} {counts.buildings === 1 ? "host" : "hosts"}
              {counts.unknown ? ` · ${counts.unknown} unknown` : ""}
            </p>
          </section>
          <section aria-labelledby={`${panelId}-expenses`}>
            <h3 id={`${panelId}-expenses`}>Expenses · UTC</h3>
            {[today, week].map((expenses, index) => (
              <p key={WINDOWS[index]} className="board-facts-line">
                <span>{TOWN_WINDOW_LABEL[WINDOWS[index]!]}</span>
                <b>{cityLine(expenses)}</b>
              </p>
            ))}
            {today.status === "ready" ? (
              <p className="board-facts-note">
                {townCoverageNotes(today.coverage, today.unattributed).join(
                  " · ",
                )}
              </p>
            ) : null}
          </section>
          <section aria-labelledby={`${panelId}-fuel`}>
            <h3 id={`${panelId}-fuel`}>Limits</h3>
            {gauges.length || notes.length ? (
              <ul className="board-facts-list">
                {gauges.map((gauge) => (
                  <li
                    key={gauge.harness}
                    data-stale={gauge.stale || undefined}
                    data-low={(!gauge.stale && gauge.lowest.low) || undefined}
                  >
                    {boardFuelText(gauge, now)}
                  </li>
                ))}
                {notes.map((note) => (
                  <li key={note.harness} data-stale>
                    {note.name} limits not available: {note.reason}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="board-facts-note">
                {usage.status === "failed"
                  ? "Limits are unavailable right now."
                  : usage.status === "ready"
                    ? "No limits seen yet."
                    : "Reading limits…"}
              </p>
            )}
          </section>
          <section aria-labelledby={`${panelId}-finished`}>
            <h3 id={`${panelId}-finished`}>
              Done, not reviewed <span>{counts.finished}</span>
            </h3>
            {summary.finished.length ? (
              <ul className="board-facts-list">
                {summary.finished.map((item) => (
                  <li key={item.agent.key}>
                    <button
                      type="button"
                      aria-label={`Show ${item.agent.displayLabel} on the board`}
                      onClick={() => {
                        setOpen(false);
                        onSelectAgent(item.agent.nodeId);
                      }}
                    >
                      <b>{item.agent.displayLabel}</b>
                      <small>
                        {townLocation(item)}
                        {item.since === null
                          ? ""
                          : ` · last active ${townSummaryAge(item.since, now)}`}
                      </small>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="board-facts-note">Nothing new has finished.</p>
            )}
          </section>
          <section aria-labelledby={`${panelId}-hosts`}>
            <h3 id={`${panelId}-hosts`}>Hosts</h3>
            <ul className="board-facts-list">
              {summary.hosts.map((host) => (
                <li key={host.key}>
                  <b>{host.label}</b>
                  {host.stale ? <small> · offline, stale</small> : null}
                  <BoardHostLines host={host} />
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
});

/** A host's counts, expenses and limits, one short line each. */
function BoardHostLines({ host }: { host: TownSummaryHost }) {
  const today = useBoardUsage("today");
  const week = useBoardUsage("7d");
  const now = useBoardNow();
  const gauges = boardHostGauges(
    townLimits(useTownUsage(townUsageStore())),
    host.connectionId,
    now,
  );
  return (
    <>
      <small className="board-facts-host-line">
        {boardCountsText(host.counts)}
      </small>
      <small className="board-facts-host-line">
        Today {boardTotalText(townHostExpenses(today, host.connectionId))} · 7
        days {boardTotalText(townHostExpenses(week, host.connectionId))}
      </small>
      {gauges.map((gauge) => (
        <small
          key={gauge.harness}
          className="board-facts-host-line"
          data-stale={gauge.stale || undefined}
        >
          {boardFuelText(gauge, now)}
        </small>
      ))}
    </>
  );
}

/** A host zone's facts beside its name: counts, expenses and limits. */
export const BoardZoneFacts = memo(function BoardZoneFacts({
  host,
}: {
  host: TownSummaryHost | undefined;
}) {
  const today = useBoardUsage("today");
  const week = useBoardUsage("7d");
  const now = useBoardNow();
  const limits = townLimits(useTownUsage(townUsageStore()));
  if (!host) return null;
  const gauges = boardHostGauges(limits, host.connectionId, now);
  return (
    <span className="board-zone-facts">
      <span>{boardCountsText(host.counts)}</span>
      <span>
        today {boardTotalText(townHostExpenses(today, host.connectionId))} · 7
        days {boardTotalText(townHostExpenses(week, host.connectionId))}
      </span>
      {gauges.map((gauge) => (
        <span key={gauge.harness} data-stale={gauge.stale || undefined}>
          {boardFuelText(gauge, now)}
        </span>
      ))}
    </span>
  );
});

/** A workspace card's usage, today and over 7 days, as Town's room card. */
export const BoardWorkspaceEconomy = memo(function BoardWorkspaceEconomy({
  connectionId,
  generation,
  nativeId,
  worldId,
}: {
  connectionId: string;
  generation: number;
  nativeId: string;
  worldId: string;
}) {
  const place = {
    kind: "room" as const,
    target: {
      connectionId,
      generation,
      nativeId,
      worldId,
      kind: "workspace" as const,
    },
  };
  const today = boardPlaceText(townPlaceEconomy(useBoardUsage("today"), place));
  const week = boardPlaceText(townPlaceEconomy(useBoardUsage("7d"), place));
  return (
    <div className="board-economy">
      today {today} · 7 days {week}
    </div>
  );
});

/**
 * What an agent is doing now: its running step (amber once it has run long,
 * as Town's bubbles), its unreviewed or reviewed finish, or its idle time.
 * Short, as it fits a card: a pane row's state, which shows `fallback`
 * when there is nothing to say, or the end of a tab card's line.
 */
export const BoardAgentNowLine = memo(function BoardAgentNowLine({
  leaf,
  status,
  presented = status,
  steps,
  className,
  fallback,
}: {
  leaf: WorldLeafObject;
  status: WorldAgentStatus;
  presented?: WorldAgentStatus;
  steps: TownStepStore;
  /** Where it stands: a pane row's state, or the end of a tab card's line. */
  className: "board-pane-state" | "board-now-inline";
  fallback?: string;
}) {
  const key = leaf.id;
  const step = useSyncExternalStore(
    useCallback(
      (listener: () => void) => steps.subscribe(key, listener),
      [steps, key],
    ),
    () => steps.get(key),
  );
  const now = useBoardNow();
  const line = boardAgentNow({
    status,
    presented,
    step,
    lastActivityAt: leaf.lastActivityAt,
    now,
  });
  if (!line && fallback === undefined) return null;
  return (
    <span
      className={`${className} board-now`}
      data-long={line?.long || undefined}
      data-kind={
        line && step && presented === "working" ? step.kind : undefined
      }
    >
      {line?.text ?? fallback}
    </span>
  );
});
