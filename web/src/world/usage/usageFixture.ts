import type { UsageLimit, UsageRunRole } from "../../../../shared/usage";
import type {
  UsageAnalyticsMetrics,
  UsageAnalyticsQuery,
  UsageAnalyticsRow,
  UsageMetric,
  WorldUsageAnalytics,
} from "../../../../shared/usageAnalytics";

/**
 * A testing-only switch for the Usage screens and Town's observatory (#1029):
 * open World with `?usageFixture` and every `world.usage.analytics` read
 * answers with synthetic runs, limits and projects instead of the service's,
 * until the page reloads. The page drops the parameter at once.
 *
 * - `?usageFixture` (or `=busy`): a busy week. Claude's week runs out early,
 *   its 5 h window and Codex's week are under-used, Codex's 5 h window is too
 *   new to judge; a fixer is on its third round with a near-full context.
 * - `?usageFixture=reached`: Claude refused work; its limit resets soon.
 * - `?usageFixture=empty`: nothing observed, so every number is unknown.
 *
 * Only analytics reads change; `world.usage.get`, settings and transcripts are
 * untouched. Names, branches and pull requests are synthetic.
 */
export type UsageFixtureMode = "busy" | "reached" | "empty";

const PARAM = "usageFixture";
let mode: UsageFixtureMode | null | undefined;

/** The switch, read once per page load; the parameter is removed. */
export function usageFixtureMode(): UsageFixtureMode | null {
  if (mode !== undefined) return mode;
  mode = null;
  if (typeof location === "undefined") return mode;
  const url = new URL(location.href);
  const value = url.searchParams.get(PARAM);
  if (value === null) return mode;
  mode = value === "reached" || value === "empty" ? value : "busy";
  url.searchParams.delete(PARAM);
  history.replaceState(history.state, "", url);
  return mode;
}

/** For tests: forget the switch so the next read sees the URL again. */
export function resetUsageFixture() {
  mode = undefined;
}

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
};

/** The client the Usage store reads through: the fixture's while it is on. */
export function usageFixtureClient(client: Client, clock = Date.now): Client {
  return {
    call: (method, params) => {
      const fixture = usageFixtureMode();
      if (!fixture || method !== "world.usage.analytics")
        return client.call(method, params);
      return Promise.resolve(
        usageFixture(clock(), fixture, (params ?? {}) as UsageAnalyticsQuery),
      );
    },
  };
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const CONNECTION = "fixture";
const known = (value: number): UsageMetric => ({
  value,
  coverage: "partial",
});
const unknown: UsageMetric = { value: null, coverage: "unknown" };

function metrics(tokens: number | null, active: number | null = null) {
  return {
    active_ms: active === null ? unknown : known(active),
    waiting_on_you_ms: unknown,
    observed_ms: active ?? 0,
    tokens:
      tokens === null
        ? null
        : {
            input: Math.round(tokens * 0.08),
            cache_read: Math.round(tokens * 0.86),
            cache_write: Math.round(tokens * 0.04),
            output: tokens - Math.round(tokens * 0.98),
            reasoning: 0,
          },
    total_tokens: tokens === null ? unknown : known(tokens),
    reported_cost_usd: unknown,
    estimated_cost_usd: unknown,
    prs_opened: unknown,
    prs_merged: unknown,
  } satisfies UsageAnalyticsMetrics;
}

type Run = {
  harness: "claude" | "codex";
  role: UsageRunRole | null;
  pr?: number;
  branch?: string;
  /** Hours ago it started and last answered. */
  from: number;
  to: number;
  tokens: number;
  calls: number;
  prompt: number;
  context?: [number, number];
};

/** A week of synthetic crew runs, newest last. */
const RUNS: Run[] = [
  {
    harness: "claude",
    role: "worker",
    pr: 101,
    from: 30,
    to: 27,
    tokens: 9_400_000,
    calls: 120,
    prompt: 140_000,
  },
  {
    harness: "codex",
    role: "reviewer",
    pr: 101,
    from: 27,
    to: 26,
    tokens: 2_100_000,
    calls: 41,
    prompt: 90_000,
  },
  {
    harness: "claude",
    role: "fixer",
    pr: 101,
    from: 26,
    to: 24,
    tokens: 4_800_000,
    calls: 70,
    prompt: 120_000,
  },
  {
    harness: "codex",
    role: "checker",
    pr: 101,
    from: 24,
    to: 23,
    tokens: 1_200_000,
    calls: 30,
    prompt: 70_000,
  },
  {
    harness: "claude",
    role: "fixer",
    pr: 101,
    from: 9,
    to: 6,
    tokens: 6_900_000,
    calls: 96,
    prompt: 160_000,
  },
  {
    harness: "claude",
    role: "worker",
    pr: 102,
    from: 8,
    to: 5,
    tokens: 7_100_000,
    calls: 104,
    prompt: 130_000,
  },
  {
    harness: "codex",
    role: "worker",
    branch: "crew/103",
    from: 7,
    to: 2,
    tokens: 5_600_000,
    calls: 88,
    prompt: 110_000,
  },
  {
    harness: "codex",
    role: "reviewer",
    pr: 102,
    from: 5,
    to: 4,
    tokens: 1_900_000,
    calls: 36,
    prompt: 85_000,
  },
  {
    harness: "claude",
    role: "scout",
    from: 6,
    to: 5,
    tokens: 800_000,
    calls: 18,
    prompt: 60_000,
  },
  {
    harness: "codex",
    role: null,
    branch: "main",
    from: 4,
    to: 3,
    tokens: 300_000,
    calls: 9,
    prompt: 40_000,
  },
  {
    harness: "codex",
    role: "checker",
    pr: 102,
    from: 3,
    to: 2,
    tokens: 900_000,
    calls: 22,
    prompt: 60_000,
  },
  {
    harness: "claude",
    role: "reviewer",
    pr: 104,
    from: 2,
    to: 0,
    tokens: 2_400_000,
    calls: 39,
    prompt: 100_000,
    context: [102_000, 200_000],
  },
  {
    harness: "codex",
    role: "worker",
    pr: 104,
    from: 3,
    to: 0,
    tokens: 4_100_000,
    calls: 61,
    prompt: 150_000,
    context: [150_000, 272_000],
  },
  {
    harness: "claude",
    role: "fixer",
    pr: 101,
    from: 3,
    to: 0,
    tokens: 12_300_000,
    calls: 228,
    prompt: 176_000,
    context: [172_000, 200_000],
  },
];

function masks(start: number, end: number) {
  const days = new Map<string, number>();
  for (let at = Math.floor(start / HOUR) * HOUR; at <= end; at += HOUR) {
    const day = new Date(at).toISOString().slice(0, 10);
    days.set(
      day,
      ((days.get(day) ?? 0) | (1 << new Date(at).getUTCHours())) >>> 0,
    );
  }
  return [...days].map(([day, mask]) => ({ day, mask }));
}

function limits(now: number, mode: UsageFixtureMode): UsageLimit[] {
  if (mode === "empty") return [];
  const base = {
    connection_id: CONNECTION,
    connection_generation: 1,
    reason: null,
    observed_at: now - 2 * 60_000,
  };
  return [
    mode === "reached"
      ? {
          ...base,
          harness: "claude",
          state: "available",
          source: "claude-transcript",
          windows: [],
          reached: { window_minutes: 300, resets_at: now + 40 * 60_000 },
        }
      : {
          ...base,
          harness: "claude",
          state: "available",
          source: "claude-status-line",
          reached: null,
          windows: [
            {
              window_minutes: 300,
              used_percent: 40,
              resets_at: now + 2 * HOUR,
            },
            {
              window_minutes: 10080,
              used_percent: 71,
              resets_at: now + 3 * DAY,
            },
          ],
        },
    {
      ...base,
      harness: "codex",
      state: "available",
      source: "codex-session-log",
      reached: null,
      windows: [
        { window_minutes: 300, used_percent: 4, resets_at: now + 4.7 * HOUR },
        { window_minutes: 10080, used_percent: 18, resets_at: now + 2 * DAY },
      ],
    },
  ];
}

/** The fixture's answer to one analytics query, as of `now`. */
export function usageFixture(
  now: number,
  mode: UsageFixtureMode,
  query: UsageAnalyticsQuery = {},
): WorldUsageAnalytics {
  const group = query.group_by ?? "day";
  const window = query.window ?? "today";
  const until = now;
  const today = Math.floor(now / DAY) * DAY;
  const from = window === "7d" ? today - 6 * DAY : today;
  const runs = mode === "empty" ? [] : RUNS;
  const runRows: UsageAnalyticsRow[] = runs.map((run, index) => {
    const first = now - run.from * HOUR - 7 * 60_000;
    const last = now - run.to * HOUR - (run.to ? 3 * 60_000 : 60_000);
    const live = run.to === 0;
    return {
      key: `run_fixture_${index}`,
      dimension: `run_fixture_${index}`,
      identity: {
        connection_id: CONNECTION,
        connection_generation: 1,
        agent_id: live ? `fixture-agent-${index}` : null,
        pane_id: live ? `fixture-pane-${index}` : null,
        workspace_id: null,
        project_id: "project_fixture",
      },
      ...metrics(run.tokens, (run.from - run.to) * HOUR),
      run: {
        harness: run.harness,
        models: [
          run.harness === "claude" ? "synthetic-claude" : "synthetic-codex",
        ],
        role: run.role,
        branch: run.pr ? `crew/${run.pr}` : (run.branch ?? null),
        pull_request: run.pr
          ? { key: `github:pr:example-org/web-app#${run.pr}`, number: run.pr }
          : null,
        calls: run.calls,
        first_at: first,
        last_at: last,
        max_prompt_tokens: run.prompt,
        hours: masks(first, last),
        context: run.context
          ? { used_tokens: run.context[0], window_tokens: run.context[1] }
          : null,
      },
    };
  });
  const inWindow = runRows.filter((row) => row.run!.last_at >= from);
  const sum = (rows: UsageAnalyticsRow[]) =>
    rows.length
      ? rows.reduce((s, r) => s + (r.total_tokens.value ?? 0), 0)
      : null;
  const active = (rows: UsageAnalyticsRow[]) =>
    rows.length ? rows.reduce((s, r) => s + (r.active_ms.value ?? 0), 0) : null;
  let rows: UsageAnalyticsRow[];
  if (group === "run") rows = inWindow;
  else if (group === "day") {
    rows = [];
    for (let day = from; day <= today; day += DAY) {
      const name = new Date(day).toISOString().slice(0, 10);
      const list = inWindow.filter(
        (r) => new Date(r.run!.last_at).toISOString().slice(0, 10) === name,
      );
      rows.push({
        key: name,
        dimension: name,
        identity: null,
        ...metrics(sum(list), active(list)),
      });
    }
  } else
    rows = inWindow.length
      ? [
          {
            key: "project_fixture",
            dimension: group === "project" ? "project_fixture" : "fixture",
            identity: null,
            ...metrics(sum(inWindow), active(inWindow)),
          },
        ]
      : [];
  return {
    version: 1,
    incarnation: "usage-fixture",
    observed_at: now,
    window: { kind: window, from, until },
    retention_days: 7,
    group_by: group,
    total: metrics(sum(inWindow), active(inWindow)),
    rows: rows.map(({ run, ...row }) =>
      group === "run" ? { ...row, run } : row,
    ),
    projects: [
      {
        id: "project_fixture",
        connection_id: CONNECTION,
        connection_generation: 1,
        label: "web-app",
      },
    ],
    sources: [],
    limits: limits(now, mode),
    coverage: {
      truncated: false,
      activity: mode === "empty" ? "unknown" : "partial",
      pull_requests: "unknown",
      pull_request_source: {
        state: "unavailable",
        checked_at: null,
        last_success_at: null,
        refreshing: false,
      },
      project_lookups_truncated: false,
      history: "available",
      time_basis: "observed-runtime-status",
    },
  };
}
