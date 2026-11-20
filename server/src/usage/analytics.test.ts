import { expect, test } from "bun:test";
import type { WorldUsageSnapshot } from "../../../shared/usage";
import type { WorldSnapshotResult } from "../world/snapshot";
import type { WorldSourcesSnapshot } from "../../../shared/worldSources";
import {
  WorldUsageAnalyticsService,
  parseAnalyticsQuery,
  usageProject,
} from "./analytics";
import { UsageActivity } from "./activity";
import { emptyTokens } from "./totals";
import { usageAnalyticsFixture } from "./fixture";
const at = Date.parse("2026-11-19T12:00:00Z");
function setup() {
  let current = true;
  const pane = {
    pane_id: "p1",
    terminal_id: "t1",
    workspace_id: "w1",
    tab_id: "d1",
    agent: "claude",
    agent_session: { kind: "id", value: "PRIVATE_SESSION_SENTINEL" },
    cwd: "/synthetic/project",
    agent_status: "working",
  };
  const row: WorldUsageSnapshot["entities"][number] = {
    connection_id: "alpha",
    connection_generation: 1,
    pane_id: "p1",
    workspace_id: "w1",
    tab_id: "d1",
    id: "row",
    kind: "usage",
    connector: "harness-log",
    harness: "claude",
    model: "model",
    day: "2026-11-19",
    tokens: { ...emptyTokens(), input: 10 },
    total_tokens: 10,
    responses: 1,
    first_at: at - 10_000,
    last_at: at - 5000,
    observation_span_ms: 5000,
    estimated_cost_usd: null,
    price_table_version: null,
    state: "available",
  };
  const usage = {
    version: 1,
    incarnation: "test",
    observed_at: at,
    window: {
      kind: "7d",
      from: at - 12 * 3600_000 - 6 * 86_400_000,
      until: at,
    },
    retention_days: 7,
    truncated: false,
    entities: [row],
    sources: [],
    limits: [],
  } as unknown as WorldUsageSnapshot;
  const topology = {
    connections: [
      {
        connection_id: "alpha",
        generation: 1,
        snapshot_generation: 1,
        stale: false,
        actionable: true,
        snapshot: { panes: [pane], agents: [pane] },
      },
    ],
  } as unknown as WorldSnapshotResult;
  const sources: WorldSourcesSnapshot = {
    observedAt: at,
    refreshing: false,
    sources: [],
    items: [],
    links: [],
    actions: [],
  };
  const activity = new UsageActivity();
  const project = usageProject(
    "alpha",
    1,
    "/synthetic/project/.git",
    "project",
  );
  const service = new WorldUsageAnalyticsService({
    usage: async () => usage,
    topology: async () => topology,
    sources: async () => sources,
    activity,
    project: async () => project,
    current: () => current,
  });
  return {
    service,
    usage,
    row,
    pane,
    sources,
    topology,
    activity,
    project,
    retire: () => {
      current = false;
    },
  };
}
test("analytics uses all numeric details, groups seven UTC days and preserves unknown costs/time", async () => {
  const s = setup();
  s.usage.entities = Array.from({ length: 180 }, (_, n) => ({
    ...s.row,
    id: `row${n}`,
  }));
  const data = await s.service.get({ window: "7d" });
  expect(data.rows).toHaveLength(7);
  expect(data.total.total_tokens.value).toBe(1800);
  expect(data.total.active_ms.value).toBeNull();
  expect(data.total.waiting_on_you_ms.value).toBeNull();
  expect(data.total.reported_cost_usd.value).toBeNull();
  expect(data.total.estimated_cost_usd.value).toBeNull();
  expect(data.rows[0]?.total_tokens).toEqual({
    value: null,
    coverage: "unknown",
  });
  const json = JSON.stringify(data);
  for (const secret of [
    "PRIVATE_SESSION_SENTINEL",
    "/synthetic/project",
    "cwd",
    "agent_session",
  ])
    expect(json).not.toContain(secret);
});
test("agent/project/room grouping and qualified filters share one total", async () => {
  const s = setup();
  for (const group_by of ["agent", "project", "room"] as const) {
    const data = await s.service.get({ group_by });
    expect(data.total.total_tokens.value).toBe(10);
    expect(data.rows[0]?.dimension).not.toBeNull();
  }
  expect(
    (
      await s.service.get({
        connection_id: "alpha",
        connection_generation: 2,
        pane_id: "p1",
      })
    ).total.total_tokens.value,
  ).toBeNull();
  expect(
    (await s.service.get({ project_id: s.project.id })).total.total_tokens
      .value,
  ).toBe(10);
  s.retire();
  const retired = await s.service.get({ group_by: "agent" });
  expect(retired.rows[0]?.dimension).toBeNull();
  expect(retired.projects).toEqual([]);
});
test("stale or unlinked usage never acquires current attribution", async () => {
  const s = setup();
  s.row.state = "stale";
  const stale = await s.service.get({ group_by: "project" });
  expect(stale.rows[0]?.dimension).toBeNull();
  expect(stale.total.total_tokens.value).toBeNull();
  s.row.state = "available";
  s.row.pane_id = null;
  expect(
    (await s.service.get({ group_by: "agent" })).rows[0]?.dimension,
  ).toBeNull();
});
test("PR events deduplicate globally, date by source timestamps and never guess agent authorship", async () => {
  const s = setup();
  const item = {
    key: "github:pr:example/project#1",
    source: "github" as const,
    kind: "pull_request" as const,
    ref: "example/project#1",
    title: "synthetic",
    url: "https://example.test/pr/1",
    roles: ["author" as const],
    lane: "merged" as const,
    status: "merged",
    updatedAt: at - 1000,
    createdAt: at - 86_400_000,
    finishedAt: at - 1000,
  };
  s.sources.items = [
    item,
    { ...item },
    { ...item, key: "review-only", roles: ["reviewer"] },
  ];
  let data = await s.service.get();
  expect(data.total.prs_opened.value).toBe(1);
  expect(data.total.prs_merged.value).toBe(1);
  expect(
    data.rows.find((r) => r.dimension === "2026-11-18")?.prs_opened.value,
  ).toBe(1);
  data = await s.service.get({ group_by: "agent" });
  expect(data.rows.find((r) => r.dimension === null)?.prs_merged.value).toBe(1);
  expect(
    data.rows.find((r) => r.dimension !== null)?.prs_merged.value,
  ).toBeNull();
});
test("missing, malformed, unqualified and unbounded queries refuse before reading", () => {
  for (const query of [
    { window: "month" },
    { group_by: "harness" },
    { pane_id: "p1" },
    { connection_id: "a" },
    { connection_generation: 1 },
    { connection_id: "a", connection_generation: -1 },
    { path: "/synthetic" },
    { fixture: true },
    { project_id: "bad" },
    { pane_id: [] },
    { limit: 1e9 },
  ])
    expect(() => parseAnalyticsQuery(query)).toThrow();
});
test("synthetic fixture exercises real aggregation, waits and a limit without I/O", async () => {
  const data = await usageAnalyticsFixture({ group_by: "day", window: "7d" });
  expect(data.total).toMatchObject({
    total_tokens: { value: 1700 },
    active_ms: { value: 10_000 },
    waiting_on_you_ms: { value: 10_000 },
    reported_cost_usd: { value: null },
    prs_opened: { value: 1 },
    prs_merged: { value: 1 },
  });
  expect(data.limits[0]?.windows[0]?.used_percent).toBe(100);
  expect(data.rows).toHaveLength(7);
});
test("group clipping preserves totals before the response bound", async () => {
  const s = setup();
  const panes = Array.from({ length: 600 }, (_, n) => ({
    ...s.pane,
    pane_id: `p${n}`,
    terminal_id: `t${n}`,
    agent_session: { kind: "id", value: `synthetic-${n}` },
  }));
  s.topology.connections[0]!.snapshot!.panes = panes;
  s.topology.connections[0]!.snapshot!.agents = panes;
  s.usage.entities = panes.map((p, n) => ({
    ...s.row,
    id: `usage${n}`,
    pane_id: p.pane_id,
  }));
  const data = await s.service.get({ group_by: "agent" });
  expect(data.rows).toHaveLength(512);
  expect(data.total.total_tokens.value).toBe(6000);
  expect(data.coverage.truncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(data))).toBeLessThan(768 * 1024);
});
test("runs group one session's days and models, heaviest first, with role, PR and live context", async () => {
  const s = setup();
  const run = {
    run_id: "run_a",
    role: "fixer" as const,
    branch: "crew/42",
    hours: 1 << 11,
    max_prompt_tokens: 300,
  };
  s.usage.entities = [
    { ...s.row, ...run, id: "a1", total_tokens: 40, responses: 3 },
    {
      ...s.row,
      ...run,
      id: "a2",
      model: "other",
      total_tokens: 60,
      responses: 2,
      hours: 1 << 10,
      max_prompt_tokens: 500,
    },
    {
      ...s.row,
      id: "b1",
      run_id: "run_b",
      role: null,
      branch: null,
      total_tokens: 5,
    },
  ];
  s.usage.contexts = [
    {
      connection_id: "alpha",
      connection_generation: 1,
      workspace_id: "w1",
      tab_id: "d1",
      pane_id: "p1",
      harness: "claude",
      model: "model",
      used_tokens: 500,
      window_tokens: 1000,
      observed_at: at,
    },
  ];
  s.sources.items = [
    {
      key: "github:pr:example/project#9",
      source: "github",
      kind: "pull_request",
      ref: "example/project#9",
      number: 9,
      branch: "crew/42",
      title: "synthetic",
      url: "https://example.test/pr/9",
      roles: ["author"],
      lane: "review",
      status: "open",
      updatedAt: at - 1000,
    },
  ];
  const data = await s.service.get({ group_by: "run" });
  expect(data.total.total_tokens.value).toBe(105);
  expect(data.rows.map((r) => r.dimension)).toEqual(["run_a", "run_b"]);
  expect(data.rows[0]).toMatchObject({
    total_tokens: { value: 100 },
    identity: { pane_id: "p1" },
    run: {
      harness: "claude",
      models: ["other", "model"],
      role: "fixer",
      branch: "crew/42",
      pull_request: { key: "github:pr:example/project#9", number: 9 },
      calls: 5,
      max_prompt_tokens: 500,
      hours: [{ day: "2026-11-19", mask: (1 << 10) | (1 << 11) }],
      context: { used_tokens: 500, window_tokens: 1000 },
    },
  });
  expect(data.rows[1]?.run).toMatchObject({
    role: null,
    pull_request: null,
    max_prompt_tokens: null,
  });
});
