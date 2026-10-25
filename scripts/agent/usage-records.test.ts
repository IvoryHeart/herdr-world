import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, discoverSeats, resolveLogs } from "./usage-records";
import { attribute, inferredWindows } from "./usage-attribution";

const session = {
  session: "00000000-0000-4000-8000-000000000001",
  seat: "builder",
  family: "claude" as const,
};
const at = "2026-10-25T10:00:00.000Z";
const lines = (...records: unknown[]) =>
  records.map((r) => JSON.stringify(r)).join("\n");

test("Claude streamed assistant messages take maxima per field and retain model", () => {
  const chunk = (usage: object) => ({
    type: "assistant",
    timestamp: at,
    message: { id: "msg_synthetic", model: "claude-opus-5-5", usage },
  });
  const result = parseSession(
    session,
    lines(
      chunk({
        input_tokens: 10,
        cache_read_input_tokens: 20,
        cache_creation_input_tokens: 30,
        output_tokens: 1,
      }),
      chunk({ input_tokens: 8, cache_read_input_tokens: 25, output_tokens: 7 }),
    ),
  );
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({
    model: "claude-opus-5-5",
    input: 10,
    cacheRead: 25,
    cacheWrite: 30,
    output: 7,
    responses: 1,
  });
});

test("Codex response records win over token_count mirrors and preserve context", () => {
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 10,
    reasoning_output_tokens: 5,
    total_tokens: 110,
  };
  const result = parseSession(
    { ...session, family: "codex" },
    lines(
      {
        type: "turn_context",
        timestamp: at,
        payload: { model: "gpt-6.1-sol", effort: "xhigh" },
      },
      {
        type: "event_msg",
        timestamp: at,
        payload: {
          type: "token_count",
          info: { last_token_usage: usage, total_token_usage: usage },
        },
      },
      {
        type: "token_usage_record",
        timestamp: at,
        payload: { response_id: "response", usage },
      },
    ),
  );
  expect(result.events).toHaveLength(1);
  expect(result.events[0]).toMatchObject({
    input: 20,
    cacheRead: 80,
    model: "gpt-6.1-sol",
    effort: "xhigh",
  });
});

test("Codex token_count-only logs dedupe repeated cumulative snapshots", () => {
  const usage = {
    input_tokens: 40,
    cached_input_tokens: 10,
    output_tokens: 5,
    reasoning_output_tokens: 0,
    total_tokens: 45,
  };
  const record = {
    type: "event_msg",
    timestamp: at,
    payload: {
      type: "token_count",
      info: { last_token_usage: usage, total_token_usage: usage },
    },
  };
  expect(
    parseSession({ ...session, family: "codex" }, lines(record, record)).events,
  ).toHaveLength(1);
});

test("discovery maps Herdr RPC agent names, kinds and local sessions", () => {
  expect(
    discoverSeats({
      result: {
        agents: [
          {
            name: "rev2",
            agent: "codex",
            agent_session: { value: session.session },
          },
          {
            name: "opus",
            agent: "claude",
            agent_session: { value: "/example/session.jsonl" },
          },
        ],
      },
    }),
  ).toEqual([
    { seat: "rev2", family: "codex", session: session.session },
    { seat: "opus", family: "claude", session: "/example/session.jsonl" },
  ]);
});

test("session lookup supports Claude IDs, explicit paths, missing logs and rejects aliases", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-synthetic-"));
  const path = join(root, `${session.session}.jsonl`);
  try {
    await Bun.write(
      path,
      JSON.stringify({
        type: "assistant",
        timestamp: at,
        message: {
          id: "msg",
          model: "claude-opus-5-5",
          usage: { output_tokens: 3 },
        },
      }),
    );
    const roots = { codex: root, claude: root };
    expect(
      (await resolveLogs([session], roots))[0]?.parsed.events[0]?.output,
    ).toBe(3);
    expect(
      (await resolveLogs([{ ...session, session: path }], roots))[0]?.parsed
        .events,
    ).toHaveLength(1);
    await expect(
      resolveLogs([session, { ...session, session: path }], roots),
    ).rejects.toThrow("same log");
    let missing = 0;
    expect(
      await resolveLogs([{ ...session, session: "missing" }], roots, () => {
        missing++;
      }),
    ).toEqual([]);
    expect(missing).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("live partial final lines are deferred and malformed Claude records are quarantined", () => {
  const chunk = JSON.stringify({
    type: "assistant",
    timestamp: at,
    message: {
      id: "msg",
      model: "claude-opus-5-5",
      usage: { output_tokens: 3 },
    },
  });
  expect(parseSession(session, `${chunk}\n{partial`).events).toHaveLength(1);
  expect(parseSession(session, `${chunk}\n{broken}\n`)).toMatchObject({
    incompleteRecords: 1,
  });
  expect(() =>
    parseSession({ ...session, family: "codex" }, `${chunk}\n{broken}\n`),
  ).toThrow("Malformed");
});

test("a damaged coordinator log retains valid usage while a gap stops the preceding estimate", () => {
  const seat = { ...session, seat: "firstmate" };
  const user = (timestamp: string) =>
    JSON.stringify({
      type: "user",
      timestamp,
      message: { content: "Please coordinate #7" },
    });
  const assistant = (timestamp: string, id: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp,
      message: { id, model: "claude-opus-5-5", usage: { output_tokens: 5 } },
    });
  const parsed = parseSession(
    seat,
    [
      user(at),
      assistant("2026-10-25T10:01:00.000Z", "before"),
      "{corrupt complete record}",
      assistant("2026-10-25T10:02:00.000Z", "after"),
      user("2026-10-25T10:03:00.000Z"),
      assistant("2026-10-25T10:04:00.000Z", "recovered"),
    ].join("\n"),
  );
  expect(parsed.events).toHaveLength(3);
  expect(parsed.incompleteRecords).toBe(1);
  expect(parsed.turns).toContainEqual({
    at: "2026-10-25T10:01:00.000Z",
    text: "",
  });
  const windows = inferredWindows(
    seat,
    parsed.turns,
    7,
    [],
    "2026-10-25T10:05:00.000Z",
  );
  const rows = attribute(parsed.events, windows);
  expect(
    rows.filter((r) => r.pr === 7).reduce((n, r) => n + r.responses, 0),
  ).toBe(1);
  expect(
    rows.filter((r) => r.pr === null).reduce((n, r) => n + r.responses, 0),
  ).toBe(2);
});

test("Claude session discovery includes child transcripts under the parent seat", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-children-"));
  try {
    const message = (id: string, output: number) =>
      JSON.stringify({
        type: "assistant",
        timestamp: at,
        message: {
          id,
          model: "claude-opus-5-5",
          usage: { output_tokens: output },
        },
      });
    await Bun.write(join(root, `${session.session}.jsonl`), message("main", 2));
    await Bun.write(
      join(root, session.session, "subagents", "agent-example.jsonl"),
      `${message("child", 3)}\n{broken child record}\n${message("child", 5)}`,
    );
    const [result] = await resolveLogs([session], {
      codex: root,
      claude: root,
    });
    expect(
      result?.parsed.events.map((e) => [e.id, e.output, e.session]),
    ).toEqual([
      ["main", 2, session.session],
      ["child", 5, session.session],
    ]);
    expect(result?.parsed.incompleteRecords).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("incomplete Codex dedicated and snapshot records are rejected rather than filled with zero", () => {
  const incomplete = { input_tokens: 100 };
  for (const record of [
    {
      type: "token_usage_record",
      timestamp: at,
      payload: { response_id: "incomplete", usage: incomplete },
    },
    {
      type: "event_msg",
      timestamp: at,
      payload: {
        type: "token_count",
        info: { last_token_usage: incomplete, total_token_usage: incomplete },
      },
    },
  ])
    expect(() =>
      parseSession({ ...session, family: "codex" }, lines(record)),
    ).toThrow("Incomplete Codex");
});
