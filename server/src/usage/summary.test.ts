import { expect, test } from "bun:test";
import type { UsageEntity, WorldUsageSnapshot } from "../../../shared/usage";
import { boundUsageDetails, summarizeUsage } from "./summary";

test("worst-case multi-host details fit the frame without reducing city or host balances", () => {
  const entities: UsageEntity[] = [];
  for (let host = 0; host < 16; host++)
    for (let pane = 0; pane < 128; pane++)
      for (let day = 1; day <= 7; day++)
        entities.push({
          id: `usage_${host}_${pane}_${day}`,
          kind: "usage",
          connector: "harness-log",
          connection_id: `host-${host}`,
          connection_generation: 1,
          workspace_id: `room-${pane}`,
          tab_id: `tab-${pane}`,
          pane_id: `pane-${pane}`,
          harness: "codex",
          model: "synthetic-model",
          day: `2026-11-0${day}`,
          tokens: {
            input: 10,
            cache_read: 100,
            cache_write: 5,
            output: 20,
            reasoning: 10,
          },
          total_tokens: 135,
          responses: 1,
          first_at: 1,
          last_at: 1,
          observation_span_ms: 0,
          estimated_cost_usd: 0.0001,
          price_table_version: "example",
          state: "available",
        });
  const snapshot: WorldUsageSnapshot = {
    version: 1,
    incarnation: "example",
    observed_at: Date.UTC(2026, 10, 7, 12),
    window: {
      kind: "7d",
      from: Date.UTC(2026, 10, 1),
      until: Date.UTC(2026, 10, 7, 12),
    },
    retention_days: 7,
    truncated: false,
    entities,
    sources: [],
    limits: [],
    ...summarizeUsage(entities),
    today: summarizeUsage(entities.filter((e) => e.day === "2026-11-07")),
    telemetry: {
      role: "comparison",
      included_in_totals: false,
      window_seconds: null,
      state: "unavailable",
      observed_at: 0,
      total_tokens: 0,
    },
  };
  boundUsageDetails(snapshot);
  expect(snapshot.details_truncated).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(snapshot))).toBeLessThanOrEqual(
    768 * 1024,
  );
  expect(snapshot.total.records).toBe(16 * 128 * 7);
  expect(snapshot.total.total_tokens).toBe(16 * 128 * 7 * 135);
  expect(snapshot.today!.total.total_tokens).toBe(16 * 128 * 135);
  for (const summary of [snapshot, snapshot.today!]) {
    const hosts = summary.rollups.filter((r) => r.level === "host");
    expect(hosts).toHaveLength(16);
    expect(hosts.reduce((sum, h) => sum + h.total_tokens, 0)).toBe(
      summary.total.total_tokens,
    );
    expect(hosts.every((h) => h.unattributed?.total_tokens === 0)).toBe(true);
  }
});
