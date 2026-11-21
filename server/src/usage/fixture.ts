import type { WorldUsageSnapshot } from "../../../shared/usage";
import type { WorldSnapshotResult } from "../world/snapshot";
import { WorldUsageAnalyticsService, usageProject } from "./analytics";
import { UsageActivity } from "./activity";
import { emptyTokens } from "./totals";

/** CLI testing switch: entirely synthetic, no service, files or provider calls. */
export async function usageAnalyticsFixture(
  params: Record<string, unknown> = {},
) {
  const now = Date.parse("2026-11-19T12:00:00Z"),
    day = "2026-11-19";
  const pane = {
    pane_id: "p1",
    terminal_id: "term1",
    workspace_id: "room1",
    tab_id: "desk1",
    agent: "claude",
    agent_session: { kind: "id", value: "synthetic-session" },
    cwd: "/synthetic/project",
    agent_status: "working",
  };
  const project = usageProject(
    "fixture",
    1,
    "/synthetic/project/.git",
    "Example project",
  );
  const activity = new UsageActivity();
  activity.observe("fixture", 1, [pane], now - 20_000);
  activity.observe(
    "fixture",
    1,
    [{ ...pane, agent_status: "blocked" }],
    now - 10_000,
  );
  const snapshot = {
    version: 1,
    incarnation: "usage-fixture",
    observed_at: now,
    window: {
      kind: params.window === "7d" ? "7d" : "today",
      from:
        Date.parse(`${day}T00:00:00Z`) -
        (params.window === "7d" ? 6 * 86_400_000 : 0),
      until: now,
    },
    retention_days: 7,
    truncated: false,
    entities: [
      {
        id: "synthetic-usage",
        kind: "usage",
        connector: "harness-log",
        connection_id: "fixture",
        connection_generation: 1,
        pane_id: "p1",
        workspace_id: "room1",
        tab_id: "desk1",
        harness: "claude",
        model: "synthetic-model",
        day,
        tokens: { ...emptyTokens(), input: 1200, cache_read: 400, output: 100 },
        total_tokens: 1700,
        responses: 1,
        first_at: now - 30_000,
        last_at: now - 30_000,
        observation_span_ms: 0,
        estimated_cost_usd: null,
        price_table_version: null,
        state: "available",
      },
    ],
    sources: [
      {
        connection_id: "fixture",
        connection_generation: 1,
        harness: "claude",
        state: "available",
        checked_at: now,
        last_success_at: now,
        refreshing: false,
      },
    ],
    limits: [
      {
        connection_id: "fixture",
        connection_generation: 1,
        harness: "codex",
        state: "available",
        source: "codex-session-log",
        reason: null,
        observed_at: now,
        windows: [
          { window_minutes: 300, used_percent: 100, resets_at: now + 3600_000 },
        ],
        reached: null,
      },
    ],
  } as WorldUsageSnapshot;
  const service = new WorldUsageAnalyticsService({
    usage: async () => snapshot,
    topology: async () =>
      ({
        connections: [
          {
            connection_id: "fixture",
            generation: 1,
            snapshot_generation: 1,
            stale: false,
            actionable: true,
            snapshot: {
              panes: [pane],
              agents: [pane],
              workspaces: [],
              tabs: [],
            },
          },
        ],
      }) as unknown as WorldSnapshotResult,
    sources: async () => ({
      observedAt: now,
      refreshing: false,
      sources: [],
      links: [],
      actions: [],
      items: [
        {
          key: "github:pr:example/project#1",
          source: "github",
          kind: "pull_request",
          ref: "example/project#1",
          title: "Example change",
          url: "https://example.test/pr/1",
          lane: "merged",
          status: "merged",
          roles: ["author"],
          updatedAt: now - 1000,
          createdAt: now - 60_000,
          finishedAt: now - 1000,
        },
      ],
    }),
    activity,
    project: async () => project,
    current: () => true,
  });
  return service.get(params);
}
