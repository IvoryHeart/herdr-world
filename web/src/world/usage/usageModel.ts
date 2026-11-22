import type {
  UsageLimit,
  UsageLimitWindow,
  UsageRunRole,
} from "../../../../shared/usage";
import type {
  UsageAnalyticsMetrics,
  UsageAnalyticsRow,
  UsageMetric,
  WorldUsageAnalytics,
} from "../../../../shared/usageAnalytics";
import {
  townFuelGauges,
  townHarnessName,
  townResetTime,
  townWindowLabel,
} from "../town/townLimits";
import { usageLimitExpired } from "../../../../shared/usage";
import { usageReadsTokens } from "../../../../shared/usageHarnesses";

/**
 * The Usage screens' model: pure reads of one `world.usage.analytics` answer
 * grouped by run (docs/usage-analytics.md). Every number here is counted from
 * that answer; anything it does not say reads "unknown", never an estimate.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Building is worker and fixer runs; checking is reviewer and checker runs. */
export type UsageWork = "building" | "checking" | "other";
export const USAGE_WORK: readonly UsageWork[] = [
  "building",
  "checking",
  "other",
];
export const USAGE_WORK_LABEL: Record<UsageWork, string> = {
  building: "Building",
  checking: "Reviewing and checking",
  other: "Other or unknown role",
};
export function usageWork(role: UsageRunRole | null): UsageWork {
  if (role === "worker" || role === "fixer") return "building";
  if (role === "reviewer" || role === "checker") return "checking";
  return "other";
}

/** "950", "12k", "1.2M"; null is "unknown", never 0. */
export function usageCount(value: number | null | undefined) {
  if (value === null || value === undefined) return "unknown";
  const abs = Math.abs(value);
  if (abs < 1000) return String(Math.round(value));
  if (abs < 10_000) return `${(value / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (abs < 1_000_000) return `${Math.round(value / 1000)}k`;
  if (abs < 10_000_000)
    return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${Math.round(value / 1_000_000)}M`;
}

export const usageHarnessName = (harness: string) =>
  harness === "claude" || harness === "codex"
    ? townHarnessName(harness)
    : harness.charAt(0).toUpperCase() + harness.slice(1);

// ── Budget pace ─────────────────────────────────────────────────────────

export type UsagePaceVerdict =
  /** The harness refused work: the limit is used up until it resets. */
  | "reached"
  /** At this pace it runs out before it resets. */
  | "early"
  /** At this pace most of it is used by the reset. */
  | "on-track"
  /** At this pace a fair share is left unused at the reset. */
  | "unused"
  /** Too little of the window has passed to tell. */
  | "too-soon"
  /** Stale, or no reset time: no pace is claimed. */
  | "unknown";

export type UsagePace = {
  harness: UsageLimit["harness"];
  name: string;
  /** "5 h", "week". */
  label: string;
  minutes: number | null;
  /** Percent used when last seen; null for a refusal or an unknown level. */
  used: number | null;
  resetsAt: number | null;
  observedAt: number;
  stale: boolean;
  verdict: UsagePaceVerdict;
  /** Percent used by the reset at the pace so far. */
  projected: number | null;
  /** When it runs out at the pace so far, for `early`. */
  runsOutAt: number | null;
};

/** Under this projected share at the reset, the window is left unused. */
export const USAGE_PACE_UNUSED_PERCENT = 80;
/** Before this share of a window has passed, its pace is not judged. */
export const USAGE_PACE_MIN_ELAPSED = 0.1;

/** One window's pace from its level when it was last seen. */
export function usageWindowPace(
  window: UsageLimitWindow,
  observedAt: number,
): Pick<UsagePace, "verdict" | "projected" | "runsOutAt"> {
  const length = window.window_minutes * 60_000;
  if (window.resets_at === null || !(length > 0))
    return { verdict: "unknown", projected: null, runsOutAt: null };
  const elapsed = length - (window.resets_at - observedAt);
  if (elapsed < length * USAGE_PACE_MIN_ELAPSED || elapsed <= 0)
    return { verdict: "too-soon", projected: null, runsOutAt: null };
  const used = Math.min(100, Math.max(0, window.used_percent));
  if (used >= 100)
    return { verdict: "reached", projected: 100, runsOutAt: observedAt };
  const projected = (used * length) / Math.min(elapsed, length);
  if (projected >= 100) {
    const runsOutAt =
      used > 0 ? observedAt + ((100 - used) * elapsed) / used : null;
    return { verdict: "early", projected, runsOutAt };
  }
  return {
    verdict: projected < USAGE_PACE_UNUSED_PERCENT ? "unused" : "on-track",
    projected,
    runsOutAt: null,
  };
}

/**
 * Each harness's windows, from the observation the Town sign shows (the
 * current one with the least left across hosts), longest window first so
 * the week leads.
 */
export function usagePaces(
  limits: readonly UsageLimit[],
  now: number,
): UsagePace[] {
  const out: UsagePace[] = [];
  for (const gauge of townFuelGauges(limits, now)) {
    const limit = limits.find(
      (l) =>
        l.harness === gauge.harness &&
        l.connection_id === gauge.connectionId &&
        l.observed_at === gauge.observedAt,
    );
    if (!limit || limit.observed_at === null) continue;
    const base = {
      harness: limit.harness,
      name: gauge.name,
      observedAt: limit.observed_at,
      stale: gauge.stale,
    };
    if (limit.reached) {
      out.push({
        ...base,
        label:
          limit.reached.window_minutes === null
            ? "limit"
            : townWindowLabel(limit.reached.window_minutes),
        minutes: limit.reached.window_minutes,
        used: null,
        resetsAt: limit.reached.resets_at,
        verdict: gauge.stale ? "unknown" : "reached",
        projected: null,
        runsOutAt: null,
      });
      continue;
    }
    for (const window of [...limit.windows].sort(
      (a, b) => b.window_minutes - a.window_minutes,
    )) {
      const pace = usageWindowPace(window, limit.observed_at);
      const stale =
        gauge.stale ||
        usageLimitExpired(limit.observed_at, [window], now, null);
      out.push({
        ...base,
        stale,
        label: townWindowLabel(window.window_minutes),
        minutes: window.window_minutes,
        used: Math.round(Math.min(100, Math.max(0, window.used_percent))),
        resetsAt: window.resets_at,
        ...(stale
          ? { verdict: "unknown", projected: null, runsOutAt: null }
          : pace),
      });
    }
  }
  return out;
}

/** Days and hours until a time, in words: "2 d 4 h", "3 h 10 min". */
export function usageSpan(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return `${hours} h ${minutes % 60} min`.replace(/ 0 min$/, "");
  return `${Math.floor(hours / 24)} d ${hours % 24} h`.replace(/ 0 h$/, "");
}

/** The pace in a sentence, for the Budget tab and the building's tooltip. */
export function usagePaceText(pace: UsagePace, now: number) {
  const when = pace.resetsAt === null ? null : townResetTime(pace.resetsAt);
  switch (pace.verdict) {
    case "reached":
      return when ? `Limit reached; resets ${when}` : "Limit reached";
    case "early":
      return pace.runsOutAt !== null && pace.resetsAt !== null
        ? `Runs out around ${townResetTime(pace.runsOutAt)}, ${usageSpan(
            pace.resetsAt - Math.max(now, pace.runsOutAt),
          )} before it resets`
        : "Runs out before it resets";
    case "unused":
      return `On pace to leave about ${Math.round(
        100 - (pace.projected ?? 0),
      )}% unused${when ? ` when it resets ${when}` : ""}`;
    case "on-track":
      return when
        ? `On track to be used by the reset, ${when}`
        : "On track to be used by the reset";
    case "too-soon":
      return when
        ? `Too early in the window to tell; resets ${when}`
        : "Too early in the window to tell";
    default:
      return pace.stale
        ? "Pace unknown: the last reading is too old"
        : "Pace unknown: no reset time";
  }
}

// ── Runs ────────────────────────────────────────────────────────────────

export type UsageItem = {
  /** Stable grouping key: the PR's key, else the branch, else none. */
  key: string;
  /** "#42", a branch name, or "No branch". */
  label: string;
  number: number | null;
};

export type UsageRunView = {
  key: string;
  harness: string;
  name: string;
  role: UsageRunRole | null;
  work: UsageWork;
  item: UsageItem;
  /** `world`: World's own measurement only, so no calls or tokens. */
  source: "session-log" | "world";
  /** World can count this harness's tokens at all (the reader seam). */
  tokensReadable: boolean;
  /** Its counted tokens; null when unknown. */
  tokens: number | null;
  calls: number | null;
  /** Time World saw it at work and waiting on you; null when not seen. */
  activeMs: number | null;
  waitingMs: number | null;
  /** When it was going: sorted [from, to] spans. */
  spans: [number, number][];
  maxPrompt: number | null;
  context: {
    used: number;
    window: number | null;
    percent: number | null;
  } | null;
  firstAt: number;
  lastAt: number;
  /** It answered in the last few minutes, or is in an agent pane now. */
  live: boolean;
  models: string[];
  identity: UsageAnalyticsRow["identity"];
  /** Plain words for what may be waste: rounds, near-full context, calls. */
  flags: string[];
  /** The fixer round on its item, counting from the first fixer run. */
  round: number | null;
};

/** A run that answered within this long of the read counts as live. */
/** "45 min", "3.5 h", "30 h": time spent at a glance. */
export function usageDuration(ms: number) {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = ms / 3_600_000;
  return hours < 10
    ? `${hours.toFixed(1).replace(/\.0$/, "")} h`
    : `${Math.round(hours)} h`;
}

export const USAGE_LIVE_MS = 10 * 60_000;
/** A context this full is flagged: the run is carrying a lot each call. */
export const USAGE_CONTEXT_FULL = 0.8;
/** A run with this many times its role's typical calls is flagged. */
export const USAGE_CALLS_MULTIPLE = 3;

export function usageItem(
  run: NonNullable<UsageAnalyticsRow["run"]>,
  key = "",
): UsageItem {
  // A pull request has its branch but no validated link proves it: name
  // none, and join no other run.
  if (run.attribution === "ambiguous" && run.branch)
    return {
      key: `run:${key}`,
      label: `${run.branch} (pull request unknown)`,
      number: null,
    };
  if (run.pull_request)
    return {
      key: run.pull_request.key,
      label:
        run.pull_request.number !== null
          ? `#${run.pull_request.number}`
          : (run.branch ?? "pull request"),
      number: run.pull_request.number,
    };
  if (run.branch)
    return { key: `branch:${run.branch}`, label: run.branch, number: null };
  return { key: "none", label: "No branch", number: null };
}

/**
 * A log run that counts a World run's work: the same harness on the same
 * connection and runtime generation, of the same agent and pane or ones it
 * no longer knows (a stale pane), going at the same time. The server joins the two
 * itself when it can tie the agent to the run; this catches the rest.
 */
function sameWork(world: UsageAnalyticsRow, log: UsageAnalyticsRow) {
  const a = world.identity;
  const b = log.identity;
  return (
    log.run?.source === "session-log" &&
    log.run.harness === world.run?.harness &&
    !!a &&
    !!b &&
    a.connection_id === b.connection_id &&
    a.connection_generation === b.connection_generation &&
    (b.agent_id === null || b.agent_id === a.agent_id) &&
    (b.pane_id === null || b.pane_id === a.pane_id) &&
    world.run.spans.some(([from, to]) =>
      log.run!.spans.some(([start, end]) => start <= to && from <= end),
    )
  );
}

export function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The answer's runs with item, live state and waste flags, heaviest first.
 * World's measurement alone is a run of its own: a harness whose logs World
 * cannot read, or an agent of one it can whose log has no run yet (before
 * its first response, or while the log is unreadable). It is left out only
 * when a log run World could not join it to plainly counts the same work.
 */
export function usageRuns(data: WorldUsageAnalytics): UsageRunView[] {
  const runs: UsageRunView[] = [];
  for (const row of data.rows) {
    const run = row.run;
    if (!run || row.dimension === null) continue;
    const tokensReadable = usageReadsTokens(run.harness);
    if (
      run.source === "world" &&
      tokensReadable &&
      data.rows.some((other) => sameWork(row, other))
    )
      continue;
    const context = run.context
      ? {
          used: run.context.used_tokens,
          window: run.context.window_tokens,
          percent:
            run.context.window_tokens && run.context.window_tokens > 0
              ? Math.min(
                  100,
                  Math.round(
                    (100 * run.context.used_tokens) / run.context.window_tokens,
                  ),
                )
              : null,
        }
      : null;
    runs.push({
      key: row.key,
      harness: run.harness,
      name: usageHarnessName(run.harness),
      role: run.role,
      work: usageWork(run.role),
      item: usageItem(run, row.key),
      source: run.source,
      tokensReadable,
      tokens: row.total_tokens.value,
      calls: run.calls,
      activeMs: row.active_ms.value,
      waitingMs: row.waiting_on_you_ms.value,
      spans: run.spans,
      maxPrompt: run.max_prompt_tokens,
      context,
      firstAt: run.first_at,
      lastAt: run.last_at,
      live: context !== null || data.observed_at - run.last_at <= USAGE_LIVE_MS,
      models: run.models,
      identity: row.identity,
      flags: [],
      round: null,
    });
  }
  // Fixer rounds per item, oldest first.
  const fixers = new Map<string, UsageRunView[]>();
  for (const run of runs)
    if (run.role === "fixer" && run.item.key !== "none")
      fixers.set(run.item.key, [...(fixers.get(run.item.key) ?? []), run]);
  for (const list of fixers.values()) {
    list.sort((a, b) => a.firstAt - b.firstAt);
    list.forEach((run, index) => {
      run.round = index + 1;
      if (index > 0)
        run.flags.push(`fixer round ${index + 1} on ${run.item.label}`);
    });
  }
  // Calls against the typical run of the same role and harness.
  const typical = new Map<string, number>();
  const byKind = new Map<string, number[]>();
  for (const run of runs) {
    if (run.calls === null) continue;
    const kind = `${run.harness}:${run.role ?? ""}`;
    byKind.set(kind, [...(byKind.get(kind) ?? []), run.calls]);
  }
  for (const [kind, calls] of byKind)
    if (calls.length >= 3) typical.set(kind, median(calls)!);
  for (const run of runs) {
    const base = typical.get(`${run.harness}:${run.role ?? ""}`);
    if (
      base &&
      run.calls !== null &&
      run.calls >= USAGE_CALLS_MULTIPLE * base &&
      run.calls >= 20
    )
      run.flags.push(
        `${run.calls} calls, ${Math.round(run.calls / base)}× a typical ${
          run.role ?? "unknown-role"
        } run`,
      );
    if (
      run.context?.percent !== null &&
      run.context?.percent !== undefined &&
      run.context.percent >= USAGE_CONTEXT_FULL * 100
    )
      run.flags.push(`context ${run.context.percent}% full`);
  }
  return runs.sort(
    (a, b) => (b.tokens ?? -1) - (a.tokens ?? -1) || a.key.localeCompare(b.key),
  );
}

/** The run in an agent's pane, its newest when several match. */
export function usageRunForPane(
  runs: readonly UsageRunView[],
  target: { connectionId: string; generation: number; paneId: string },
) {
  let best: UsageRunView | null = null;
  for (const run of runs)
    if (
      run.identity?.connection_id === target.connectionId &&
      run.identity.connection_generation === target.generation &&
      run.identity.pane_id === target.paneId &&
      (!best || run.lastAt > best.lastAt)
    )
      best = run;
  return best;
}

// ── Runs at once, by hour ───────────────────────────────────────────────

export type UsageHour = {
  /** The hour's start (a UTC hour boundary). */
  start: number;
  /**
   * Per harness, the runs going at the busiest moment of the hour, split by
   * work: the most that overlapped, never a count of the hour's runs.
   */
  counts: Map<string, Record<UsageWork, number>>;
};

export type UsageConcurrency = {
  hours: UsageHour[];
  /** Harnesses with any run in the answer, Claude and Codex first. */
  harnesses: string[];
  /** The busiest hour per harness: most runs at once, and when. */
  peaks: Map<string, { count: number; start: number }>;
  /** The tallest stack across harnesses, for one shared scale. */
  max: number;
};

const emptyWork = (): Record<UsageWork, number> => ({
  building: 0,
  checking: 0,
  other: 0,
});

/**
 * The most runs going at one moment within [from, until), per work: a sweep
 * over each run's spans. Spans are closed, so runs that touch overlap.
 */
export function usagePeakAtOnce(
  runs: readonly Pick<UsageRunView, "spans" | "work">[],
  from: number,
  until: number,
): Record<UsageWork, number> | null {
  const events: [number, 0 | 1, UsageWork][] = [];
  for (const run of runs)
    for (const [a, b] of run.spans)
      if (a < until && b >= from) {
        events.push([Math.max(a, from), 0, run.work]);
        events.push([Math.min(b, until), 1, run.work]);
      }
  if (!events.length) return null;
  // Starts before ends at one instant: closed spans that touch overlap.
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const now = emptyWork();
  let best: Record<UsageWork, number> | null = null;
  let bestTotal = 0;
  for (const [, end, work] of events) {
    now[work] += end ? -1 : 1;
    const total = now.building + now.checking + now.other;
    if (!end && total > bestTotal) {
      bestTotal = total;
      best = { ...now };
    }
  }
  return best;
}

/**
 * Runs going at once in each of the last `span` hours (ending with the
 * current hour): per harness, the busiest moment of each hour, from each
 * run's spans of work.
 */
export function usageConcurrency(
  runs: readonly UsageRunView[],
  data: Pick<WorldUsageAnalytics, "observed_at">,
  span = 24,
): UsageConcurrency {
  const end = Math.floor(data.observed_at / HOUR_MS) * HOUR_MS;
  const first = end - (span - 1) * HOUR_MS;
  const hours: UsageHour[] = Array.from({ length: span }, (_, i) => ({
    start: first + i * HOUR_MS,
    counts: new Map(),
  }));
  const byHarness = new Map<string, UsageRunView[]>();
  for (const run of runs)
    byHarness.set(run.harness, [...(byHarness.get(run.harness) ?? []), run]);
  for (const [harness, list] of byHarness) {
    const recent = list.filter((run) => run.spans.some(([, b]) => b >= first));
    for (const hour of hours) {
      const peak = usagePeakAtOnce(recent, hour.start, hour.start + HOUR_MS);
      if (peak) hour.counts.set(harness, peak);
    }
  }
  const order = (h: string) => (h === "claude" ? 0 : h === "codex" ? 1 : 2);
  const list = [...byHarness.keys()].sort(
    (a, b) => order(a) - order(b) || a.localeCompare(b),
  );
  const peaks = new Map<string, { count: number; start: number }>();
  let max = 0;
  for (const hour of hours)
    for (const [harness, counts] of hour.counts) {
      const total = counts.building + counts.checking + counts.other;
      max = Math.max(max, total);
      if (total > (peaks.get(harness)?.count ?? 0))
        peaks.set(harness, { count: total, start: hour.start });
    }
  return { hours, harnesses: list, peaks, max };
}

/** The whole window's busiest hour per harness. */
export function usageWeekPeaks(
  runs: readonly UsageRunView[],
  data: Pick<WorldUsageAnalytics, "observed_at" | "window">,
) {
  const span = Math.max(
    1,
    Math.ceil((data.observed_at - data.window.from) / HOUR_MS),
  );
  return usageConcurrency(runs, data, Math.min(span, 8 * 24)).peaks;
}

// ── Totals by role and by item ──────────────────────────────────────────

export type UsageRoleTotal = {
  role: UsageRunRole | null;
  label: string;
  work: UsageWork;
  runs: number;
  /** Sum over runs with known tokens; null when none is known. */
  tokens: number | null;
  /** The typical (median) run's tokens. */
  perRun: number | null;
  callsPerRun: number | null;
};

const ROLE_ORDER: (UsageRunRole | null)[] = [
  "worker",
  "fixer",
  "reviewer",
  "checker",
  "scout",
  null,
];
const ROLE_LABEL: Record<string, string> = {
  worker: "Worker",
  fixer: "Fixer",
  reviewer: "Reviewer",
  checker: "Checker",
  scout: "Scout",
};
export const usageRoleLabel = (role: UsageRunRole | null) =>
  role ? ROLE_LABEL[role]! : "Unknown role";

export function usageByRole(runs: readonly UsageRunView[]): UsageRoleTotal[] {
  return ROLE_ORDER.flatMap((role) => {
    const list = runs.filter((run) => run.role === role);
    if (!list.length) return [];
    const known = list.flatMap((run) =>
      run.tokens === null ? [] : [run.tokens],
    );
    return [
      {
        role,
        label: usageRoleLabel(role),
        work: usageWork(role),
        runs: list.length,
        tokens: known.length ? known.reduce((a, b) => a + b, 0) : null,
        perRun: median(known),
        callsPerRun: median(
          list.flatMap((run) => (run.calls === null ? [] : [run.calls])),
        ),
      },
    ];
  });
}

export type UsageItemTotal = {
  item: UsageItem;
  runs: number;
  tokens: number | null;
  roles: { role: UsageRunRole | null; runs: number }[];
  /** Fixer runs on it; more than one is a review loop worth a look. */
  fixerRounds: number;
  live: boolean;
};

export function usageByItem(runs: readonly UsageRunView[]): UsageItemTotal[] {
  const items = new Map<string, UsageRunView[]>();
  for (const run of runs)
    items.set(run.item.key, [...(items.get(run.item.key) ?? []), run]);
  return [...items.values()]
    .map((list) => {
      const known = list.flatMap((r) => (r.tokens === null ? [] : [r.tokens]));
      return {
        item: list[0]!.item,
        runs: list.length,
        tokens: known.length ? known.reduce((a, b) => a + b, 0) : null,
        roles: ROLE_ORDER.flatMap((role) => {
          const count = list.filter((r) => r.role === role).length;
          return count ? [{ role, runs: count }] : [];
        }),
        fixerRounds: list.filter((r) => r.role === "fixer").length,
        live: list.some((r) => r.live),
      };
    })
    .sort(
      (a, b) =>
        Number(a.item.key === "none") - Number(b.item.key === "none") ||
        (b.tokens ?? -1) - (a.tokens ?? -1) ||
        a.item.label.localeCompare(b.item.label),
    );
}

/** Runs on now per harness, from the read. */
export function usageLiveByHarness(runs: readonly UsageRunView[]) {
  const live = new Map<string, number>();
  for (const run of runs)
    if (run.live) live.set(run.harness, (live.get(run.harness) ?? 0) + 1);
  return live;
}

/** "14:00" in the viewer's zone, for an hour column. */
const hourFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});
export const usageHourLabel = (at: number) => hourFormat.format(at);

/** Whole days of the answer's window, for "this week" wording. */
export const usageWindowDays = (data: WorldUsageAnalytics) =>
  Math.max(1, Math.round((data.window.until - data.window.from) / DAY_MS));

/** A run's numbers, saying plainly what its harness does not expose. */
export function usageRunFacts(run: UsageRunView) {
  if (run.source === "world")
    return [
      run.activeMs === null
        ? "at work unknown"
        : `at work ${usageDuration(run.activeMs)}`,
      run.waitingMs ? `waited on you ${usageDuration(run.waitingMs)}` : null,
      run.tokensReadable
        ? "tokens unknown: no log run joined"
        : "tokens and cost not available for this harness",
    ]
      .filter(Boolean)
      .join(" · ");
  return [
    `${usageCount(run.tokens)} tokens`,
    run.calls === null ? null : `${run.calls} calls`,
    `largest prompt ${usageCount(run.maxPrompt)}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

// ── One agent's usage, by its agent IDs ─────────────────────────────────

/**
 * The rows of an answer grouped by agent that are one of `ids` (the agent
 * IDs a resident was counted under, shared/apartments.ts).
 */
export function usageAgentRows(
  data: WorldUsageAnalytics,
  ids: readonly string[],
): UsageAnalyticsRow[] {
  const wanted = new Set(ids);
  return data.group_by === "agent"
    ? data.rows.filter(
        (row) => row.dimension !== null && wanted.has(row.dimension),
      )
    : [];
}

/** A sum of metrics: unknown when none was read, partly read when some was. */
function sumMetric(metrics: readonly UsageMetric[]): UsageMetric {
  const known = metrics.filter((m) => m.value !== null);
  if (!known.length) return { value: null, coverage: "unknown" };
  return {
    value: known.reduce((sum, m) => sum + m.value!, 0),
    coverage:
      known.length === metrics.length &&
      known.every((m) => m.coverage === "observed")
        ? "observed"
        : "partial",
  };
}

/** Several rows' metrics as one (token kinds are not summed). */
export function usageSumRows(
  rows: readonly UsageAnalyticsMetrics[],
): UsageAnalyticsMetrics {
  const sum = (
    key: Exclude<keyof UsageAnalyticsMetrics, "tokens" | "observed_ms">,
  ) => sumMetric(rows.map((row) => row[key]));
  return {
    active_ms: sum("active_ms"),
    waiting_on_you_ms: sum("waiting_on_you_ms"),
    observed_ms: rows.reduce((total, row) => total + row.observed_ms, 0),
    tokens: null,
    total_tokens: sum("total_tokens"),
    reported_cost_usd: sum("reported_cost_usd"),
    estimated_cost_usd: sum("estimated_cost_usd"),
    prs_opened: sum("prs_opened"),
    prs_merged: sum("prs_merged"),
  };
}

/**
 * Why World has no usage for a resident (#1101): World counts only agents
 * it watched at work and keeps which runs they were in memory until the
 * census finds them, so one found in its harness's history (ended before
 * World saw it, run outside it, or left before a World restart) has none;
 * nor do records from before World kept usage. Otherwise nothing of it was
 * counted this week.
 */
export function residentUsageGap(resident: {
  move_out?: string;
  usage_agent_ids?: readonly string[];
}) {
  if (resident.usage_agent_ids?.length) return "nothing recorded this week";
  return resident.move_out === "found"
    ? "found in its history, World kept no usage for it"
    : "World did not record it while it ran";
}

/**
 * For each resident, how many others were counted under one of its usage
 * agent IDs. Usage counts a core terminal's program as one agent, so the
 * runs that follow each other in one shell terminal share a row (#1101).
 */
export function residentUsageSharing(
  residents: readonly { id: string; usage_agent_ids?: readonly string[] }[],
): Map<string, number> {
  const holders = new Map<string, Set<string>>();
  for (const resident of residents)
    for (const id of resident.usage_agent_ids ?? []) {
      let set = holders.get(id);
      if (!set) holders.set(id, (set = new Set()));
      set.add(resident.id);
    }
  const sharing = new Map<string, number>();
  for (const resident of residents) {
    const others = new Set<string>();
    for (const id of resident.usage_agent_ids ?? [])
      for (const other of holders.get(id) ?? [])
        if (other !== resident.id) others.add(other);
    if (others.size) sharing.set(resident.id, others.size);
  }
  return sharing;
}

/**
 * One agent's week in words, as its card says a run's: time at work,
 * waiting on you, and tokens, or that its harness's tokens are not
 * available. Null `metrics` (no row this week) is "usage unknown", with
 * `why` when known. `shared` other runs counted with it are named, since
 * the numbers include theirs. Like the card line it leaves "(partly read)"
 * to the Breakdown it opens.
 */
export function usageAgentFacts(
  metrics: UsageAnalyticsMetrics | null,
  harness: string | null,
  why?: string | null,
  shared = 0,
) {
  if (!metrics)
    return why ? `Usage unknown: ${why}` : "This week: usage unknown";
  const { active_ms: active, waiting_on_you_ms: waiting } = metrics;
  const tokens = metrics.total_tokens;
  const alongside = shared
    ? `, with ${shared} other run${shared === 1 ? "" : "s"} in its terminal`
    : "";
  return `This week${alongside}: ${[
    active.value === null
      ? "at work unknown"
      : `at work ${usageDuration(active.value)}`,
    waiting.value === null
      ? "waiting on you unknown"
      : `waited on you ${usageDuration(waiting.value)}`,
    harness && !usageReadsTokens(harness)
      ? "tokens and cost not available for this harness"
      : tokens.value === null
        ? "tokens unknown"
        : `${usageCount(tokens.value)} tokens`,
  ].join(" · ")}`;
}
