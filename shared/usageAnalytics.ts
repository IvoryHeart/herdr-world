import type { UsageLimit, UsageSource, UsageTokens } from "./usage";

export const USAGE_ANALYTICS_GROUPS = [
  "agent",
  "project",
  "room",
  "day",
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
export type UsageAnalyticsRow = UsageAnalyticsMetrics & {
  key: string;
  /** Null is the explicit unattributed bucket, including for project/agent. */
  dimension: string | null;
  identity: UsageAnalyticsIdentity | null;
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
