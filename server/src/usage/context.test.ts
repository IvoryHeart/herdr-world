import { afterEach, expect, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectHarnessUsage } from "./collector";
import { createUsageProjection } from "./projection";
import { contextWindowTokens } from "./context-window";
import { usageDigest, usageHostProgram, validateHostUsage } from "./host";

/** Synthetic transcripts only: no real sessions, paths or content. */
const now = Date.now() + 1000;
const iso = (at: number) => new Date(at).toISOString();
const claude = (
  at: number,
  id: string,
  usage: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({
  type: "assistant",
  sessionId: "synthetic-claude",
  timestamp: iso(at),
  ...extra,
  message: {
    id,
    model: "claude-opus-4-6",
    content: "PRIVATE_SENTINEL",
    usage,
    ...(extra.message as object),
  },
});
const codexTurn = (at: number, lastInput: number, window?: number) => ({
  timestamp: iso(at),
  type: "event_msg",
  payload: {
    type: "token_count",
    info: {
      total_token_usage: { input_tokens: lastInput, output_tokens: 1 },
      last_token_usage: { input_tokens: lastInput, output_tokens: 1 },
      ...(window === undefined ? {} : { model_context_window: window }),
    },
  },
});

test("Claude's context is the newest main-thread prompt, cache included", () => {
  const reader = createUsageProjection("claude", now);
  reader.accept(
    claude(now - 5000, "a", {
      input_tokens: 10,
      cache_read_input_tokens: 1000,
      cache_creation_input_tokens: 90,
      output_tokens: 5,
    }),
  );
  reader.accept(
    claude(now - 3000, "b", {
      input_tokens: 4,
      cache_read_input_tokens: 140_000,
      cache_creation_input_tokens: 3996,
      output_tokens: 7,
    }),
  );
  // A subagent's prompt, an API error and Claude Code's synthetic messages
  // are not the session's context; an older line read later never wins.
  reader.accept(
    claude(
      now - 1000,
      "c",
      { input_tokens: 1, output_tokens: 1 },
      {
        isSidechain: true,
      },
    ),
  );
  reader.accept(
    claude(
      now - 900,
      "d",
      { input_tokens: 2, output_tokens: 0 },
      {
        isApiErrorMessage: true,
      },
    ),
  );
  reader.accept(
    claude(
      now - 800,
      "e",
      { input_tokens: 3, output_tokens: 0 },
      {
        message: { model: "<synthetic>" },
      },
    ),
  );
  reader.accept(claude(now - 4000, "f", { input_tokens: 9, output_tokens: 1 }));
  const result = reader.finish();
  expect(result.context).toEqual({
    at: now - 3000,
    model: "claude-opus-4-6",
    used_tokens: 144_000,
    window_tokens: null,
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
});

test("Codex's context is the last turn's input with the window Codex reported", () => {
  const reader = createUsageProjection("codex", now);
  reader.accept({ type: "session_meta", payload: { id: "synthetic-codex" } });
  reader.accept({ type: "turn_context", payload: { model: "gpt-synthetic" } });
  reader.accept(codexTurn(now - 2000, 50_000, 258_400));
  reader.accept(codexTurn(now - 1000, 120_000, 258_400));
  expect(reader.finish().context).toEqual({
    at: now - 1000,
    model: "gpt-synthetic",
    used_tokens: 120_000,
    window_tokens: 258_400,
  });
  const invalid = createUsageProjection("codex", now);
  invalid.accept(codexTurn(now - 1000, 120_000, -1));
  expect(invalid.finish().context?.window_tokens).toBeNull();
  const none = createUsageProjection("codex", now);
  none.accept(codexTurn(now + 3_600_000, 10, 1000));
  expect(none.finish().context).toBeNull();
});

test("Pi and Gemini report their newest prompt size", () => {
  const pi = createUsageProjection("pi", now);
  pi.accept({
    type: "message",
    id: "entry-a",
    timestamp: iso(now - 1000),
    message: {
      role: "assistant",
      model: "claude-sonnet-4-5",
      usage: { input: 10, cacheRead: 500, cacheWrite: 20, output: 3 },
    },
  });
  expect(pi.finish().context?.used_tokens).toBe(530);
  const gemini = createUsageProjection("gemini", now);
  gemini.accept({
    type: "gemini",
    id: "message-a",
    timestamp: iso(now - 1000),
    model: "gemini-2.5-pro",
    tokens: { input: 900, cached: 800, output: 5, tool: 100 },
  });
  expect(gemini.finish().context?.used_tokens).toBe(1000);
});

test("model windows: a reported window wins, unknown models have none", () => {
  expect(contextWindowTokens("gpt-synthetic", 10, 258_400)).toBe(258_400);
  expect(contextWindowTokens("gpt-synthetic", 10)).toBeNull();
  expect(contextWindowTokens("unknown", 10)).toBeNull();
  for (const model of [
    "claude-opus-4-6",
    "claude-opus-4-20250514",
    "claude-sonnet-4-5-20250929",
    "claude-haiku-4-5-20251001",
    "claude-3-7-sonnet-20250219",
  ])
    expect(contextWindowTokens(model, 150_000)).toBe(200_000);
  // Past 200k the session must be on the opt-in one-million window.
  expect(contextWindowTokens("claude-sonnet-4-5-20250929", 250_000)).toBe(
    1_000_000,
  );
  for (const model of [
    "claude-opus-4-7",
    "claude-opus-5-5",
    "claude-sonnet-5",
    "claude-fable-5-1",
  ])
    expect(contextWindowTokens(model, 10)).toBe(1_000_000);
  expect(contextWindowTokens("claude-haiku-5-5", 10)).toBeNull();
  expect(contextWindowTokens("gemini-2.5-pro", 10)).toBe(1_048_576);
});

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});

test("the host collector returns each session's context, also over SSH, as numbers only", async () => {
  const home = await fs.mkdtemp(join(tmpdir(), "usage-context-"));
  roots.push(home);
  const path = join(home, "codex", "sessions", "2026", "rollout-a.jsonl");
  await fs.mkdir(join(path, ".."), { recursive: true });
  await fs.writeFile(
    path,
    [
      { type: "session_meta", payload: { id: "session-private" } },
      { type: "turn_context", payload: { model: "gpt-synthetic" } },
      codexTurn(now - 2000, 70_000, 258_400),
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
  );
  const env = { CODEX_HOME: join(home, "codex") };
  const local = await collectHarnessUsage({ now }, createUsageProjection, {
    fs,
    home,
    env,
    join,
    hash: usageDigest,
  });
  expect(local.contexts).toEqual([
    {
      harness: "codex",
      session_key: usageDigest("codex\0session-private"),
      file_keys: [usageDigest(path)],
      at: now - 2000,
      model: "gpt-synthetic",
      used_tokens: 70_000,
      window_tokens: 258_400,
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
  expect(validateHostUsage(JSON.parse(text)).contexts).toEqual(local.contexts!);
  for (const secret of ["session-private", home]) {
    expect(text).not.toContain(secret);
  }
});

test("remote context replies admit only bounded numbers and digests", () => {
  const base = {
    rows: [],
    truncated: false,
    sources: ["claude", "codex", "pi", "gemini"].map((harness) => ({
      harness,
      state: "missing",
    })),
  };
  const context = {
    harness: "claude",
    session_key: usageDigest("claude\0synthetic"),
    file_keys: [],
    at: 1,
    model: "claude-opus-4-6",
    used_tokens: 10,
    window_tokens: null,
  };
  expect(
    validateHostUsage({
      ...base,
      contexts: [{ ...context, prompt: "PRIVATE_SENTINEL" }],
    }).contexts,
  ).toEqual([context]);
  for (const contexts of [
    "text",
    [{ ...context, harness: "other" }],
    [{ ...context, session_key: "session-private" }],
    [{ ...context, model: "has spaces" }],
    [{ ...context, used_tokens: -1 }],
    [{ ...context, window_tokens: 0 }],
    [{ ...context, file_keys: ["/private/path"] }],
    Array.from({ length: 257 }, () => context),
  ])
    expect(() => validateHostUsage({ ...base, contexts })).toThrow();
});
