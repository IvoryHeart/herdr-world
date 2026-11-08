/**
 * Board's words for Town's facts (#787). Each figure is Town's own read
 * model, formatted as Town formats the same figure: host and World totals as
 * Town's expenses boards, a workspace as Town's room card, limits as Town's
 * fuel, steps as Town's thought bubbles and idle time as Town's Idle lens.
 */

import type { UsageLimit } from "../../../../shared/usage";
import { formatOfficeCost, formatOfficeUsage } from "../officeObservability";
import {
  townCostText,
  type TownCityExpenses,
  type TownHostExpenses,
} from "../town/townExpenses";
import {
  townFuelGauge,
  townReachedText,
  townResetTime,
  townSeenAge,
  type TownFuelGauge,
} from "../town/townLimits";
import { townIdleWords } from "../town/townLens";
import type { TownPlaceEconomy } from "../town/townPlaceUsage";
import { townStepLabel, townStepLong, type TownStep } from "../town/townSteps";
import type { TownSummaryCounts } from "../town/townSummary";
import type { WorldAgentStatus } from "../worldObject";

const TOTAL_WAITING = {
  loading: "…",
  unavailable: "unavailable",
  stale: "out of date",
  "no-data": "no data",
} as const;

/** A host's or the World's total in a few words: "$3.40 est.", or its tokens. */
export function boardTotalText(
  expenses: TownCityExpenses | TownHostExpenses,
): string {
  if (expenses.status !== "ready") return TOTAL_WAITING[expenses.status];
  const { total } = expenses;
  if (!total.records) return "none";
  return total.price === "priced" && total.costUsd !== null
    ? townCostText(total)!
    : `${formatOfficeUsage(total.tokens)} tokens`;
}

const PLACE_WAITING = {
  loading: "…",
  unavailable: "unavailable",
  stale: "out of date",
  none: "none",
  "no-data": "no data",
  limited: "limited",
} as const;

/** A workspace's usage, as Town's room card shows it: "~$1.20", or tokens. */
export function boardPlaceText(economy: TownPlaceEconomy): string {
  if (economy.status !== "ready") return PLACE_WAITING[economy.status];
  const figure =
    economy.price === "priced" && economy.costUsd !== null
      ? formatOfficeCost(economy.costUsd, "estimated")
      : `${formatOfficeUsage(economy.tokens)} tokens`;
  return economy.partial ? `${figure} partial` : figure;
}

const COUNT_WORDS: [keyof TownSummaryCounts, string][] = [
  ["working", "busy"],
  ["needsYou", "waiting"],
  ["finished", "done"],
  ["quiet", "quiet"],
];

/** "5 busy · 2 waiting": a place's counts, those above zero. */
export function boardCountsText(counts: TownSummaryCounts): string {
  const shown = COUNT_WORDS.filter(([key]) => counts[key] > 0);
  return shown.length
    ? shown.map(([key, word]) => `${counts[key]} ${word}`).join(" · ")
    : "no agents";
}

/** One harness's limits: "Claude 5 h 60% left · week 80% left · seen 3 min ago". */
export function boardFuelText(gauge: TownFuelGauge, now: number): string {
  const windows = gauge.stale
    ? ["stale"]
    : gauge.windows.map((w) =>
        w.reached
          ? `${townReachedText(w)}${w.resetsAt === null ? "" : `, resets ${townResetTime(w.resetsAt)}`}`
          : `${w.label} ${w.left}% left${w.low ? " (low)" : ""}`,
      );
  return `${gauge.name} ${windows.join(" · ")} · seen ${townSeenAge(gauge.observedAt, now)}`;
}

/** A host's limits as gauges, those with numbers to show. */
export function boardHostGauges(
  limits: readonly UsageLimit[],
  connectionId: string,
  now: number,
): TownFuelGauge[] {
  return limits
    .filter((limit) => limit.connection_id === connectionId)
    .flatMap((limit) => {
      const gauge = townFuelGauge(limit, now);
      return gauge ? [gauge] : [];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export type BoardAgentNow = {
  text: string;
  /** The running step has run long for its kind: Town's amber timer. */
  long: boolean;
};

/**
 * What an agent is doing now, or how long since it did, short enough for a
 * card: its running step with Town's timer, whether its finish is reviewed,
 * or its idle time. `presented` is the agent's status as Town presents it,
 * which applies Town's finishes and reviews to Herdr's `status`.
 */
export function boardAgentNow({
  status,
  presented = status,
  step,
  lastActivityAt,
  now,
}: {
  status: WorldAgentStatus;
  presented?: WorldAgentStatus;
  step: TownStep | undefined;
  lastActivityAt: number | undefined;
  now: number;
}): BoardAgentNow | null {
  if (presented === "working" && step)
    return { text: townStepLabel(step, now), long: townStepLong(step, now) };
  if (presented === "done") return { text: "Not reviewed", long: false };
  if (status === "done" && presented === "idle")
    return { text: "Reviewed", long: false };
  if (presented === "idle" && lastActivityAt !== undefined)
    return {
      text: `Idle ${townIdleWords(now - lastActivityAt)}`,
      long: false,
    };
  return null;
}
