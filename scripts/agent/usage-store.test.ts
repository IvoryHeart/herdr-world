import { expect, test } from "bun:test";
import { UsageStore } from "./usage-store";
import { postComment, type Runner } from "./usage-github";
import { parsePrOptions, uniqueSeats } from "./usage-cli";

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
