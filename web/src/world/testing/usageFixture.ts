import type {
  UsageEntity,
  UsageRollup,
  UsageSource,
  UsageState,
  UsageTokens,
  UsageTotal,
  WorldUsageSnapshot,
} from "../../../../shared/usage";

/**
 * Synthetic `world.usage.get` reads for tests and captures: real-looking
 * numbers with no real transcripts, hosts or models. Totals, rollups and
 * estimates follow the service's projection (server/src/usage/totals.ts,
 * which the browser build cannot import), so a fixture obeys the same rules
 * as a live read: stale rows stay out of totals, each level is its own
 * projection of the rows, and one unpriced row makes a total's cost null.
 */

type UsagePriceTable = {
  version: string;
  models: Record<string, Omit<UsageTokens, "reasoning">>;
};

const tokenTotal = (t: UsageTokens) =>
  t.input + t.cache_read + t.cache_write + t.output;

function estimateUsage(
  tokens: UsageTokens,
  model: string,
  table: UsagePriceTable | null,
) {
  const rates = table?.models[model];
  return rates
    ? (tokens.input * rates.input +
        tokens.output * rates.output +
        tokens.cache_read * rates.cache_read +
        tokens.cache_write * rates.cache_write) /
        1e6
    : null;
}

function usageTotal(entities: readonly UsageEntity[]): UsageTotal {
  const tokens: UsageTokens = {
    input: 0,
    cache_read: 0,
    cache_write: 0,
    output: 0,
    reasoning: 0,
  };
  let records = 0;
  let unpriced = 0;
  let priced = 0;
  for (const e of entities) {
    if (e.state !== "available" && e.state !== "partial") continue;
    for (const key of Object.keys(tokens) as (keyof UsageTokens)[])
      tokens[key] += e.tokens[key];
    records++;
    if (e.estimated_cost_usd === null) unpriced++;
    else priced += e.estimated_cost_usd;
  }
  return {
    tokens,
    total_tokens: tokenTotal(tokens),
    estimated_cost_usd: records > 0 && unpriced === 0 ? priced : null,
    unpriced_records: unpriced,
    records,
  };
}

function usageRollups(entities: readonly UsageEntity[]): UsageRollup[] {
  const groups = new Map<
    string,
    { target: UsageRollup; rows: UsageEntity[] }
  >();
  for (const e of entities)
    for (const level of ["host", "workspace", "tab", "pane"] as const) {
      if (level !== "host" && !e[`${level}_id`]) continue;
      const target = {
        level,
        connection_id: e.connection_id,
        connection_generation: e.connection_generation,
        workspace_id: level === "host" ? null : e.workspace_id,
        tab_id: level === "host" || level === "workspace" ? null : e.tab_id,
        pane_id: level === "pane" ? e.pane_id : null,
      };
      const key = JSON.stringify(target);
      const group = groups.get(key) ?? {
        target: { ...target, ...usageTotal([]) },
        rows: [],
      };
      groups.set(key, group);
      group.rows.push(e);
    }
  return [...groups.values()].map(({ target, rows }) => ({
    ...target,
    ...usageTotal(rows),
  }));
}

/** A synthetic price table, in USD per million tokens. */
export const USAGE_FIXTURE_PRICES: UsagePriceTable = {
  version: "example-2026-11",
  models: {
    "example-large": {
      input: 3,
      cache_read: 0.3,
      cache_write: 3.75,
      output: 15,
    },
    "example-small": {
      input: 0.8,
      cache_read: 0.08,
      cache_write: 1,
      output: 4,
    },
  },
};

export type UsageFixtureRow = {
  connection: string;
  generation?: number;
  workspace?: string | null;
  tab?: string | null;
  pane?: string | null;
  harness?: string;
  model?: string;
  /** Uncached input; cache reads and output default to realistic shares. */
  input: number;
  cacheRead?: number;
  output?: number;
  state?: UsageState;
};

export type UsageFixtureSource = {
  connection: string;
  generation?: number;
  harness?: string;
  state: UsageSource["state"];
};

let ids = 0;

function entity(
  row: UsageFixtureRow,
  prices: UsagePriceTable | null,
  day: string,
): UsageEntity {
  const tokens: UsageTokens = {
    input: row.input,
    cache_read: row.cacheRead ?? row.input * 6,
    cache_write: Math.round(row.input / 4),
    output: row.output ?? Math.round(row.input / 3),
    reasoning: 0,
  };
  const model = row.model ?? "example-large";
  const stale = row.state === "stale";
  return {
    id: `usage_example_${++ids}`,
    kind: "usage",
    connector: "harness-log",
    connection_id: row.connection,
    connection_generation: row.generation ?? 1,
    // The service drops a stale row's attribution (usage/service.ts).
    workspace_id: stale ? null : (row.workspace ?? null),
    tab_id: stale ? null : (row.tab ?? null),
    pane_id: stale ? null : (row.pane ?? null),
    harness: row.harness ?? "claude",
    model,
    day,
    tokens,
    total_tokens: tokenTotal(tokens),
    responses: 12,
    first_at: 0,
    last_at: 60_000,
    observation_span_ms: 60_000,
    estimated_cost_usd: estimateUsage(tokens, model, prices),
    price_table_version: prices?.version ?? null,
    state: row.state ?? "available",
  };
}

/** A read of the given rows and sources, shaped exactly as the service's. */
export function usageFixture({
  rows,
  sources,
  window = "today",
  prices = USAGE_FIXTURE_PRICES,
  truncated = false,
  observedAt = Date.UTC(2026, 10, 7, 15),
}: {
  rows: readonly UsageFixtureRow[];
  sources: readonly UsageFixtureSource[];
  window?: "today" | "7d";
  prices?: UsagePriceTable | null;
  truncated?: boolean;
  observedAt?: number;
}): WorldUsageSnapshot {
  const day = new Date(observedAt).toISOString().slice(0, 10);
  const from = Date.parse(day) - (window === "7d" ? 6 * 86_400_000 : 0);
  const entities = rows.map((row) => entity(row, prices, day));
  return {
    version: 1,
    incarnation: "example",
    observed_at: observedAt,
    window: { kind: window, from, until: observedAt },
    retention_days: 7,
    truncated,
    entities,
    sources: sources.map((source) => ({
      connection_id: source.connection,
      connection_generation: source.generation ?? 1,
      harness: source.harness ?? "claude",
      state: source.state,
      checked_at: observedAt,
      last_success_at: source.state === "missing" ? null : observedAt,
      refreshing: false,
    })),
    total: usageTotal(entities),
    unattributed: usageTotal(entities.filter((e) => !e.pane_id)),
    rollups: usageRollups(entities),
    limits: [],
    telemetry: {
      role: "comparison",
      included_in_totals: false,
      window_seconds: null,
      state: "unavailable",
      observed_at: observedAt,
      total_tokens: 0,
    },
  };
}

/**
 * A busy synthetic town: the studio's three rooms and a session it could
 * not place, the lab's one room and a stale row, and a host whose harness
 * logs are missing.
 */
export function townUsageFixture(
  options: { window?: "today" | "7d"; prices?: UsagePriceTable | null } = {},
) {
  const scale = options.window === "7d" ? 5 : 1;
  const at = (workspace: string, tab: string) => ({
    workspace,
    tab,
    pane: `${tab}:p`,
  });
  return usageFixture({
    ...options,
    rows: [
      {
        connection: "studio",
        ...at("alpha", "alpha:t0"),
        input: 42_000 * scale,
      },
      {
        connection: "studio",
        ...at("alpha", "alpha:t1"),
        model: "example-small",
        input: 18_000 * scale,
      },
      { connection: "studio", ...at("beta", "beta:t0"), input: 25_000 * scale },
      {
        connection: "studio",
        ...at("gamma", "gamma:t0"),
        model: "example-small",
        input: 9_000 * scale,
      },
      {
        connection: "studio",
        ...at("delta", "delta:t0"),
        model: "example-small",
        input: 2_000 * scale,
      },
      // A session the service could not tie to a pane.
      { connection: "studio", input: 6_000 * scale },
      { connection: "lab", ...at("omega", "omega:t0"), input: 30_000 * scale },
      { connection: "lab", input: 50_000, state: "stale" },
    ],
    sources: [
      { connection: "studio", state: "available" },
      { connection: "studio", harness: "codex", state: "missing" },
      { connection: "lab", state: "available" },
      { connection: "archive", state: "missing" },
    ],
  });
}
