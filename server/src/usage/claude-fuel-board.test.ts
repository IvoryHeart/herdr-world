import { herdrRuntimeFixture } from "../adapters/testing/runtime";
import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { WorldUsageSnapshot } from "../../../shared/usage";
import { claudeStatusLineTap } from "./claude-tap";
import { collectHarnessUsage } from "./collector";
import { createUsageProjection } from "./projection";
import { validateHostUsage } from "./validation";
import { WorldUsageService } from "./service";
import { systemScheduler } from "../service/ports";
import { emptyOfficeObservability } from "../world/observability";
import type { WorldSnapshotResult } from "../world/snapshot";
import {
  LIMITS_REFRESH_MS,
  townFuelGauges,
  townLimits,
} from "../../../web/src/world/town/townLimits";
import { TownUsageStore } from "../../../web/src/world/town/townPlaceUsage";

const homes: string[] = [];
afterEach(async () => {
  for (const home of homes.splice(0))
    await fsp.rm(home, { recursive: true, force: true });
});

/**
 * The whole path the owner tries: a Claude agent's status line runs the tap,
 * the tap writes its file, the host collector reads it, the service answers
 * `world.usage.get`, and the board's store and FUEL row show a Claude gauge.
 */
test("a real tap file becomes a Claude gauge on the board at its next refresh", async () => {
  const home = await fsp.mkdtemp(path.join(tmpdir(), "herdr-world-fuel-"));
  homes.push(home);
  let now = Date.parse("2026-11-07T13:40:00Z");
  const runtime = {
    ...herdrRuntimeFixture({ call: async () => ({ agents: [] }) }),
    usage: async (_agents: unknown, at: number) => ({
      ...validateHostUsage(
        await collectHarnessUsage(
          { now: at, files: [] },
          createUsageProjection,
          {
            fs: fsp,
            home,
            env: {},
            join: path.join,
            resolve: path.resolve,
            hash: (v) => createHash("sha256").update(v).digest("hex"),
          },
        ),
      ),
      bindings: [],
      unsupported: [],
    }),
  };
  const service = new WorldUsageService({
    incarnation: "synthetic-incarnation",
    now: () => now,
    scheduler: systemScheduler,
    waitMs: 10_000,
    connections: {
      list: () => [
        {
          id: "local",
          generation: 1,
          label: "local",
          source: "test",
          is_default: true,
          state: "ready",
        },
      ],
      readyRuntimeLease: () => ({
        generation: 1,
        runtime,
        isCurrent: () => true,
      }),
    },
    topology: async () =>
      ({
        connections: [
          {
            connection_id: "local",
            generation: 1,
            snapshot_generation: 1,
            stale: false,
            actionable: true,
            snapshot: { agents: [] },
          },
        ],
      }) as unknown as WorldSnapshotResult,
    prices: async () => undefined,
    telemetry: async () => emptyOfficeObservability(),
  } as unknown as ConstructorParameters<typeof WorldUsageService>[0]);
  const store = new TownUsageStore(
    { call: (_method, params) => service.get(params) },
    () => now,
  );
  const settled = async () => {
    for (let i = 0; i < 50 && store.get().status !== "ready"; i++)
      await Bun.sleep(10);
    const state = store.get();
    return state.status === "ready" ? state.snapshot : null;
  };
  // What the board's FUEL row draws: one gauge per harness with numbers.
  const board = () => townFuelGauges(townLimits(store.get()), now);

  // The board is open before the agent answers: no Claude reading yet.
  store.request();
  const before = (await settled()) as WorldUsageSnapshot;
  expect(before.limits.find((l) => l.harness === "claude")?.state).toBe(
    "missing",
  );
  expect(board().map((g) => g.name)).not.toContain("Claude");

  // The agent answers; Claude Code runs its status line, which is the tap.
  now += 5_000;
  const answeredAt = now;
  expect(
    claudeStatusLineTap(
      JSON.stringify({
        cwd: home,
        rate_limits: {
          five_hour: {
            used_percentage: 28,
            resets_at: Math.floor((now + 3_600_000) / 1000),
          },
          seven_day: {
            used_percentage: 90,
            resets_at: Math.floor((now + 86_400_000) / 1000),
          },
        },
      }),
      { fs, path, home, env: {}, cwd: home, uid: null, now, pid: 1 },
    ),
  ).toBeNull();

  // The board's next timed refresh shows it. With the service's own 30 s per
  // host, a reading reaches the sign within a minute of the answer.
  expect(LIMITS_REFRESH_MS + 30_000).toBeLessThanOrEqual(60_000);
  now += LIMITS_REFRESH_MS - 5_000;
  const shown = store.get();
  store.request();
  for (let i = 0; i < 50 && store.get() === shown; i++) await Bun.sleep(10);
  const claude = townLimits(store.get()).find((l) => l.harness === "claude");
  expect(claude).toMatchObject({
    state: "available",
    source: "claude-status-line",
    observed_at: answeredAt,
    reached: null,
  });
  expect(
    claude?.windows.map((w) => [w.window_minutes, w.used_percent]),
  ).toEqual([
    [300, 28],
    [10080, 90],
  ]);
  expect(board().find((g) => g.name === "Claude")).toMatchObject({
    connectionId: "local",
    stale: false,
    observedAt: answeredAt,
    source: "Claude status line",
    windows: [
      { label: "5 h", left: 72, low: false, reached: false },
      { label: "week", left: 10, low: true, reached: false },
    ],
  });
  await service.close();
});
