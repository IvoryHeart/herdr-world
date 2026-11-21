import type {
  UsageLimit,
  UsageRunRole,
  UsageSource,
  UsageTokens,
} from "./usage";

export const USAGE_ANALYTICS_GROUPS = [
  "agent",
  "project",
  "room",
  "day",
  "run",
] as const;
export type UsageAnalyticsGroup = (typeof USAGE_ANALYTICS_GROUPS)[number];
export type UsageAnalyticsQuery = {
  window?: "today" | "7d";
  group_by?: UsageAnalyticsGroup;
  connection_id?: string;
  connection_generation?: number;
  pane_id?: string;
  workspace_id?: string;
  project_id?: string;
};
/** A known subtotal, never a claim of complete provider or lifetime coverage. */
export type UsageMetric = {
  value: number | null;
  coverage: "observed" | "partial" | "unknown";
};
export type UsageAnalyticsMetrics = {
  active_ms: UsageMetric;
  waiting_on_you_ms: UsageMetric;
  observed_ms: number;
  tokens: UsageTokens | null;
  total_tokens: UsageMetric;
  reported_cost_usd: UsageMetric;
  estimated_cost_usd: UsageMetric;
  prs_opened: UsageMetric;
  prs_merged: UsageMetric;
};
export type UsageAnalyticsIdentity = {
  connection_id: string;
  connection_generation: number;
  agent_id: string | null;
  pane_id: string | null;
  workspace_id: string | null;
  project_id: string | null;
};
/**
 * One run (a harness session) in `group_by: "run"`: what it is, how hard it
 * worked and when. Numbers only; the role is a fixed word, never prompt text.
 */
export type UsageAnalyticsRun = {
  /**
   * `session-log`: the harness's own session log, with World's measured
   * activity joined in; `world`: World's measurement alone (time at work,
   * waiting), so calls, tokens and cost are not available for it.
   */
  source: "session-log" | "world";
  harness: string;
  /** Models it used, most tokens first. */
  models: string[];
  /** The role its first prompt names; null when it names none. */
  role: UsageRunRole | null;
  /** The checkout branch the harness recorded; null when unknown. */
  branch: string | null;
  /**
   * Its pull request: only from a work link its own agent session
   * validated. A branch alone never names one (it carries no repository).
   */
  pull_request: { key: string; number: number | null } | null;
  /**
   * How `pull_request` was found; `ambiguous` when a catalogue pull request
   * has its branch but no validated link proves it, so none is named.
   */
  attribution: "link" | "ambiguous" | "none";
  /** API responses, each counted once; null for World's measurement alone. */
  calls: number | null;
  first_at: number;
  last_at: number;
  /** The largest single prompt; null from a service that did not read it. */
  max_prompt_tokens: number | null;
  /**
   * When it was going: responses at most ten minutes apart, joined with the
   * spans World saw its agent working. Sorted, bounded [from, to] pairs.
   */
  spans: [number, number][];
  /** Its pane's current context, when it is running in a pane now. */
  context: { used_tokens: number; window_tokens: number | null } | null;
};
export type UsageAnalyticsRow = UsageAnalyticsMetrics & {
  key: string;
  /** Null is the explicit unattributed bucket, including for project/agent. */
  dimension: string | null;
  identity: UsageAnalyticsIdentity | null;
  /** Present on `group_by: "run"` rows with a run. */
  run?: UsageAnalyticsRun;
};
export type UsageProject = {
  id: string;
  connection_id: string;
  connection_generation: number;
  /** A checkout name, never a filesystem path. */
  label: string;
};
export type WorldUsageAnalytics = {
  version: 1;
  incarnation: string;
  observed_at: number;
  window: { kind: "today" | "7d"; from: number; until: number };
  retention_days: 7;
  group_by: UsageAnalyticsGroup;
  total: UsageAnalyticsMetrics;
  rows: UsageAnalyticsRow[];
  projects: UsageProject[];
  sources: UsageSource[];
  limits: UsageLimit[];
  coverage: {
    truncated: boolean;
    activity: "partial" | "unknown";
    pull_requests: "partial" | "unknown";
    pull_request_source: {
      state:
        | "connected"
        | "not_connected"
        | "error"
        | "disabled"
        | "unavailable";
      checked_at: number | null;
      last_success_at: number | null;
      refreshing: boolean;
    };
    project_lookups_truncated: boolean;
    history: "available" | "unavailable";
    /** Status time is observed while World runs, never CPU or billable time. */
    time_basis: "observed-runtime-status";
  };
};
