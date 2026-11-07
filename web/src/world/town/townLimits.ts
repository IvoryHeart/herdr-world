import { useEffect } from "react";
import {
  usageLimitExpired,
  type UsageLimit,
  type UsageLimitReached,
  type UsageLimitWindow,
} from "../../../../shared/usage";
import {
  townUsageStore,
  useTownUsage,
  type TownUsageStore,
  type TownUsageState,
} from "./townPlaceUsage";

/**
 * Subscription "fuel" for the Town board sign and summary: how much of each
 * harness's limit windows is left, from the service's harness usage read
 * (`world.usage.get` `limits`, docs/usage.md). Only harnesses with an
 * observation get a gauge; a harness that keeps no readable limits reads
 * "not available"; stale numbers say so, and nothing reads 0 % or 100 %
 * without an observation behind it. A refusal ("limit reached") shows as
 * that, with its reset time, never as a level.
 */

/** Below this share left a window is low and wears the warning colour. */
export const TOWN_FUEL_LOW_PERCENT = 15;

export type TownFuelWindow = {
  /** "5 h", "week", … */
  label: string;
  /** Whole percent left, 0–100. */
  left: number;
  used: number;
  low: boolean;
  resetsAt: number | null;
  /** The harness refused work: this limit is used up until `resetsAt`. */
  reached: boolean;
};

export type TownFuelGauge = {
  harness: UsageLimit["harness"];
  name: string;
  connectionId: string;
  stale: boolean;
  observedAt: number;
  source: string;
  windows: TownFuelWindow[];
  /** The least left across its windows, for the phone chip. */
  lowest: TownFuelWindow;
};

const HARNESS_NAMES: Record<UsageLimit["harness"], string> = {
  codex: "Codex",
  claude: "Claude",
};
const SOURCE_NAMES: Record<NonNullable<UsageLimit["source"]>, string> = {
  "codex-session-log": "Codex session log",
  "claude-status-line": "Claude status line",
  "claude-transcript": "Claude transcript",
};

export const townHarnessName = (harness: UsageLimit["harness"]) =>
  HARNESS_NAMES[harness] ?? harness;
export const townLimitSourceName = (source: UsageLimit["source"]) =>
  source ? (SOURCE_NAMES[source] ?? source) : "";

/** A window's length in words: 300 minutes is "5 h", 10,080 is "week". */
export function townWindowLabel(minutes: number) {
  if (minutes === 10080) return "week";
  if (minutes === 1440) return "day";
  if (minutes % 1440 === 0) return `${minutes / 1440} d`;
  if (minutes % 60 === 0) return `${minutes / 60} h`;
  return `${minutes} min`;
}

export function townFuelWindow(window: UsageLimitWindow): TownFuelWindow {
  const used = Math.round(Math.min(100, Math.max(0, window.used_percent)));
  const left = 100 - used;
  return {
    label: townWindowLabel(window.window_minutes),
    left,
    used,
    low: left < TOWN_FUEL_LOW_PERCENT,
    resetsAt: window.resets_at,
    reached: false,
  };
}

/** A refusal as a window that is used up; it never renders as a percent. */
export function townFuelReached(reached: UsageLimitReached): TownFuelWindow {
  return {
    label:
      reached.window_minutes === null
        ? "limit"
        : townWindowLabel(reached.window_minutes),
    left: 0,
    used: 100,
    low: true,
    resetsAt: reached.resets_at,
    reached: true,
  };
}

/** "5 h limit reached", or "limit reached" when the window is unnamed. */
export const townReachedText = (w: TownFuelWindow) =>
  w.label === "limit" ? "limit reached" : `${w.label} limit reached`;

/** One limit as a gauge, or null when it has no numbers to show. */
export function townFuelGauge(
  limit: UsageLimit,
  now: number,
): TownFuelGauge | null {
  if (
    (limit.state !== "available" && limit.state !== "stale") ||
    limit.observed_at === null ||
    (!limit.windows.length && !limit.reached)
  )
    return null;
  const windows = limit.reached
    ? [townFuelReached(limit.reached)]
    : limit.windows.map(townFuelWindow);
  return {
    harness: limit.harness,
    name: townHarnessName(limit.harness),
    connectionId: limit.connection_id,
    // The service judged it at read time; time passing can only age it.
    stale:
      limit.state === "stale" ||
      usageLimitExpired(limit.observed_at, limit.windows, now, limit.reached),
    observedAt: limit.observed_at,
    source: townLimitSourceName(limit.source),
    windows,
    lowest: windows.reduce((low, w) => (w.left < low.left ? w : low)),
  };
}

/**
 * The board's gauges: one per harness. With several hosts it shows the
 * current observation with the least left, since that is the one that
 * stops the crew; stale ones show only when nothing current exists.
 */
export function townFuelGauges(
  limits: readonly UsageLimit[],
  now: number,
): TownFuelGauge[] {
  const best = new Map<string, TownFuelGauge>();
  for (const limit of limits) {
    const gauge = townFuelGauge(limit, now);
    if (!gauge) continue;
    const prior = best.get(gauge.harness);
    if (
      !prior ||
      (prior.stale && !gauge.stale) ||
      (prior.stale === gauge.stale && gauge.lowest.left < prior.lowest.left)
    )
      best.set(gauge.harness, gauge);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** A harness that keeps no readable limits: the sign names it rather than leaving it out. */
export type TownFuelNote = {
  harness: UsageLimit["harness"];
  name: string;
  reason: string;
};

/**
 * Harnesses whose limits are unsupported and that have no gauge from any
 * host. They show as "not available" with the service's one-line reason,
 * never as an empty or full gauge.
 */
export function townFuelNotes(
  limits: readonly UsageLimit[],
  gauges: readonly TownFuelGauge[],
): TownFuelNote[] {
  const notes = new Map<string, TownFuelNote>();
  for (const limit of limits)
    if (
      limit.state === "unsupported" &&
      !gauges.some((g) => g.harness === limit.harness) &&
      !notes.has(limit.harness)
    )
      notes.set(limit.harness, {
        harness: limit.harness,
        name: townHarnessName(limit.harness),
        reason: limit.reason ?? "no source",
      });
  return [...notes.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const resetFormat = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
});

/** "Tue 14:00", in the viewer's time zone. */
export function townResetTime(at: number) {
  return resetFormat.format(at);
}

/** How long ago, in words that read after "seen". */
export function townSeenAge(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/**
 * Re-read usage while the board is shown, as often as the service refreshes
 * a host (every 30 s), so a reading taken at an agent's answer reaches the
 * sign within about a minute. The store limits the rate.
 */
export const LIMITS_REFRESH_MS = 30_000;

/** The usage read, refreshed on mount and every 30 seconds while mounted. */
export function useTownLimits(
  store: TownUsageStore = townUsageStore(),
): TownUsageState {
  useEffect(() => {
    store.request();
    const timer = window.setInterval(() => store.request(), LIMITS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [store]);
  return useTownUsage(store);
}

/** The limits in a usage read, or none while it loads or after it failed. */
export function townLimits(state: TownUsageState): readonly UsageLimit[] {
  return state.status === "ready" && Array.isArray(state.snapshot.limits)
    ? state.snapshot.limits
    : [];
}
