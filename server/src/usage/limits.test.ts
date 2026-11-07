import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage } from "./collector";
import { createUsageProjection } from "./projection";
import { usageDigest, usageHostProgram, validateHostUsage } from "./host";
import { usageLimitExpired } from "../../../shared/usage";

/** Synthetic Codex subscription-limit records; no real account data. */
const now = Date.now() + 1000;
const resets = Math.floor((now + 3_600_000) / 1000);
const limitsRecord = (
  at: number,
  rateLimits: unknown,
  info: unknown = null,
) => ({
  timestamp: new Date(at).toISOString(),
  type: "event_msg",
  payload: { type: "token_count", info, rate_limits: rateLimits },
});
const codexLimits = (primary: number, secondary: number | null = null) => ({
  limit_id: "codex",
  limit_name: null,
  primary: {
    used_percent: primary,
    window_minutes: 300,
    resets_at: resets,
  },
  secondary:
    secondary === null
      ? null
      : {
          used_percent: secondary,
          window_minutes: 10080,
          resets_at: resets + 86_400,
        },
  credits: { has_credits: true, unlimited: false, balance: "PRIVATE_CREDITS" },
  plan_type: "PRIVATE_PLAN",
  rate_limit_reached_type: null,
});

test("Codex token counts report the newest numeric limit windows only", () => {
  const reader = createUsageProjection("codex", now);
  reader.accept({ type: "session_meta", payload: { id: "synthetic-codex" } });
  reader.accept(limitsRecord(now - 5000, codexLimits(10, 20)));
  reader.accept(limitsRecord(now - 1000, codexLimits(40, 92)));
  // An older line read later never replaces a newer observation.
  reader.accept(limitsRecord(now - 3000, codexLimits(5, 5)));
  const { limits } = reader.finish();
  expect(limits).toEqual({
    at: now - 1000,
    windows: [
      { window_minutes: 300, used_percent: 40, resets_at: resets * 1000 },
      {
        window_minutes: 10080,
        used_percent: 92,
        resets_at: (resets + 86_400) * 1000,
      },
    ],
  });
  const serialized = JSON.stringify(limits);
  for (const secret of ["PRIVATE_PLAN", "PRIVATE_CREDITS", "synthetic-codex"])
    expect(serialized).not.toContain(secret);
});

test("a null secondary window, missing limits and malformed values are not observations", () => {
  const reader = createUsageProjection("codex", now);
  reader.accept(limitsRecord(now - 4000, codexLimits(60)));
  expect(reader.finish().limits?.windows).toEqual([
    { window_minutes: 300, used_percent: 60, resets_at: resets * 1000 },
  ]);
  for (const malformed of [
    undefined,
    null,
    "PRIVATE_TEXT",
    { primary: null, secondary: null },
    { primary: { used_percent: "50", window_minutes: 300 } },
    { primary: { used_percent: -1, window_minutes: 300 } },
    { primary: { used_percent: Number.NaN, window_minutes: 300 } },
    { primary: { used_percent: 10, window_minutes: 0 } },
    { primary: { used_percent: 10, window_minutes: 1.5 } },
    { primary: { used_percent: 10, window_minutes: 300, resets_at: "soon" } },
    {
      primary: { used_percent: 10, window_minutes: 300 },
      secondary: { used_percent: 10 },
    },
    // Another limit (for example a model-specific one) is not the account window.
    { ...codexLimits(1), limit_id: "other-limit" },
  ])
    reader.accept(limitsRecord(now - 1000, malformed));
  // A record dated in the future cannot pin the gauge.
  reader.accept(limitsRecord(now + 3_600_000, codexLimits(1)));
  expect(reader.finish().limits).toMatchObject({
    at: now - 4000,
    windows: [{ used_percent: 60 }],
  });
  // Above 100 % is clamped; a missing reset is unknown, not zero.
  reader.accept(
    limitsRecord(now - 500, {
      primary: { used_percent: 104, window_minutes: 300 },
    }),
  );
  expect(reader.finish().limits).toEqual({
    at: now - 500,
    windows: [{ window_minutes: 300, used_percent: 100, resets_at: null }],
  });
  // Limits never change token accounting or its partial flag.
  expect(reader.finish()).toMatchObject({ rows: [], partial: false });
});

test("staleness follows the observation age and each window's reset", () => {
  const windows = [
    { window_minutes: 300, used_percent: 1, resets_at: now + 60_000 },
  ];
  expect(usageLimitExpired(now - 60_000, windows, now)).toBe(false);
  expect(usageLimitExpired(now - 4 * 3_600_000, windows, now)).toBe(true);
  expect(usageLimitExpired(now - 60_000, windows, now + 60_000)).toBe(true);
  expect(
    usageLimitExpired(now, [{ ...windows[0]!, resets_at: null }], now),
  ).toBe(false);
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function rollout(home: string, name: string, records: unknown[]) {
  const path = join(home, "codex", "sessions", "2026", name);
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(
    path,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

test("the host collector keeps the newest Codex observation across sessions, also over SSH", async () => {
  const home = await fs.mkdtemp(join(tmpdir(), "usage-limits-"));
  roots.push(home);
  await rollout(home, "rollout-a.jsonl", [
    { type: "session_meta", payload: { id: "session-older" } },
    limitsRecord(now - 60_000, codexLimits(30, 70)),
  ]);
  await rollout(home, "rollout-b.jsonl", [
    { type: "session_meta", payload: { id: "session-newer" } },
    limitsRecord(now - 2000, codexLimits(45, 88)),
  ]);
  const env = { CODEX_HOME: join(home, "codex") };
  const local = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env,
    join,
    hash: usageDigest,
  });
  expect(local.limits).toEqual([
    expect.objectContaining({
      harness: "codex",
      at: now - 2000,
      windows: [
        expect.objectContaining({ used_percent: 45 }),
        expect.objectContaining({ used_percent: 88 }),
      ],
    }),
  ]);
  // The same self-contained program runs on SSH hosts; its reply is validated.
  const proc = Bun.spawn([process.execPath, "run", "-"], {
    env: { ...process.env, HOME: home, ...env },
    stdin: Buffer.from(usageHostProgram({ now })),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exit, text] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
  ]);
  expect(exit).toBe(0);
  expect(validateHostUsage(JSON.parse(text)).limits).toEqual(local.limits!);
  for (const secret of [
    "PRIVATE_PLAN",
    "PRIVATE_CREDITS",
    "session-newer",
    home,
  ])
    expect(text).not.toContain(secret);
});

test("remote limit replies admit only bounded numbers", () => {
  const base = {
    rows: [],
    truncated: false,
    sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
      harness,
      state: "missing",
    })),
  };
  const window = { window_minutes: 300, used_percent: 10, resets_at: null };
  expect(
    validateHostUsage({
      ...base,
      limits: [{ harness: "codex", at: 1, windows: [window], plan: "x" }],
    }).limits,
  ).toEqual([{ harness: "codex", at: 1, windows: [window] }]);
  for (const limits of [
    "text",
    [{ harness: "claude", at: 1, windows: [window] }],
    [{ harness: "codex", at: 1, windows: [] }],
    [{ harness: "codex", at: 1, windows: [{ ...window, used_percent: 101 }] }],
    [{ harness: "codex", at: 1, windows: [{ ...window, resets_at: "x" }] }],
    [
      { harness: "codex", at: 1, windows: [window] },
      { harness: "codex", at: 2, windows: [window] },
    ],
  ])
    expect(() => validateHostUsage({ ...base, limits })).toThrow();
});
