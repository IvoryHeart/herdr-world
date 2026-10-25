import { expect, test } from "bun:test";
import { UsageStore } from "./usage-store";
import { postComment, type Runner } from "./usage-github";
import { parsePrOptions, prMissingCount, uniqueSeats } from "./usage-cli";
import { parseSession } from "./usage-records";

test("local ledger refresh is idempotent and preserves prior usage if a log disappears", () => {
  const store = new UsageStore(":memory:");
  const seat = {
    seat: "builder",
    session: "synthetic",
    family: "claude" as const,
  };
  const from = "2026-10-25T10:00:00.000Z",
    until = "2026-10-25T11:00:00.000Z";
  const event = {
    ...seat,
    id: "msg",
    model: "claude-opus-5-5",
    effort: "unknown",
    at: from,
    input: 10,
    cacheRead: 20,
    cacheWrite: 30,
    output: 5,
    responses: 1,
  };
  const window = {
    pr: 7,
    ...seat,
    role: "builder" as const,
    from,
    until,
    source: "assignment" as const,
  };
  try {
    store.assign({ ...window }, seat);
    store.refresh(7, [{ seat, events: [event] }], [window], 0);
    store.refresh(7, [{ seat, events: [event] }], [window], 0);
    expect(store.rows()).toHaveLength(1);
    expect(store.rows()[0]).toMatchObject({ responses: 1, pr: 7 });
    store.refresh(7, [], [window], 1);
    expect(store.rows()[0]).toMatchObject({ responses: 1, pr: 7 });
    expect(store.missing(7)).toBe(1);
    store.refresh(
      7,
      [{ seat, events: [{ ...event, output: 1 }] }],
      [window],
      0,
    );
    expect(store.rows()[0]?.output).toBe(5);
  } finally {
    store.close();
  }
});

test("one marked comment is created once, updated in place and unchanged bodies are skipped", async () => {
  const comments: { id: number; body: string; user: { login: string } }[] = [
    {
      id: 4,
      body: "<!-- crew-usage --> someone else's comment",
      user: { login: "another" },
    },
  ];
  const writes: string[][] = [];
  const runner: Runner = async (args, input) => {
    if (args[2] === "user") return JSON.stringify({ login: "synthetic" });
    if (args[2]?.includes("?per_page")) return JSON.stringify(comments);
    writes.push(args);
    const body = JSON.parse(input!).body;
    if (args.includes("POST"))
      comments.push({ id: 5, body, user: { login: "synthetic" } });
    else comments[1]!.body = body;
    return "{}";
  };
  const first = "<!-- crew-usage -->\nfirst",
    second = "<!-- crew-usage -->\nsecond";
  expect(await postComment("example/project", 7, first, runner)).toBe(
    "created",
  );
  expect(await postComment("example/project", 7, first, runner)).toBe(
    "unchanged",
  );
  expect(await postComment("example/project", 7, second, runner)).toBe(
    "updated",
  );
  expect(writes).toHaveLength(2);
  expect(writes[1]).toContain("repos/example/project/issues/comments/5");
});

test("CLI rejects invalid roles, conflicting timestamps and misplaced publication flags", () => {
  expect(() => parsePrOptions(["pr", "7", "--post"])).toThrow("only valid");
  expect(() => parsePrOptions(["assign", "7", "--seat", "builder"])).toThrow(
    "requires",
  );
  expect(() =>
    parsePrOptions(["pr", "7", "--from", "2026-10-25T10:00:00Z"]),
  ).toThrow("assign");
});

test("unnamed discovery entries retain valid session descriptors", () => {
  const unknown = {
    session: "synthetic",
    seat: "unknown",
    family: "codex" as const,
  };
  expect(uniqueSeats([unknown])).toEqual([unknown]);
  expect(uniqueSeats([{ ...unknown, seat: "builder" }, unknown])[0]?.seat).toBe(
    "builder",
  );
});

test("mixed Codex accounting reconciles cold and incremental imports without losing history", () => {
  const seat = {
    seat: "builder",
    family: "codex" as const,
    session: "synthetic",
  };
  const at = "2026-10-25T10:00:00.000Z";
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 80,
    output_tokens: 10,
    reasoning_output_tokens: 0,
    total_tokens: 110,
  };
  const snapshot = JSON.stringify({
    timestamp: at,
    type: "event_msg",
    payload: {
      type: "token_count",
      info: { last_token_usage: usage, total_token_usage: usage },
    },
  });
  const dedicated = JSON.stringify({
    timestamp: at,
    type: "token_usage_record",
    payload: { response_id: "response", usage },
  });
  const newer = JSON.stringify({
    timestamp: "2026-10-25T10:01:00.000Z",
    type: "token_usage_record",
    payload: { response_id: "new-response", usage },
  });
  const cold = new UsageStore(":memory:"),
    incremental = new UsageStore(":memory:");
  try {
    incremental.refresh(
      7,
      [{ seat, events: parseSession(seat, snapshot).events }],
      [],
      0,
    );
    const events = parseSession(
      seat,
      `${snapshot}\n${dedicated}\n${newer}`,
    ).events;
    cold.refresh(7, [{ seat, events }], [], 0);
    incremental.refresh(7, [{ seat, events }], [], 0);
    const count = (store: UsageStore) =>
      store.rows().reduce((n, r) => n + r.responses, 0);
    expect(count(cold)).toBe(2);
    expect(count(incremental)).toBe(2);
    expect(parseSession(seat, `${snapshot}\n${newer}`).events).toHaveLength(2);
  } finally {
    cold.close();
    incremental.close();
  }
});

test("readable shortened logs retain established review attribution", () => {
  const store = new UsageStore(":memory:");
  const seat = {
    seat: "rev2",
    family: "claude" as const,
    session: "synthetic",
  };
  const from = "2026-10-25T10:00:00.000Z",
    until = "2026-10-25T11:00:00.000Z";
  const event = {
    ...seat,
    id: "response",
    model: "claude-opus-5-5",
    effort: "unknown",
    at: from,
    input: 10,
    cacheRead: 0,
    cacheWrite: 0,
    output: 5,
    responses: 1,
  };
  try {
    store.refresh(
      7,
      [{ seat, events: [event] }],
      [
        {
          pr: 7,
          ...seat,
          from,
          until,
          role: "reviewer:rev2",
          source: "review",
        },
      ],
      0,
    );
    store.refresh(7, [{ seat, events: [] }], [], 0);
    expect(store.rows()[0]).toMatchObject({ pr: 7, responses: 1 });
    store.refresh(7, [{ seat, events: [] }], [], 0, new Set());
    expect(store.rows()[0]).toMatchObject({ pr: null, responses: 1 });
  } finally {
    store.close();
  }
});

test("cumulative counters replace stored legacy snapshots even with delayed response timestamps", () => {
  const store = new UsageStore(":memory:");
  const seat = {
    seat: "builder",
    family: "codex" as const,
    session: "synthetic",
  };
  const usage = {
    input_tokens: 100,
    cached_input_tokens: 80,
    cache_write_input_tokens: 5,
    output_tokens: 10,
    reasoning_output_tokens: 0,
    total_tokens: 110,
  };
  const cumulative = {
    ...usage,
    input_tokens: 200,
    cached_input_tokens: 160,
    cache_write_input_tokens: 10,
    output_tokens: 20,
    total_tokens: 220,
  };
  const snapshot = (total: object, at: string) =>
    JSON.stringify({
      type: "event_msg",
      timestamp: at,
      payload: {
        type: "token_count",
        info: { last_token_usage: usage, total_token_usage: total },
      },
    });
  const first = snapshot(usage, "2026-10-25T10:00:00.000Z"),
    second = snapshot(cumulative, "2026-10-25T10:01:00.000Z");
  const response = JSON.stringify({
    type: "token_usage_record",
    timestamp: "2026-10-25T10:01:50.000Z",
    payload: {
      response_id: "second-response",
      usage,
      thread_token_usage: cumulative,
    },
  });
  try {
    const events = parseSession(seat, `${first}\n${second}`).events;
    events[1]!.id = `count:${JSON.stringify(cumulative)}`;
    store.refresh(7, [{ seat, events }], [], 0);
    store.refresh(
      7,
      [{ seat, events: parseSession(seat, response).events }],
      [],
      0,
    );
    expect(store.rows().reduce((n, r) => n + r.responses, 0)).toBe(2);
    expect(
      store
        .rows()
        .reduce(
          (n, r) => n + r.input + r.cacheRead + r.cacheWrite + r.output,
          0,
        ),
    ).toBe(220);
    expect(
      parseSession(seat, `${first}\n${second}\n${response}`).events,
    ).toHaveLength(2);
  } finally {
    store.close();
  }
});

test("only unavailable sessions linked to the requested PR affect its measurement caveat", () => {
  const relevant = {
    seat: "builder",
    family: "codex" as const,
    session: "relevant",
  };
  const unrelated = {
    seat: "other",
    family: "claude" as const,
    session: "unrelated",
  };
  const assignment = {
    ...relevant,
    pr: 7,
    role: "builder" as const,
    from: "2026-10-25T10:00:00.000Z",
    until: "2026-10-25T11:00:00.000Z",
  };
  expect(prMissingCount(7, [unrelated], [], [assignment])).toBe(0);
  expect(prMissingCount(7, [relevant, unrelated], [], [assignment])).toBe(1);
  expect(() =>
    parsePrOptions([
      "assign",
      "7",
      "--seat",
      "builder",
      "--role",
      "builder",
      "--from",
      assignment.from,
    ]),
  ).toThrow("--until");
});

test("complete Codex records correct legacy cache-write classification without inflating totals", () => {
  const store = new UsageStore(":memory:");
  const seat = {
    seat: "builder",
    family: "codex" as const,
    session: "synthetic",
  };
  const event = {
    ...seat,
    id: "response",
    model: "gpt-6.1-sol",
    effort: "xhigh",
    at: "2026-10-25T10:00:00.000Z",
    input: 20,
    cacheRead: 80,
    cacheWrite: 0,
    output: 10,
    responses: 1,
  };
  try {
    store.refresh(7, [{ seat, events: [event] }], [], 0);
    store.refresh(
      7,
      [{ seat, events: [{ ...event, input: 15, cacheWrite: 5 }] }],
      [],
      0,
    );
    expect(store.rows()[0]).toMatchObject({
      input: 15,
      cacheWrite: 5,
      responses: 1,
    });
    expect(
      store
        .rows()
        .reduce(
          (n, r) => n + r.input + r.cacheRead + r.cacheWrite + r.output,
          0,
        ),
    ).toBe(110);
  } finally {
    store.close();
  }
});
