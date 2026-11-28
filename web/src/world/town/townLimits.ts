import { clock } from "../../clock";
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
 * "not available", and one with agents in Town but no reading yet reads
 * "no reading yet"; stale numbers say so, and nothing reads 0 % or 100 %
 * without an observation behind it. A refusal ("limit reached") shows as
 * that, with its reset time, never as a level. A reading past its source's
 * short age dims and reads "as of 09:24" (#1087), and a window the source did
 * not send reads "not reported" rather than vanishing.
 */

/** Below this share left a window is low and wears the warning colour. */
export const TOWN_FUEL_LOW_PERCENT = 15;

export type TownFuelWindow = {
  /** "5 h", "week", … */
  label: string;
  /** The window's length, or null for an unnamed refusal. */
  minutes: number | null;
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
  /**
   * Current but older than its source's short age (TOWN_FUEL_AGED_MS): the
   * level dims and reads "as of 09:24", and it never raises the low chip.
   */
  aged: boolean;
  observedAt: number;
  source: string;
  /** One plain line on what refreshes this reading. */
  refresh: string;
  windows: TownFuelWindow[];
  /** Windows the harness has that this reading left out: "not reported". */
  missing: { label: string; minutes: number }[];
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

/**
 * The windows each harness's subscription has: Claude Code's status line
 * and Codex's session log both carry a 5-hour and a week window. A reading
 * without one names it "not reported".
 */
const HARNESS_WINDOWS: Record<UsageLimit["harness"], readonly number[]> = {
  claude: [300, 10080],
  codex: [300, 10080],
};

/** What refreshes each harness's reading, in one plain line. */
const HARNESS_REFRESH: Record<UsageLimit["harness"], string> = {
  claude:
    "Updates when a Claude Code agent started from World draws its status line.",
  codex: "Updates when a Codex agent answers and writes its session log.",
};

export const townFuelRefreshText = (harness: UsageLimit["harness"]) =>
  HARNESS_REFRESH[harness] ?? "Updates when an agent of this harness answers.";

/**
 * How old a current reading may be before it dims and reads "as of …",
 * per source. Claude's status line only refreshes while an agent started
 * from World draws it, so a quiet crew leaves it behind quickly.
 */
export const TOWN_FUEL_AGED_MS: Record<
  NonNullable<UsageLimit["source"]>,
  number
> = {
  "claude-status-line": 30 * 60_000,
  "claude-transcript": 30 * 60_000,
  "codex-session-log": 30 * 60_000,
};
const TOWN_FUEL_AGED_DEFAULT_MS = 30 * 60_000;
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
    minutes: window.window_minutes,
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
    minutes: reached.window_minutes,
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
  // The service judged it at read time; time passing can only age it.
  const stale =
    limit.state === "stale" ||
    usageLimitExpired(limit.observed_at, limit.windows, now, limit.reached);
  const agedAfter =
    (limit.source && TOWN_FUEL_AGED_MS[limit.source]) ||
    TOWN_FUEL_AGED_DEFAULT_MS;
  // A refusal says nothing about other windows, so none reads as missing.
  const missing = limit.reached
    ? []
    : (HARNESS_WINDOWS[limit.harness] ?? [])
        .filter((minutes) => !windows.some((w) => w.minutes === minutes))
        .map((minutes) => ({ label: townWindowLabel(minutes), minutes }));
  return {
    harness: limit.harness,
    name: townHarnessName(limit.harness),
    connectionId: limit.connection_id,
    stale,
    aged: !stale && now - limit.observed_at > agedAfter,
    observedAt: limit.observed_at,
    source: townLimitSourceName(limit.source),
    refresh: townFuelRefreshText(limit.harness),
    windows,
    missing,
    lowest: windows.reduce((low, w) => (w.left < low.left ? w : low)),
  };
}

/** A gauge row: a window with a level, or one the reading did not report. */
export type TownFuelRow =
  | { kind: "window"; window: TownFuelWindow }
  | { kind: "missing"; label: string };

/** A gauge's windows and its unreported ones, shortest window first. */
export function townFuelRows(gauge: TownFuelGauge): TownFuelRow[] {
  const rows: { minutes: number; row: TownFuelRow }[] = [
    ...gauge.windows.map((window) => ({
      minutes: window.minutes ?? Number.MAX_SAFE_INTEGER,
      row: { kind: "window" as const, window },
    })),
    ...gauge.missing.map(({ label, minutes }) => ({
      minutes,
      row: { kind: "missing" as const, label },
    })),
  ];
  return rows
    .map((entry, index) => ({ ...entry, index }))
    .sort((a, b) => a.minutes - b.minutes || a.index - b.index)
    .map(({ row }) => row);
}

/** Current first, then aged, then stale. */
const gaugeRank = (gauge: TownFuelGauge) =>
  gauge.stale ? 2 : gauge.aged ? 1 : 0;

/**
 * The board's gauges: one per harness. With several hosts it shows the
 * current observation with the least left, since that is the one that
 * stops the crew; aged ones show only when nothing current exists, and
 * stale ones only when nothing newer does.
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
      gaugeRank(gauge) < gaugeRank(prior) ||
      (gaugeRank(gauge) === gaugeRank(prior) &&
        gauge.lowest.left < prior.lowest.left)
    )
      best.set(gauge.harness, gauge);
  }
  return [...best.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A harness the sign names rather than leaving out: one that keeps no
 * readable limits ("not available", with the reason), or one with agents in
 * Town and no reading from any host yet ("no reading yet", with what
 * refreshes it).
 */
export type TownFuelNote = {
  harness: UsageLimit["harness"];
  name: string;
  kind: "unavailable" | "no-reading";
  /** Why it is not available, or what will bring a reading. */
  reason: string;
};

/**
 * Harnesses with no gauge from any host. Unsupported ones show as "not
 * available" with the service's one-line reason; ones with agents in Town
 * (`harnesses`, as Herdr names them) and only missing readings show as "no
 * reading yet". Neither is ever an empty or full gauge.
 */
export function townFuelNotes(
  limits: readonly UsageLimit[],
  gauges: readonly TownFuelGauge[],
  harnesses: readonly string[] = [],
): TownFuelNote[] {
  const notes = new Map<string, TownFuelNote>();
  const gauged = (harness: string) => gauges.some((g) => g.harness === harness);
  for (const limit of limits)
    if (
      limit.state === "unsupported" &&
      !gauged(limit.harness) &&
      !notes.has(limit.harness)
    )
      notes.set(limit.harness, {
        harness: limit.harness,
        name: townHarnessName(limit.harness),
        kind: "unavailable",
        reason: limit.reason ?? "no source",
      });
  for (const limit of limits)
    if (
      harnesses.includes(limit.harness) &&
      !gauged(limit.harness) &&
      !notes.has(limit.harness)
    )
      notes.set(limit.harness, {
        harness: limit.harness,
        name: townHarnessName(limit.harness),
        kind: "no-reading",
        reason: townFuelRefreshText(limit.harness),
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

const clockFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

/** "09:24", in the viewer's time zone: when an aged reading was taken. */
export function townFuelClock(at: number) {
  return clockFormat.format(at);
}

/** How long ago, in words that read after "seen". */
export function townSeenAge(at: number, now: number) {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** A current reading older than this shows its age on the gauge itself. */
export const TOWN_FUEL_AGE_SHOWN_MS = 15 * 60_000;

/**
 * The age the gauge itself shows, so an old level never passes for a fresh
 * one: "seen 20 min ago" past 15 minutes, "as of 09:24" once aged (its
 * level dims too); null for a fresh reading, and for a stale one, which
 * already reads "stale" with no level.
 */
export function townFuelAge(gauge: TownFuelGauge, now: number) {
  if (gauge.stale) return null;
  if (gauge.aged) return `as of ${townFuelClock(gauge.observedAt)}`;
  return now - gauge.observedAt <= TOWN_FUEL_AGE_SHOWN_MS
    ? null
    : `seen ${townSeenAge(gauge.observedAt, now)}`;
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
    const timer = clock.setInterval(() => store.request(), LIMITS_REFRESH_MS);
    return () => clock.clearInterval(timer);
  }, [store]);
  return useTownUsage(store);
}

/** The limits in a usage read, or none while it loads or after it failed. */
export function townLimits(state: TownUsageState): readonly UsageLimit[] {
  return state.status === "ready" && Array.isArray(state.snapshot.limits)
    ? state.snapshot.limits
    : [];
}
