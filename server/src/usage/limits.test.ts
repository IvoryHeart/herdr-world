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
    source: "codex-session-log",
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
    source: "codex-session-log",
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
  const codex = { harness: "codex", source: "codex-session-log" as const };
  const tap = { harness: "claude", source: "claude-status-line" as const };
  const refusal = {
    harness: "claude",
    source: "claude-transcript" as const,
    at: 1,
    windows: [] as (typeof window)[],
    reached: { window_minutes: 300, resets_at: 2 },
  };
  expect(
    validateHostUsage({
      ...base,
      limits: [
        { ...codex, at: 1, windows: [window], plan: "x" },
        { ...tap, at: 1, windows: [window], account: "x" },
      ],
    }).limits,
  ).toEqual([
    { ...codex, at: 1, windows: [window] },
    { ...tap, at: 1, windows: [window] },
  ]);
  expect(
    validateHostUsage({
      ...base,
      limits: [{ ...refusal, reached: { ...refusal.reached, why: "x" } }],
    }).limits,
  ).toEqual([refusal]);
  for (const limits of [
    "text",
    [{ harness: "claude", at: 1, windows: [window] }],
    [{ ...codex, source: "claude-status-line", at: 1, windows: [window] }],
    [{ ...tap, harness: "gemini", at: 1, windows: [window] }],
    [{ ...codex, at: 1, windows: [] }],
    [{ ...codex, at: 1, windows: [{ ...window, used_percent: 101 }] }],
    [{ ...codex, at: 1, windows: [{ ...window, resets_at: "x" }] }],
    [
      { ...codex, at: 1, windows: [window] },
      { ...codex, at: 2, windows: [window] },
    ],
    // A refusal carries no level, comes only from a transcript and names a time.
    [{ ...refusal, windows: [window] }],
    [{ ...refusal, source: "claude-status-line" }],
    [{ ...refusal, reached: { window_minutes: 300, resets_at: "soon" } }],
    [{ ...refusal, reached: { window_minutes: 7, resets_at: 2 } }],
    [{ ...refusal, reached: null }],
  ])
    expect(() => validateHostUsage({ ...base, limits })).toThrow();
});

/** Synthetic Claude Code transcript records; no real account data. */
const claudeAnswer = (at: number, id: string) => ({
  type: "assistant",
  sessionId: "synthetic-claude",
  timestamp: new Date(at).toISOString(),
  message: {
    id,
    model: "claude-test",
    usage: { input_tokens: 1, output_tokens: 1 },
  },
});
const claudeRefusal = (
  at: number,
  resetsAt: number,
  rateLimitType: unknown = "five_hour",
) => ({
  type: "assistant",
  sessionId: "synthetic-claude",
  timestamp: new Date(at).toISOString(),
  isApiErrorMessage: true,
  error: "rate_limit",
  apiError: "usage_limit_reached",
  apiErrorParams: {
    rate_limit_info: {
      status: "rejected",
      resetsAt,
      rateLimitType,
      overageDisabledReason: "PRIVATE_REASON",
    },
  },
  quotaLimits: { upgradePaths: ["PRIVATE_UPGRADE"] },
  message: {
    id: `refusal-${at}`,
    model: "<synthetic>",
    usage: { input_tokens: 0, output_tokens: 0 },
    content: [{ type: "text", text: "PRIVATE_TEXT" }],
  },
});

test("a Claude refusal is the newest limit record until a later answer", () => {
  const reader = createUsageProjection("claude", now);
  reader.accept(claudeAnswer(now - 9000, "msg-1"));
  reader.accept(claudeRefusal(now - 5000, resets));
  const { limits } = reader.finish();
  expect(limits).toEqual({
    at: now - 5000,
    source: "claude-transcript",
    windows: [],
    reached: { window_minutes: 300, resets_at: resets * 1000 },
  });
  for (const secret of [
    "PRIVATE_REASON",
    "PRIVATE_UPGRADE",
    "PRIVATE_TEXT",
    "synthetic-claude",
  ])
    expect(JSON.stringify(limits)).not.toContain(secret);
  // A weekly refusal names its week; an unknown type names no window.
  reader.accept(claudeRefusal(now - 4000, resets, "seven_day_opus"));
  expect(reader.finish().limits?.reached?.window_minutes).toBe(10080);
  reader.accept(claudeRefusal(now - 3000, resets, "PRIVATE_TYPE"));
  expect(reader.finish().limits?.reached).toEqual({
    window_minutes: null,
    resets_at: resets * 1000,
  });
  // Malformed or future-dated refusals are not observations.
  for (const bad of [
    claudeRefusal(now - 2000, "soon" as never),
    claudeRefusal(now - 2000, -1),
    claudeRefusal(now + 3_600_000, resets),
  ])
    reader.accept(bad);
  expect(reader.finish().limits?.at).toBe(now - 3000);
  // A later answer means the refusal no longer holds.
  reader.accept(claudeAnswer(now - 1000, "msg-2"));
  expect(reader.finish().limits).toBeNull();
});

test("a refusal is stale once its reset passes", () => {
  const reached = { window_minutes: 300, resets_at: now + 60_000 };
  expect(usageLimitExpired(now - 1000, [], now, reached)).toBe(false);
  expect(usageLimitExpired(now - 1000, [], now + 60_000, reached)).toBe(true);
});

async function claudeTranscript(home: string, records: unknown[]) {
  const path = join(home, "claude", "projects", "synthetic", "a.jsonl");
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(
    path,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}
async function tapReading(home: string, value: unknown) {
  const dir = join(home, ".cache", "herdr-world");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    join(dir, "claude-status-line.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );
}

test("the host collector takes the newest of the status line tap and a refusal, also over SSH", async () => {
  const home = await fs.mkdtemp(join(tmpdir(), "usage-claude-limits-"));
  roots.push(home);
  const env = { CLAUDE_CONFIG_DIR: join(home, "claude") };
  const collect = () =>
    collectHarnessUsage({ now }, createUsageProjection, {
      fs,
      home,
      env,
      join,
      hash: usageDigest,
    });
  const windows = [
    { window_minutes: 300, used_percent: 42.5, resets_at: resets * 1000 },
    {
      window_minutes: 10080,
      used_percent: 91,
      resets_at: (resets + 86_400) * 1000,
    },
  ];
  await tapReading(home, { version: 1, at: now - 2000, windows });
  await claudeTranscript(home, [claudeRefusal(now - 60_000, resets)]);
  expect((await collect()).limits).toEqual([
    {
      harness: "claude",
      at: now - 2000,
      source: "claude-status-line",
      windows,
    },
  ]);
  // A refusal newer than the last reading wins.
  await claudeTranscript(home, [claudeRefusal(now - 1000, resets)]);
  const local = await collect();
  expect(local.limits).toEqual([
    {
      harness: "claude",
      at: now - 1000,
      source: "claude-transcript",
      windows: [],
      reached: { window_minutes: 300, resets_at: resets * 1000 },
    },
  ]);
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
  // Malformed tap readings are ignored; without a refusal nothing is observed.
  await fs.rm(join(home, "claude"), { recursive: true });
  for (const bad of [
    "PRIVATE_TEXT",
    { version: 2, at: now - 2000, windows },
    { version: 1, at: now + 3_600_000, windows },
    { version: 1, at: now - 2000, windows: [] },
    { version: 1, at: now - 2000, windows: [windows[0], windows[0]] },
    {
      version: 1,
      at: now - 2000,
      windows: [{ ...windows[0], used_percent: 101 }],
    },
    {
      version: 1,
      at: now - 2000,
      windows: [{ ...windows[0], window_minutes: 60 }],
    },
  ]) {
    await tapReading(home, bad);
    const read = await collect();
    expect(read.limits).toEqual([]);
    // An invalid reading is a failed read, so the service keeps the last one stale.
    expect(read.sources).toContainEqual({
      harness: "claude",
      state: "partial",
    });
  }
  // A symlinked reading is not followed.
  const target = join(home, "elsewhere.json");
  await fs.writeFile(target, JSON.stringify({ version: 1, at: now, windows }));
  await fs.rm(join(home, ".cache", "herdr-world", "claude-status-line.json"));
  await fs.symlink(
    target,
    join(home, ".cache", "herdr-world", "claude-status-line.json"),
  );
  const linked = await collect();
  expect(linked.limits).toEqual([]);
  expect(linked.sources).toContainEqual({
    harness: "claude",
    state: "partial",
  });
  // No reading at all is not a failure.
  await fs.rm(join(home, ".cache", "herdr-world", "claude-status-line.json"));
  expect((await collect()).sources).not.toContainEqual({
    harness: "claude",
    state: "partial",
  });
});
