import type {
  UsageEntity,
  UsageRollup,
  UsageTokens,
  UsageTotal,
} from "../../../shared/usage";

export const emptyTokens = (): UsageTokens => ({
  input: 0,
  cache_read: 0,
  cache_write: 0,
  output: 0,
  reasoning: 0,
});
export const tokenTotal = (t: UsageTokens) =>
  t.input + t.cache_read + t.cache_write + t.output;
export type UsagePriceTable = {
  version: string;
  models: Record<string, Omit<UsageTokens, "reasoning">>;
};

/** An explicit operator-maintained table, never a claim of current provider prices. */
export function parseUsagePrices(value: unknown): UsagePriceTable | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const table = value as UsagePriceTable;
  if (
    typeof table.version !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,80}$/.test(table.version) ||
    !table.models ||
    typeof table.models !== "object" ||
    Array.isArray(table.models) ||
    Object.keys(table.models).length > 128
  )
    return null;
  const models: UsagePriceTable["models"] = Object.create(null);
  for (const [model, rates] of Object.entries(table.models)) {
    if (
      !/^[a-zA-Z0-9_.:/@+-]{1,160}$/.test(model) ||
      !rates ||
      typeof rates !== "object"
    )
      return null;
    const row = {
      input: rates.input,
      output: rates.output,
      cache_read: rates.cache_read,
      cache_write: rates.cache_write,
    };
    if (
      Object.values(row).some(
        (rate) =>
          typeof rate !== "number" ||
          !Number.isFinite(rate) ||
          rate < 0 ||
          rate > 1e6,
      )
    )
      return null;
    models[model] = row;
  }
  return { version: table.version, models };
}

export function estimateUsage(
  tokens: UsageTokens,
  model: string,
  table: UsagePriceTable | null,
) {
  const rates =
    table && Object.hasOwn(table.models, model) ? table.models[model] : null;
  return rates
    ? (tokens.input * rates.input +
        tokens.output * rates.output +
        tokens.cache_read * rates.cache_read +
        tokens.cache_write * rates.cache_write) /
        1e6
    : null;
}

export function usageTotal(entities: UsageEntity[]): UsageTotal {
  const total: UsageTotal = {
    tokens: emptyTokens(),
    total_tokens: 0,
    estimated_cost_usd: null,
    unpriced_records: 0,
    records: 0,
  };
  let priced = 0;
  for (const e of entities) {
    if (
      e.state === "stale" ||
      e.state === "unavailable" ||
      e.state === "missing"
    )
      continue;
    for (const key of Object.keys(total.tokens) as (keyof UsageTokens)[])
      total.tokens[key] += e.tokens[key];
    total.records++;
    if (e.estimated_cost_usd === null) total.unpriced_records++;
    else priced += e.estimated_cost_usd;
  }
  total.total_tokens = tokenTotal(total.tokens);
  if (total.records > 0 && total.unpriced_records === 0)
    total.estimated_cost_usd = priced;
  return total;
}

export function usageRollups(entities: UsageEntity[]): UsageRollup[] {
  const groups = new Map<
    string,
    {
      target: Pick<
        UsageRollup,
        | "level"
        | "connection_id"
        | "connection_generation"
        | "workspace_id"
        | "tab_id"
        | "pane_id"
      >;
      rows: UsageEntity[];
    }
  >();
  for (const e of entities) {
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
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { target, rows: [] }));
      group.rows.push(e);
    }
  }
  return [...groups.values()].map((group) => ({
    ...group.target,
    ...usageTotal(group.rows),
  }));
}
