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

type Extra = {
  waiting?: number | null;
  cost?: number | null;
  opened?: number | null;
  merged?: number | null;
};

function metrics(
  tokens: number | null,
  active: number | null = null,
  extra: Extra = {},
) {
  const maybe = (value: number | null | undefined) =>
    value === null || value === undefined ? unknown : known(value);
  return {
    active_ms: active === null ? unknown : known(active),
    waiting_on_you_ms: maybe(extra.waiting),
    observed_ms: (active ?? 0) + (extra.waiting ?? 0),
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
    estimated_cost_usd: maybe(extra.cost),
    prs_opened: maybe(extra.opened),
    prs_merged: maybe(extra.merged),
  } satisfies UsageAnalyticsMetrics;
}

type Run = {
  harness: string;
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
  /** World's measurement alone: a harness whose logs World cannot read. */
  world?: boolean;
  /** Minutes it waited on you. */
  waiting?: number;
  room?: 1 | 2;
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
  {
    harness: "cursor",
    role: null,
    from: 5,
    to: 0,
    tokens: 0,
    calls: 0,
    prompt: 0,
    world: true,
    waiting: 25,
    room: 2,
  },
  {
    harness: "opencode",
    role: null,
    from: 28,
    to: 26,
    tokens: 0,
    calls: 0,
    prompt: 0,
    world: true,
    room: 2,
  },
];

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
    const waiting = run.waiting === undefined ? null : run.waiting * 60_000;
    const active = (run.from - run.to) * HOUR - (waiting ?? 0);
    return {
      key: run.world ? `world:fixture-agent-${index}` : `run_fixture_${index}`,
      dimension: run.world
        ? `world:fixture-agent-${index}`
        : `run_fixture_${index}`,
      identity: {
        connection_id: CONNECTION,
        connection_generation: 1,
        agent_id: `fixture-agent-${index}`,
        pane_id: live ? `fixture-pane-${index}` : null,
        workspace_id: `fixture-room-${run.room ?? 1}`,
        project_id: "project_fixture",
      },
      ...(run.world
        ? metrics(null, active, { waiting })
        : metrics(run.tokens, active, {
            waiting: waiting ?? 0,
            cost: Math.round(run.tokens * 0.6) / 1_000_000,
            opened: run.role === "worker" && run.pr ? 1 : null,
            merged: run.role === "worker" && run.pr ? Number(run.to > 0) : null,
          })),
      run: {
        source: run.world ? ("world" as const) : ("session-log" as const),
        harness: run.harness,
        models: run.world
          ? []
          : [run.harness === "claude" ? "synthetic-claude" : "synthetic-codex"],
        role: run.role,
        branch: run.pr ? `crew/${run.pr}` : (run.branch ?? null),
        pull_request: run.pr
          ? { key: `github:pr:example-org/web-app#${run.pr}`, number: run.pr }
          : null,
        attribution: run.pr ? ("link" as const) : ("none" as const),
        calls: run.world ? null : run.calls,
        first_at: first,
        last_at: last,
        max_prompt_tokens: run.world ? null : run.prompt,
        spans: [[first, last] as [number, number]],
        context: run.context
          ? { used_tokens: run.context[0], window_tokens: run.context[1] }
          : null,
      },
    };
  });
  const inWindow = runRows.filter((row) => row.run!.last_at >= from);
  const add = (
    rows: UsageAnalyticsRow[],
    key: keyof UsageAnalyticsMetrics,
  ): number | null => {
    const known = rows.flatMap((r) => {
      const metric = r[key] as UsageMetric;
      return metric.value === null ? [] : [metric.value];
    });
    return known.length ? known.reduce((a, b) => a + b, 0) : null;
  };
  const merged = (rows: UsageAnalyticsRow[]) => {
    const tokens = add(rows, "total_tokens");
    return metrics(tokens, add(rows, "active_ms"), {
      waiting: add(rows, "waiting_on_you_ms"),
      cost: add(rows, "estimated_cost_usd"),
      opened: add(rows, "prs_opened"),
      merged: add(rows, "prs_merged"),
    });
  };
  const byKey = (
    keyOf: (row: UsageAnalyticsRow) => string,
    identityOf: (row: UsageAnalyticsRow) => UsageAnalyticsRow["identity"],
  ) => {
    const groups = new Map<string, UsageAnalyticsRow[]>();
    for (const row of inWindow)
      groups.set(keyOf(row), [...(groups.get(keyOf(row)) ?? []), row]);
    return [...groups].map(([key, list]) => ({
      key,
      dimension: key,
      identity: identityOf(list[0]!),
      ...merged(list),
    }));
  };
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
        ...(list.length ? merged(list) : metrics(null)),
      });
    }
  } else if (group === "agent")
    rows = byKey(
      (r) => r.identity!.agent_id!,
      (r) => ({ ...r.identity!, workspace_id: null, project_id: null }),
    );
  else if (group === "room")
    rows = byKey(
      (r) => JSON.stringify([CONNECTION, 1, r.identity!.workspace_id]),
      (r) => ({
        ...r.identity!,
        agent_id: null,
        pane_id: null,
        project_id: null,
      }),
    );
  else
    rows = byKey(
      () => "project_fixture",
      () => null,
    );
  return {
    version: 1,
    incarnation: "usage-fixture",
    observed_at: now,
    window: { kind: window, from, until },
    retention_days: 7,
    group_by: group,
    total: inWindow.length ? merged(inWindow) : metrics(null),
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
