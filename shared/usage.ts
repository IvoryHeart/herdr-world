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
  /** Subscription limits per host and harness, independent of `window`. */
  limits: UsageLimit[];
  telemetry: {
    role: "comparison";
    included_in_totals: false;
    window_seconds: number | null;
    state: "available" | "degraded" | "unavailable";
    observed_at: number;
    total_tokens: number;
  };
};

/** One subscription window: its length, how much is used and when it resets. */
export type UsageLimitWindow = {
  window_minutes: number;
  /** 0–100, as the harness reported it. */
  used_percent: number;
  /** Milliseconds since the epoch, or null when the harness gave none. */
  resets_at: number | null;
};
/**
 * The newest subscription-limit observation for one harness on one host.
 * Only numbers, window lengths and times: never account IDs, plan names,
 * credits, credentials or provider errors.
 */
export type UsageLimit = {
  connection_id: string;
  connection_generation: number;
  harness: "codex" | "claude";
  /**
   * `available`: current; `stale`: older than its reset or a few hours;
   * `missing`: no observation on this host; `unsupported`: the harness keeps
   * no readable record of its limits, see `reason`.
   */
  state: "available" | "stale" | "missing" | "unsupported";
  source: "codex-session-log" | null;
  reason: string | null;
  observed_at: number | null;
  windows: UsageLimitWindow[];
};
/** An observation older than this is stale even before its window resets. */
export const USAGE_LIMIT_STALE_MS = 3 * 60 * 60 * 1000;
export const CLAUDE_LIMITS_REASON =
  "Claude Code does not save how much of its limits is used";

/** True once an observation is too old to trust, or any window has reset since. */
export function usageLimitExpired(
  observedAt: number,
  windows: readonly UsageLimitWindow[],
  now: number,
) {
  return (
    now - observedAt > USAGE_LIMIT_STALE_MS ||
    windows.some((w) => w.resets_at !== null && w.resets_at <= now)
  );
}
