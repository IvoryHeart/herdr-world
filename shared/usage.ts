/** Disjoint categories; reasoning is already included in output. */
export type UsageTokens = {
  input: number;
  cache_read: number;
  cache_write: number;
  output: number;
  reasoning: number;
};
export type UsageState =
  | "available"
  | "partial"
  | "missing"
  | "stale"
  | "unavailable";
export type UsageTarget = {
  connection_id: string;
  connection_generation: number;
  workspace_id: string | null;
  tab_id: string | null;
  pane_id: string | null;
};
export type UsageEntity = UsageTarget & {
  id: string;
  kind: "usage";
  connector: "harness-log";
  harness: string;
  model: string;
  day: string;
  tokens: UsageTokens;
  total_tokens: number;
  responses: number;
  first_at: number;
  last_at: number;
  observation_span_ms: number;
  estimated_cost_usd: number | null;
  price_table_version: string | null;
  state: UsageState;
};
export type UsageSource = {
  connection_id: string;
  connection_generation: number;
  harness: string;
  state: UsageState | "unsupported";
  checked_at: number;
  last_success_at: number | null;
  refreshing: boolean;
};
export type UsageTotal = {
  tokens: UsageTokens;
  total_tokens: number;
  estimated_cost_usd: number | null;
  unpriced_records: number;
  records: number;
};
export type UsageRollup = UsageTotal &
  UsageTarget & {
    level: "host" | "workspace" | "tab" | "pane";
  };
export type WorldUsageSnapshot = {
  version: 1;
  incarnation: string;
  observed_at: number;
  window: { kind: "today" | "7d"; from: number; until: number };
  retention_days: 7;
  truncated: boolean;
  entities: UsageEntity[];
  sources: UsageSource[];
  total: UsageTotal;
  unattributed: UsageTotal;
  rollups: UsageRollup[];
  telemetry: {
    role: "comparison";
    included_in_totals: false;
    window_seconds: number | null;
    state: "available" | "degraded" | "unavailable";
    observed_at: number;
    total_tokens: number;
  };
};
