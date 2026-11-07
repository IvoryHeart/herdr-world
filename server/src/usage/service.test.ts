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
  let inventory: Record<string, unknown>[] | undefined;
  let read: (signal: AbortSignal) => Promise<RuntimeUsage> = async () =>
    structuredClone(data);
  const runtime = {
    herdr: { call: async () => ({ agents: inventory ?? agents }) },
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
  const options: ConstructorParameters<typeof WorldUsageService>[0] & {
    ids: { issue(): Promise<string> };
  } = {
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
  };
  const service = new WorldUsageService(options);
  return {
    service,
    calls: () => calls,
    idsIssued: () => serial,
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
    inventory: (v: Record<string, unknown>[]) => {
      inventory = v;
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
  expect((await s.service.get()).entities[0]?.id).toBe(result.entities[0]?.id);
  expect(s.calls()).toBe(1);
  await s.service.close();
});

test("usage reads derive stable IDs without allocating durable records", async () => {
  const s = setup(),
    first = await s.service.get();
  expect(s.idsIssued()).toBe(0);
  expect(first.entities[0]?.id).toMatch(/^usage_[a-f0-9]{64}$/);
  s.advance(31_000);
  expect((await s.service.get()).entities[0]?.id).toBe(first.entities[0]?.id);
  expect(s.idsIssued()).toBe(0);
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

test("subscription limits are per host, age to stale, survive a failed read as stale and never read zero", async () => {
  const s = setup(["alpha", "beta"]);
  const windows = [
    { window_minutes: 300, used_percent: 40, resets_at: at + 3_600_000 },
    { window_minutes: 10080, used_percent: 92, resets_at: at + 86_400_000 },
  ];
  s.data({
    ...value(),
    limits: [
      {
        harness: "codex",
        at: at - 60_000,
        source: "codex-session-log",
        windows,
      },
    ],
  });
  const first = await s.service.get();
  expect(first.limits).toHaveLength(4);
  expect(
    first.limits.filter((l) => l.harness === "codex").map((l) => l.state),
  ).toEqual(["available", "available"]);
  expect(first.limits[0]).toEqual({
    connection_id: "alpha",
    connection_generation: 1,
    harness: "codex",
    state: "available",
    source: "codex-session-log",
    reason: null,
    observed_at: at - 60_000,
    windows,
    reached: null,
  });
  // Claude has no observation on this host yet: missing, not zero or full.
  expect(first.limits[1]).toMatchObject({
    harness: "claude",
    state: "missing",
    source: null,
    windows: [],
    reached: null,
  });
  // A failed read keeps the last numbers, labelled stale.
  s.advance(31_000);
  s.read(async () => {
    throw new Error("PRIVATE_PROVIDER_ERROR");
  });
  const failed = await s.service.get();
  expect(failed.limits[0]).toMatchObject({
    state: "stale",
    windows,
  });
  expect(JSON.stringify(failed)).not.toContain("PRIVATE_PROVIDER_ERROR");
  // A successful read without observations is missing, not zero or full.
  s.read(async () => structuredClone({ ...value(), limits: [] }));
  s.advance(31_000);
  const missing = await s.service.get();
  expect(missing.limits[0]).toMatchObject({
    state: "missing",
    observed_at: null,
    windows: [],
  });
  // Past its window's reset the observation is stale.
  s.read(async () =>
    structuredClone({
      ...value(),
      limits: [
        {
          harness: "codex",
          at: at - 60_000,
          source: "codex-session-log",
          windows,
        },
      ],
    }),
  );
  s.advance(3_600_000);
  expect((await s.service.get()).limits[0]?.state).toBe("stale");
  await s.service.close();
});

test("a partial read keeps the newer cached limits stale instead of older numbers", async () => {
  const s = setup();
  const limit = (offset: number, used: number) => ({
    harness: "codex",
    source: "codex-session-log" as const,
    at: at + offset,
    windows: [
      { window_minutes: 300, used_percent: used, resets_at: at + 3_600_000 },
    ],
  });
  const withCodex = (
    state: "available" | "partial",
    limits: ReturnType<typeof limit>[],
  ) =>
    structuredClone({
      ...value(),
      sources: value().sources.map((source) =>
        source.harness === "codex" ? { ...source, state } : source,
      ),
      limits,
    });
  s.read(async () => withCodex("available", [limit(-60_000, 95)]));
  const first = await s.service.get();
  expect(first.limits[0]).toMatchObject({ state: "available" });
  expect(first.limits[0]!.windows[0]!.used_percent).toBe(95);
  // The newest rollout fails; another rollout still holds an older 5 % read.
  s.advance(31_000);
  s.read(async () => withCodex("partial", [limit(-600_000, 5)]));
  const partial = await s.service.get();
  expect(partial.limits[0]).toMatchObject({
    state: "stale",
    observed_at: at - 60_000,
  });
  expect(partial.limits[0]!.windows[0]!.used_percent).toBe(95);
  // A partial read that does establish a newer observation replaces it.
  s.advance(31_000);
  s.read(async () => withCodex("partial", [limit(30_000, 50)]));
  const newer = await s.service.get();
  expect(newer.limits[0]).toMatchObject({
    state: "available",
    observed_at: at + 30_000,
  });
  await s.service.close();
});

test("Claude limits come from the status line tap or a refusal, and a refusal ages out at its reset", async () => {
  const s = setup();
  const windows = [
    { window_minutes: 300, used_percent: 87, resets_at: at + 3_600_000 },
  ];
  s.read(async () =>
    structuredClone({
      ...value(),
      limits: [
        {
          harness: "claude",
          at: at - 60_000,
          source: "claude-status-line",
          windows,
        },
      ],
    }),
  );
  expect((await s.service.get()).limits[1]).toEqual({
    connection_id: "alpha",
    connection_generation: 1,
    harness: "claude",
    state: "available",
    source: "claude-status-line",
    reason: null,
    observed_at: at - 60_000,
    windows,
    reached: null,
  });
  const reached = { window_minutes: 300, resets_at: at + 600_000 };
  s.advance(31_000);
  s.read(async () =>
    structuredClone({
      ...value(),
      limits: [
        {
          harness: "claude",
          at: at,
          source: "claude-transcript",
          windows: [],
          reached,
        },
      ],
    }),
  );
  expect((await s.service.get()).limits[1]).toMatchObject({
    state: "available",
    source: "claude-transcript",
    windows: [],
    reached,
  });
  // Once its reset passes, the refusal no longer says anything current.
  s.advance(600_000);
  expect((await s.service.get()).limits[1]).toMatchObject({
    state: "stale",
    reached,
  });
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

test("service cancellation drains shutdown and replaces a generation without releasing its blocked source", async () => {
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
  const nextStarted = Promise.withResolvers<void>();
  let aborted = false;
  s.advance(31_000);
  s.read(
    (signal) =>
      new Promise((_resolve, reject) => {
        nextStarted.resolve();
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
  await nextStarted.promise;
  await s.service.close();
  expect(aborted).toBe(true);
  expect((await response).entities).toEqual([]);
  await expect(s.service.get()).rejects.toThrow("closed");
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

test.each(["current", "ambiguous", "old-conflict", "old-unrelated"])(
  "Codex prefix attribution uses all session identities independently of numeric retention: %s",
  async (scenario) => {
    const root = await fs.mkdtemp(join(tmpdir(), "usage-prefix-")),
      s = setup();
    const currentId = "11111111-1111-4111-8111-111111111111",
      otherId = currentId.slice(0, -1) + "2";
    const currentAgent = {
      ...agent,
      agent: "codex",
      terminal_title: `${currentId.slice(0, 29)}...`,
      agent_session: { kind: "id", value: currentId },
    };
    s.agents([currentAgent]);
    const write = async (id: string, when: number, archived: boolean) => {
      const directory = join(
        root,
        ".codex",
        archived ? "archived_sessions" : "sessions",
        "synthetic",
      );
      await fs.mkdir(directory, { recursive: true });
      const path = join(directory, `${id}.jsonl`);
      const records = [
        { type: "session_meta", payload: { id } },
        { type: "turn_context", payload: { model: "synthetic-model" } },
        {
          type: "event_msg",
          timestamp: new Date(when).toISOString(),
          payload: {
            type: "token_count",
            info: {
              total_token_usage: { input_tokens: 10, output_tokens: 0 },
              last_token_usage: { input_tokens: 10, output_tokens: 0 },
            },
          },
          content: "PRIVATE_SENTINEL",
        },
      ];
      await fs.writeFile(
        path,
        records.map((record) => JSON.stringify(record)).join("\n") + "\n",
      );
      await fs.utimes(path, new Date(when), new Date(when));
    };
    await write(
      currentId,
      scenario === "old-conflict" ? at - 8 * 86_400_000 : at - 100,
      scenario === "old-conflict",
    );
    if (scenario === "ambiguous" || scenario === "old-conflict")
      await write(otherId, at - 100, false);
    if (scenario === "old-unrelated")
      await write(
        "22222222-2222-4222-8222-222222222222",
        at - 8 * 86_400_000,
        true,
      );
    const usage = createRuntimeUsage({
      collect: (options) =>
        collectHarnessUsage(options, createUsageProjection, {
          fs,
          home: root,
          env: {},
          join,
          hash: usageDigest,
        }),
    });
    s.read((signal) => usage([currentAgent], at, () => true, signal));
    try {
      const result = await s.service.get(),
        ambiguous = scenario === "ambiguous" || scenario === "old-conflict";
      const total = scenario === "ambiguous" ? 20 : 10;
      expect(result.total.total_tokens).toBe(total);
      expect(result.unattributed.total_tokens).toBe(ambiguous ? total : 0);
      expect(
        result.entities.every(
          (entity) => entity.pane_id === (ambiguous ? null : "p1"),
        ),
      ).toBe(true);
      expect(
        result.sources.find((source) => source.harness === "codex")?.state,
      ).toBe("available");
      expect(result.truncated).toBe(false);
      expect(
        result.entities.every((entity) => entity.day === "2026-11-01"),
      ).toBe(true);
      const serialized = JSON.stringify(result);
      for (const privateValue of [root, currentId, otherId, "PRIVATE_SENTINEL"])
        expect(serialized).not.toContain(privateValue);
    } finally {
      await s.service.close();
      await usage.close();
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test("one native revalidation preserves changed, new and previously unlinked claims", async () => {
  const unlinked = {
    ...agent,
    pane_id: "p2",
    terminal_id: "term2",
    agent_session: null,
  };
  for (const before of [[agent], [agent, unlinked]]) {
    const s = setup();
    s.agents(before as (typeof agent)[]);
    s.inventory([agent, { ...unlinked, agent_session: agent.agent_session }]);
    expect((await s.service.get()).entities[0]?.pane_id).toBeNull();
    await s.service.close();
  }
  const s = setup();
  s.inventory([{ ...agent, terminal_id: "replacement" }]);
  expect((await s.service.get()).entities[0]?.pane_id).toBeNull();
  await s.service.close();
});

test("an unreadable status line reading keeps the last Claude numbers stale through the collector", async () => {
  const s = setup();
  const home = await fs.mkdtemp(join(tmpdir(), "usage-claude-tap-read-"));
  const dir = join(home, ".cache", "herdr-world");
  await fs.mkdir(dir, { recursive: true });
  const windows = [
    { window_minutes: 300, used_percent: 87, resets_at: at + 3_600_000 },
  ];
  await fs.writeFile(
    join(dir, "claude-status-line.json"),
    JSON.stringify({ version: 1, at: at - 60_000, windows }),
  );
  let denied = false;
  const denying = {
    ...fs,
    readFile: (async (path: string, encoding: BufferEncoding) => {
      if (denied && path.endsWith("claude-status-line.json"))
        throw Object.assign(new Error("denied"), { code: "EACCES" });
      return fs.readFile(path, encoding);
    }) as typeof fs.readFile,
  };
  s.read(async () => ({
    ...(await collectHarnessUsage({ now: at }, createUsageProjection, {
      fs: denying,
      home,
      env: { CLAUDE_CONFIG_DIR: join(home, "claude") },
      join,
      hash: usageDigest,
    })),
    bindings: [],
    unsupported: [],
  }));
  try {
    expect((await s.service.get()).limits[1]).toMatchObject({
      harness: "claude",
      state: "available",
      windows,
    });
    denied = true;
    s.advance(31_000);
    expect((await s.service.get()).limits[1]).toMatchObject({
      harness: "claude",
      state: "stale",
      observed_at: at - 60_000,
      windows,
    });
  } finally {
    await s.service.close();
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("a pane's context bar needs a fresh, unique current-session match", async () => {
  const context = (at: number, used: number, model = "claude-opus-4-6") => ({
    harness: "claude",
    session_key: row().session_key,
    file_keys: [],
    at,
    model,
    used_tokens: used,
    window_tokens: null,
  });
  const s = setup(),
    data = value();
  // An older file of the same session never replaces the newest prompt.
  data.contexts = [context(at - 100, 144_000), context(at - 500, 9)];
  s.data(data);
  expect((await s.service.get()).contexts).toEqual([
    {
      connection_id: "alpha",
      connection_generation: 1,
      workspace_id: "w1",
      tab_id: "t1",
      pane_id: "p1",
      harness: "claude",
      model: "claude-opus-4-6",
      used_tokens: 144_000,
      window_tokens: 200_000,
      observed_at: at - 100,
    },
  ]);
  // An unknown model keeps its numbers but has no window, so no bar.
  s.data({ ...data, contexts: [context(at - 100, 10, "unknown")] });
  s.advance(31_000);
  expect((await s.service.get()).contexts?.[0]?.window_tokens).toBeNull();
  // Duplicate claims and failed hosts attribute nothing.
  s.data({
    ...data,
    bindings: [
      ...data.bindings,
      { ...data.bindings[0]!, pane_id: "p2", tab_id: "t2" },
    ],
  });
  s.advance(31_000);
  expect((await s.service.get()).contexts).toEqual([]);
  s.offline();
  expect((await s.service.get()).contexts).toEqual([]);
  await s.service.close();
});
