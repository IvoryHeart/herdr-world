import { expect, test } from "bun:test";
import { WorldUsageService } from "./service";
import { usageDigest, type RuntimeUsage } from "./host";
import { parseUsagePrices, estimateUsage } from "./totals";
import type { WorldSnapshotResult } from "../world/snapshot";
import { systemScheduler } from "../service/ports";
import { emptyOfficeObservability } from "../world/observability";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage } from "./collector";
import { createUsageProjection } from "./projection";
import { createRuntimeUsage } from "./host";

const at = Date.parse("2026-11-01T12:00:00Z");
const row = (session = "session-a", day = "2026-11-01") => ({
  harness: "claude",
  day,
  model: "synthetic-model",
  session_key: usageDigest(`claude\0${session}`),
  file_keys: [],
  partial: false,
  responses: 1,
  tokens: { input: 10, cache_read: 5, cache_write: 2, output: 3, reasoning: 0 },
  first_at: at - 200,
  last_at: at - 100,
});
const agent = {
  agent: "claude",
  pane_id: "p1",
  tab_id: "t1",
  workspace_id: "w1",
  terminal_id: "term1",
  agent_session: { kind: "id", value: "session-a" },
};
function value(): RuntimeUsage {
  return {
    rows: [row()],
    truncated: false,
    unsupported: [],
    sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
      harness,
      state: harness === "claude" ? "available" : "missing",
    })),
    bindings: [
      {
        harness: "claude",
        session_key: row().session_key,
        file_key: null,
        pane_id: "p1",
        tab_id: "t1",
        workspace_id: "w1",
      },
    ],
  };
}

function setup(hosts = ["alpha"], collectionMs = 20_000) {
  let now = at,
    generation = 1,
    ready = true,
    serial = 0;
  let data = value(),
    agents = [agent],
    calls = 0;
  let read: (signal: AbortSignal) => Promise<RuntimeUsage> = async () =>
    structuredClone(data);
  const runtime = {
    usage: async (
      _agents: unknown,
      _now: number,
      _isCurrent: () => boolean,
      signal: AbortSignal,
    ) => {
      calls++;
      return read(signal);
    },
  };
  const service = new WorldUsageService({
    incarnation: "synthetic-incarnation",
    now: () => now,
    scheduler: systemScheduler,
    waitMs: 100,
    collectionMs,
    ids: { issue: async () => `usage_${++serial}` },
    connections: {
      list: () =>
        hosts.map((id) => ({
          id,
          generation,
          label: id,
          source: "test",
          is_default: id === hosts[0],
          state: ready ? "ready" : "disconnected",
        })),
      readyRuntimeLease: () => {
        if (!ready) return null;
        const captured = generation;
        return {
          generation: captured,
          runtime,
          isCurrent: () => ready && captured === generation,
        };
      },
    },
    topology: async () =>
      ({
        connections: hosts.map((connection_id) => ({
          connection_id,
          generation,
          snapshot_generation: generation,
          stale: false,
          actionable: true,
          snapshot: { agents },
        })),
      }) as unknown as WorldSnapshotResult,
    prices: async () => ({
      version: "synthetic-v1",
      models: {
        "synthetic-model": {
          input: 2,
          cache_read: 1,
          cache_write: 3,
          output: 4,
        },
      },
    }),
    telemetry: async () => ({
      ...emptyOfficeObservability(),
      health: "available",
      totalUsage: 999,
      observedAt: now,
      windowSeconds: 86400,
    }),
  });
  return {
    service,
    calls: () => calls,
    data: (v: RuntimeUsage) => {
      data = v;
    },
    advance: (ms: number) => {
      now += ms;
    },
    offline: () => {
      ready = false;
    },
    replace: () => {
      generation++;
      for (const id of hosts)
        service.connectionStatus({ id, generation, state: "ready" });
    },
    agents: (v: typeof agents) => {
      agents = v;
    },
    read: (fn: typeof read) => {
      read = fn;
    },
  };
}

test("shared read returns view-neutral entities and all four attribution rollups without OTel double count", async () => {
  const s = setup();
  const result = await s.service.get();
  expect(result.total).toMatchObject({
    total_tokens: 20,
    records: 1,
    unpriced_records: 0,
  });
  expect(result.entities[0]).toMatchObject({
    id: "usage_1",
    connector: "harness-log",
    pane_id: "p1",
    workspace_id: "w1",
    connection_id: "alpha",
    connection_generation: 1,
    price_table_version: "synthetic-v1",
    estimated_cost_usd: 0.000043,
  });
  expect(result.rollups.map((r) => r.level)).toEqual([
    "host",
    "workspace",
    "tab",
    "pane",
  ]);
  expect(result.telemetry).toMatchObject({
    included_in_totals: false,
    total_tokens: 999,
  });
  expect(
    result.sources.find((s) => s.harness === "pi")?.last_success_at,
  ).toBeNull();
  expect((await s.service.get()).entities[0]?.id).toBe("usage_1");
  expect(s.calls()).toBe(1);
  await s.service.close();
});

test("unlinked and multiply claimed sessions count only once at host level", async () => {
  for (const duplicate of [false, true]) {
    const s = setup(),
      data = value();
    data.bindings = duplicate
      ? [
          ...data.bindings,
          { ...data.bindings[0]!, pane_id: "p2", tab_id: "t2" },
        ]
      : [];
    s.data(data);
    const result = await s.service.get();
    expect(result.entities[0]?.pane_id).toBeNull();
    expect(result.unattributed.total_tokens).toBe(20);
    expect(result.rollups.map((r) => r.level)).toEqual(["host"]);
    await s.service.close();
  }
});

test("equal native sessions on distinct hosts remain isolated", async () => {
  const s = setup(["alpha", "beta"]);
  const result = await s.service.get();
  expect(result.total.total_tokens).toBe(40);
  expect(new Set(result.entities.map((r) => r.id)).size).toBe(2);
  expect(result.entities.map((r) => r.connection_id)).toEqual([
    "alpha",
    "beta",
  ]);
  await s.service.close();
});

test("failed hosts retain bounded stale observations outside fresh totals", async () => {
  const s = setup();
  await s.service.get();
  s.offline();
  const result = await s.service.get();
  expect(result.entities[0]).toMatchObject({ state: "stale", pane_id: null });
  expect(result.sources[0]?.state).toBe("stale");
  expect(result.total).toMatchObject({
    records: 0,
    total_tokens: 0,
    estimated_cost_usd: null,
  });
  await s.service.close();
});

test("a removed log keeps its last bounded observation stale rather than fresh zero", async () => {
  const s = setup();
  await s.service.get();
  s.advance(31_000);
  s.data({
    ...value(),
    rows: [],
    sources: value().sources.map((source) => ({ ...source, state: "missing" })),
  });
  const result = await s.service.get();
  expect(result.entities[0]?.state).toBe("stale");
  expect(result.total.records).toBe(0);
  expect(result.sources[0]?.state).toBe("missing");
  await s.service.close();
});

test("retired collector results cannot attach to a replacement runtime", async () => {
  const s = setup(),
    pending = Promise.withResolvers<RuntimeUsage>();
  s.read(() => pending.promise);
  const response = s.service.get();
  await Promise.resolve();
  await Promise.resolve();
  expect(s.calls()).toBe(1);
  s.replace();
  pending.resolve(value());
  expect((await response).entities).toEqual([]);
  await s.service.close();
});

test("topology changes invalidate cached attribution without throwing away host usage", async () => {
  const s = setup();
  await s.service.get();
  s.agents([{ ...agent, terminal_id: "replacement-terminal" }]);
  const result = await s.service.get();
  expect(result.entities[0]?.pane_id).toBeNull();
  expect(result.total.total_tokens).toBe(20);
  await s.service.close();
});

test("UTC midnight resets today while seven-day rows survive the query reset", async () => {
  const s = setup();
  await s.service.get();
  s.advance(12 * 60 * 60 * 1000 + 1);
  expect((await s.service.get()).total.total_tokens).toBe(0);
  expect((await s.service.get({ window: "7d" })).total.total_tokens).toBe(20);
  await expect(s.service.get({ window: "forever" })).rejects.toThrow(
    "today or 7d",
  );
  await s.service.close();
});

test("admission and aggregate frames are bounded and clipping is visible", async () => {
  const s = setup(),
    data = value();
  data.rows = Array.from({ length: 1024 }, (_, i) => row(`session-${i}`));
  s.data(data);
  const result = await s.service.get();
  expect(result.truncated).toBe(true);
  expect(result.entities.length).toBeLessThanOrEqual(128);
  expect(result.total.records).toBe(result.entities.length);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024 * 1024);
  await s.service.close();
});

test("shutdown drains in-flight collection and fences later allocations and reads", async () => {
  const s = setup(),
    pending = Promise.withResolvers<RuntimeUsage>();
  s.read(() => pending.promise);
  const response = s.service.get();
  await Promise.resolve();
  await Promise.resolve();
  expect(s.calls()).toBe(1);
  const close = s.service.close();
  pending.resolve(value());
  await close;
  expect((await response).entities).toEqual([]);
  await expect(s.service.get()).rejects.toThrow("closed");
});

test("a slow connector returns explicit refreshing state and concurrent reads coalesce", async () => {
  const s = setup(),
    pending = Promise.withResolvers<RuntimeUsage>();
  s.read(() => pending.promise);
  const first = await s.service.get();
  expect(first.entities).toEqual([]);
  expect(first.sources.every((source) => source.refreshing)).toBe(true);
  const second = s.service.get();
  pending.resolve(value());
  expect((await second).total.total_tokens).toBe(20);
  expect(s.calls()).toBe(1);
  await s.service.close();
});

test("price table validation preserves unknown cost and never bills reasoning twice", () => {
  const table = parseUsagePrices({
    version: "synthetic-v1",
    models: { m: { input: 2, cache_read: 1, cache_write: 3, output: 4 } },
  });
  expect(
    estimateUsage(
      { input: 10, cache_read: 5, cache_write: 2, output: 3, reasoning: 3 },
      "m",
      table,
    ),
  ).toBe(0.000043);
  expect(estimateUsage(row().tokens, "unknown-model", table)).toBeNull();
  expect(
    parseUsagePrices({
      version: "v1",
      models: { m: { input: -1, output: 0, cache_read: 0, cache_write: 0 } },
    }),
  ).toBeNull();
  expect(
    parseUsagePrices({
      version: "v1",
      models: {
        m: { input: 1, output: Infinity, cache_read: 0, cache_write: 0 },
      },
    }),
  ).toBeNull();
});

test("a replacement generation cancels old work and starts without waiting for its source release", async () => {
  const s = setup(),
    started = Promise.withResolvers<void>();
  let oldSignal: AbortSignal | undefined;
  s.read((signal) => {
    if (oldSignal) return Promise.resolve(value());
    oldSignal = signal;
    started.resolve();
    return new Promise((_resolve, reject) =>
      signal.addEventListener("abort", () => reject(new Error("cancelled")), {
        once: true,
      }),
    );
  });
  const old = s.service.get();
  await started.promise;
  s.replace();
  expect(oldSignal?.aborted).toBe(true);
  expect((await s.service.get()).entities[0]?.connection_generation).toBe(2);
  await old;
  expect(s.calls()).toBe(2);
  await s.service.close();
});

test("service shutdown actively cancels and drains an unreleased source", async () => {
  const s = setup(),
    started = Promise.withResolvers<void>();
  let aborted = false;
  s.read(
    (signal) =>
      new Promise((_resolve, reject) => {
        started.resolve();
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            reject(new Error("cancelled"));
          },
          { once: true },
        );
      }),
  );
  const response = s.service.get();
  await started.promise;
  await s.service.close();
  expect(aborted).toBe(true);
  expect((await response).entities).toEqual([]);
});

test("preambles and copied files keep exact ID attribution through the collector, runtime and service", async () => {
  const root = await fs.mkdtemp(join(tmpdir(), "usage-binding-")),
    s = setup();
  const directory = join(root, ".claude", "projects", "synthetic");
  await fs.mkdir(directory, { recursive: true });
  const records = [
    {
      type: "file-history-snapshot",
      snapshot: { content: "PRIVATE_SENTINEL" },
    },
    {
      type: "assistant",
      sessionId: "session-a",
      timestamp: new Date(at - 100).toISOString(),
      message: {
        id: "response-a",
        model: "synthetic-model",
        content: "PRIVATE_SENTINEL",
        usage: { input_tokens: 10, output_tokens: 3 },
      },
    },
  ];
  for (const file of ["original.jsonl", "copy.jsonl"])
    await fs.writeFile(
      join(directory, file),
      records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    );
  const usage = createRuntimeUsage({
    herdrCall: async () => ({ agents: [agent] }),
    collect: (options) =>
      collectHarnessUsage(options, createUsageProjection, {
        fs,
        home: root,
        env: {},
        join,
        hash: usageDigest,
      }),
  });
  s.read((signal) => usage([agent], at, () => true, signal));
  try {
    const result = await s.service.get();
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]).toMatchObject({
      pane_id: "p1",
      tab_id: "t1",
      workspace_id: "w1",
      total_tokens: 13,
    });
    const text = JSON.stringify(result);
    for (const privateValue of [
      root,
      "session-a",
      "response-a",
      "PRIVATE_SENTINEL",
    ])
      expect(text).not.toContain(privateValue);
  } finally {
    await s.service.close();
    await usage.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a source deadline retains prior numbers as stale and reports the failed refresh", async () => {
  const s = setup(["alpha"], 5);
  await s.service.get();
  s.advance(31_000);
  s.read(
    (signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("cancelled")), {
          once: true,
        }),
      ),
  );
  const result = await s.service.get();
  expect(result.entities[0]?.state).toBe("stale");
  expect(result.sources[0]?.state).toBe("unavailable");
  expect(result.total.records).toBe(0);
  await s.service.close();
});
