import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSession, resolveLogs } from "./usage-records";
import { attribute, inferredWindows, renderComment } from "./usage-attribution";
import { prMissingCount } from "./usage-cli";
import { UsageStore } from "./usage-store";

const seat = {
  seat: "firstmate",
  family: "claude" as const,
  session: "00000000-0000-4000-8000-000000000007",
};
const start = "2026-10-25T10:00:00.000Z";
const before = "2026-10-25T10:01:00.000Z";
const after = "2026-10-25T10:02:00.000Z";
const now = "2026-10-25T10:10:00.000Z";
const user = (at: string, text = "Coordinate #7") => ({
  type: "user",
  timestamp: at,
  message: { content: text },
});
const assistant = (at: string, id: string) => ({
  type: "assistant",
  timestamp: at,
  message: { id, model: "claude-opus-5-5", usage: { output_tokens: 5 } },
});
const encode = (...records: unknown[]) =>
  records
    .map((r) => (typeof r === "string" ? r : JSON.stringify(r)))
    .join("\n");

test("semantic Claude failures retain valid responses and break estimates at the last good record", () => {
  const invalid = [
    {
      type: "assistant",
      timestamp: after,
      message: { model: "claude-opus-5-5", usage: { output_tokens: 3 } },
    },
    {
      ...assistant(after, "negative"),
      message: { id: "negative", usage: { output_tokens: -1 } },
    },
    assistant("invalid", "bad-time"),
    user("invalid", "Coordinate #8"),
    {
      ...assistant(after, "null-count"),
      message: { id: "null-count", usage: { output_tokens: null } },
    },
    {
      type: "user",
      timestamp: after,
      message: { content: [{ type: "text", text: { toString: null } }] },
    },
    {
      ...assistant(after, "bad-model"),
      message: {
        id: "bad-model",
        model: { toString: null },
        usage: { output_tokens: 3 },
      },
    },
  ];
  for (const bad of invalid) {
    const parsed = parseSession(
      seat,
      encode(
        user(start),
        assistant(before, "before"),
        bad,
        assistant(after, "after"),
      ),
    );
    expect(parsed.incompleteRecords).toBe(1);
    expect(parsed.events).toHaveLength(2);
    const rows = attribute(
      parsed.events,
      inferredWindows(seat, parsed.turns, 7, [], now),
    );
    expect(rows.find((r) => r.pr === 7)?.responses).toBe(1);
    expect(rows.find((r) => r.pr === null)?.responses).toBe(1);
  }
});

test("post-gap usage at the last good millisecond remains unattributed", () => {
  const parsed = parseSession(
    seat,
    encode(
      user(start),
      assistant(before, "before"),
      "{broken}",
      assistant(before, "after"),
    ),
  );
  const rows = attribute(
    parsed.events,
    inferredWindows(seat, parsed.turns, 7, [], now),
  );
  expect(rows.find((r) => r.pr === 7)?.responses).toBe(1);
  expect(rows.find((r) => r.pr === null)?.responses).toBe(1);
});

test("a completed corrupt tail invalidates a cached estimate during global ingestion", () => {
  const warm = new UsageStore(":memory:"),
    cold = new UsageStore(":memory:");
  try {
    const first = parseSession(seat, encode(user(start), "{broken"));
    warm.refresh(
      7,
      [{ seat, events: first.events, gaps: first.gaps }],
      inferredWindows(seat, first.turns, 7, [], now),
      0,
    );
    const unrelated = {
      pr: 8,
      ...seat,
      role: "builder" as const,
      source: "assignment" as const,
      from: "2026-10-25T11:00:00.000Z",
      until: "2026-10-25T12:00:00.000Z",
    };
    warm.refresh(8, [], [unrelated], 1);
    const complete = parseSession(
      seat,
      encode(user(start), "{broken}", assistant(after, "after")),
    );
    warm.refresh(
      null,
      [{ seat, events: complete.events, gaps: complete.gaps }],
      [],
      0,
    );
    cold.refresh(
      7,
      [{ seat, events: complete.events, gaps: complete.gaps }],
      inferredWindows(seat, complete.turns, 7, [], now),
      1,
    );
    expect(warm.rows()).toEqual(cold.rows());
    expect(warm.rows()[0]).toMatchObject({ pr: null, responses: 1 });
    expect(warm.windows(7)[0]?.until).toBe("2026-10-25T10:00:00.001Z");
    expect(warm.windows(8)).toEqual([unrelated]);
    expect(warm.missing(8)).toBe(1);
  } finally {
    warm.close();
    cold.close();
  }
});

test("PR relevance survives an empty attribution window without importing unrelated gaps", () => {
  const parsed = parseSession(
    seat,
    encode(user(start), "{broken}", assistant(after, "after")),
  );
  const claims = [{ seat, prs: parsed.claimedPrs }];
  expect(prMissingCount(7, [seat], [], [], claims)).toBe(1);
  expect(prMissingCount(8, [seat], [], [], claims)).toBe(0);
  expect(
    renderComment(7, [], prMissingCount(7, [seat], [], [], claims)),
  ).toContain("PR session logs: 1");
});

test("semantic damage in a Claude child preserves the parent and sibling observations", async () => {
  const root = await mkdtemp(join(tmpdir(), "usage-recovery-"));
  try {
    await Bun.write(
      join(root, `${seat.session}.jsonl`),
      encode(user(start), assistant(before, "parent")),
    );
    await Bun.write(
      join(root, seat.session, "subagents", "agent-example.jsonl"),
      encode(
        assistant(before, "child-before"),
        {
          type: "assistant",
          timestamp: after,
          message: { usage: { output_tokens: -1 } },
        },
        assistant(after, "child-after"),
      ),
    );
    const [loaded] = await resolveLogs([seat], { codex: root, claude: root });
    expect(loaded?.parsed.events).toHaveLength(3);
    expect(loaded?.parsed.incompleteRecords).toBe(1);
    expect(loaded?.parsed.gaps).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("PR relevance remains available when a damaged session later becomes unreadable", () => {
  const store = new UsageStore(":memory:");
  try {
    const parsed = parseSession(
      seat,
      encode(user("invalid"), assistant(after, "after")),
    );
    store.refresh(
      7,
      [
        {
          seat,
          events: parsed.events,
          claimedPrs: parsed.claimedPrs,
          gaps: parsed.gaps,
        },
      ],
      [],
      1,
    );
    store.assign(
      {
        pr: 8,
        seat: seat.seat,
        session: seat.session,
        role: "builder",
        from: start,
        until: now,
      },
      seat,
    );
    const retained = store.sessions();
    expect(
      prMissingCount(
        7,
        retained,
        [],
        [],
        retained.map((s) => ({ seat: s, prs: s.claimedPrs ?? [] })),
      ),
    ).toBe(1);
    expect(retained[0]?.claimedPrs).toEqual([7]);
  } finally {
    store.close();
  }
});
