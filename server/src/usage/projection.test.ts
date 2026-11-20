import { expect, test } from "bun:test";
import { createUsageProjection } from "./projection";

const at = "2026-10-31T12:00:00Z";
const now = Date.parse("2026-11-01T12:00:00Z");

test("only an explicit numeric harness cost counts, repeated Pi responses count once", () => {
  const reader = createUsageProjection("pi", now);
  const message = {
    type: "message",
    id: "response",
    timestamp: at,
    message: {
      role: "assistant",
      model: "synthetic",
      usage: { input: 10, output: 2, cost: { total: 0.25 } },
    },
  };
  reader.accept(message);
  reader.accept(message);
  expect(reader.finish().rows[0]?.reported_cost_usd).toBe(0.25);
  const missing = createUsageProjection("pi", now);
  missing.accept({
    ...message,
    message: { ...message.message, usage: { input: 10, output: 2 } },
  });
  expect(missing.finish().rows[0]?.reported_cost_usd).toBeUndefined();
});

test("Claude repeated response blocks count once with disjoint cache tokens", () => {
  const reader = createUsageProjection("claude", now);
  for (const output of [2, 7, 7])
    reader.accept({
      type: "assistant",
      sessionId: "synthetic-session",
      timestamp: at,
      message: {
        id: "response-a",
        model: "synthetic-model",
        content: "PRIVATE_SENTINEL",
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5,
          output_tokens: output,
        },
      },
    });
  expect(reader.finish()).toMatchObject({
    partial: false,
    session: "synthetic-session",
    rows: [
      {
        model: "synthetic-model",
        tokens: {
          input: 10,
          cache_read: 20,
          cache_write: 5,
          output: 7,
          reasoning: 0,
        },
        responses: 1,
      },
    ],
  });
  expect(JSON.stringify(reader.finish())).not.toContain("PRIVATE_SENTINEL");
});

test("Codex repeats and model switches count cumulative deltas once", () => {
  const reader = createUsageProjection("codex", now);
  const count = (
    input: number,
    output: number,
    lastInput = 10,
    lastOutput = 2,
  ) =>
    reader.accept({
      timestamp: at,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: 3,
            output_tokens: output,
            reasoning_output_tokens: 1,
          },
          last_token_usage: {
            input_tokens: lastInput,
            output_tokens: lastOutput,
          },
        },
      },
    });
  reader.accept({ type: "session_meta", payload: { id: "synthetic-codex" } });
  reader.accept({ type: "turn_context", payload: { model: "model-a" } });
  count(10, 2);
  count(10, 2);
  reader.accept({ type: "turn_context", payload: { model: "model-b" } });
  count(15, 5, 5, 3);
  expect(reader.finish()).toMatchObject({
    rows: [
      { model: "model-a", tokens: { input: 7, cache_read: 3, output: 2 } },
      { model: "model-b", tokens: { input: 5, cache_read: 0, output: 3 } },
    ],
  });
});

test("Codex unknown initial baseline and counter decreases disclose partial coverage", () => {
  const reader = createUsageProjection("codex", now);
  reader.accept({ type: "turn_context", payload: { model: "model-a" } });
  const feed = (input: number, output: number) =>
    reader.accept({
      type: "event_msg",
      timestamp: at,
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: input, output_tokens: output },
          last_token_usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
    });
  feed(100, 10);
  feed(105, 12);
  feed(2, 2);
  feed(3, 3);
  expect(reader.finish()).toMatchObject({
    partial: true,
    rows: [{ tokens: { input: 5, output: 2 } }],
  });
});

test("invalid and missing token values never become negative, NaN or invented zero usage", () => {
  for (const value of [-1, 1.5, Infinity, "10", undefined]) {
    const reader = createUsageProjection("claude", now);
    reader.accept({
      type: "assistant",
      timestamp: at,
      message: {
        id: "bad",
        model: "m",
        usage: { input_tokens: value, output_tokens: 3 },
      },
    });
    expect(reader.finish()).toMatchObject({ partial: true, rows: [] });
  }
});

test("Codex recovery and copied replays never bill below the cumulative high-water mark again", () => {
  const reader = createUsageProjection("codex", now);
  reader.accept({ type: "turn_context", payload: { model: "model-a" } });
  for (const input of [10, 20, 5, 15, 25, 10, 20, 25])
    reader.accept({
      type: "event_msg",
      timestamp: at,
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: input, output_tokens: 0 },
          last_token_usage: { input_tokens: input, output_tokens: 0 },
        },
      },
    });
  expect(reader.finish()).toMatchObject({
    partial: true,
    rows: [{ tokens: { input: 25 } }],
  });
});

test("bounded Codex decrease/recovery schedules never exceed observed cumulative usage", () => {
  for (let code = 0; code < 625; code++) {
    const reader = createUsageProjection("codex", now);
    reader.accept({ type: "turn_context", payload: { model: "model-a" } });
    let schedule = code,
      highest = 0;
    for (let i = 0; i < 4; i++) {
      const input = schedule % 5;
      schedule = Math.floor(schedule / 5);
      highest = Math.max(highest, input);
      reader.accept({
        type: "event_msg",
        timestamp: at,
        payload: {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: input, output_tokens: 0 },
            last_token_usage: { input_tokens: input, output_tokens: 0 },
          },
        },
      });
    }
    expect(
      reader.finish().rows.reduce((sum, row) => sum + row.tokens.input, 0),
    ).toBe(highest);
  }
});

test("Pi repeated responses and Gemini JSON conversations use their cache conventions", () => {
  const pi = createUsageProjection("pi", now);
  pi.accept({ type: "session", id: "session-pi" });
  for (let i = 0; i < 2; i++)
    pi.accept({
      type: "message",
      id: "response-pi",
      timestamp: at,
      message: {
        role: "assistant",
        model: "m",
        content: "PRIVATE_SENTINEL",
        usage: { input: 10, output: 4, cacheRead: 8, cacheWrite: 2 },
      },
    });
  expect(pi.finish().rows[0]).toMatchObject({
    tokens: { input: 10, cache_read: 8, cache_write: 2, output: 4 },
    responses: 1,
  });
  const gemini = createUsageProjection("gemini", now);
  const message = {
    id: "response-gemini",
    type: "gemini",
    model: "g",
    timestamp: at,
    content: "PRIVATE_SENTINEL",
    tokens: { input: 20, cached: 6, output: 5, thoughts: 3 },
  };
  gemini.accept({ sessionId: "session-gemini", messages: [message, message] });
  expect(gemini.finish()).toMatchObject({
    session: "session-gemini",
    rows: [
      {
        tokens: { input: 14, cache_read: 6, output: 8, reasoning: 3 },
        responses: 1,
      },
    ],
  });
});

test("seven UTC days are retained with exclusive upper bound and no content serialization", () => {
  const reader = createUsageProjection("claude", now);
  for (const [id, timestamp] of [
    ["old", "2026-10-25T23:59:59Z"],
    ["first", "2026-10-26T00:00:00Z"],
    ["last", "2026-11-01T11:59:59Z"],
    ["future", "2026-11-01T12:00:00Z"],
  ])
    reader.accept({
      type: "assistant",
      timestamp,
      message: {
        id,
        model: "m",
        content: "PRIVATE_SENTINEL",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
  expect(reader.finish().rows.map((r) => r.day)).toEqual([
    "2026-10-26",
    "2026-11-01",
  ]);
  expect(JSON.stringify(reader.finish())).not.toContain("PRIVATE_SENTINEL");
});

test("a run keeps its hours, largest prompt, branch and first-prompt role, never the text", () => {
  const reader = createUsageProjection("claude", now);
  const user = (content: unknown, extra: object = {}) =>
    reader.accept({
      type: "user",
      sessionId: "synthetic-session",
      gitBranch: "crew/42",
      timestamp: at,
      message: { role: "user", content },
      ...extra,
    });
  user("<local-command-caveat>PRIVATE_PREAMBLE</local-command-caveat>");
  user("You are the reviewer here, PRIVATE_SENTINEL", { isMeta: true });
  user([{ type: "text", text: "You are the crew fixer for PRIVATE_SENTINEL" }]);
  user("Now act as the reviewer");
  const call = (id: string, time: string, input: number, cached: number) =>
    reader.accept({
      type: "assistant",
      sessionId: "synthetic-session",
      timestamp: time,
      message: {
        id,
        model: "synthetic-model",
        usage: {
          input_tokens: input,
          cache_read_input_tokens: cached,
          output_tokens: 1,
        },
      },
    });
  call("a", "2026-10-31T03:10:00Z", 10, 100);
  call("a", "2026-10-31T03:10:00Z", 10, 100);
  call("b", "2026-10-31T17:40:00Z", 5, 400);
  const result = reader.finish();
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toMatchObject({
    responses: 2,
    hours: (1 << 3) | (1 << 17),
    max_prompt_tokens: 405,
    role: "fixer",
    branch: "crew/42",
  });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_");
});

test("Codex reads its branch and role; unnamed roles and detached heads are unknown", () => {
  const read = (message: string, branch: string) => {
    const reader = createUsageProjection("codex", now);
    reader.accept({
      type: "session_meta",
      payload: { id: "synthetic-codex", git: { branch } },
    });
    reader.accept({ type: "turn_context", payload: { model: "model-a" } });
    reader.accept({
      type: "event_msg",
      payload: { type: "user_message", message },
    });
    reader.accept({
      timestamp: at,
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: { input_tokens: 90, output_tokens: 2 },
          last_token_usage: { input_tokens: 90, output_tokens: 2 },
        },
      },
    });
    return reader.finish().rows[0];
  };
  expect(read("You are the crew checker for issue 7", "crew/7")).toMatchObject({
    role: "checker",
    branch: "crew/7",
    max_prompt_tokens: 90,
  });
  expect(read("Fix the build please", "HEAD")).toMatchObject({
    role: null,
    branch: null,
  });
});
