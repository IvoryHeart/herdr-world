import { expect, test } from "bun:test";
import {
  TOWN_QUIET_DEFAULT_MINUTES,
  townQuietAge,
  townQuietAgents,
  townQuietMinutes,
  townQuietSame,
  townQuietSince,
  townQuietText,
} from "./townQuietWork";

const MINUTE = 60_000;
const now = Date.UTC(2026, 10, 20, 14, 30);

test("a working agent is quiet once its last activity is the threshold old", () => {
  expect(townQuietSince("working", now - 9 * MINUTE, now, 10)).toBeNull();
  expect(townQuietSince("working", now - 10 * MINUTE, now, 10)).toBe(
    now - 10 * MINUTE,
  );
  expect(townQuietSince("working", now - 40 * MINUTE, now, 30)).toBe(
    now - 40 * MINUTE,
  );
});

test("only working agents with an activity time are ever quiet", () => {
  for (const status of ["idle", "blocked", "done", "unknown"])
    expect(townQuietSince(status, now - 60 * MINUTE, now, 10)).toBeNull();
  expect(townQuietSince("working", undefined, now, 10)).toBeNull();
  expect(townQuietSince("working", null, now, 10)).toBeNull();
  expect(townQuietSince("working", 0, now, 10)).toBeNull();
  expect(townQuietSince("working", Number.NaN, now, 10)).toBeNull();
});

test("a threshold of 0 turns the quiet look off", () => {
  expect(townQuietSince("working", now - 600 * MINUTE, now, 0)).toBeNull();
  expect(
    townQuietAgents(
      [{ key: "a", semanticStatus: "working" }],
      () => now - 600 * MINUTE,
      now,
      0,
    ).size,
  ).toBe(0);
});

test("the quiet look clears the moment the session moves again", () => {
  const agents = [{ key: "a", semanticStatus: "working" }];
  let at = now - 15 * MINUTE;
  expect([...townQuietAgents(agents, () => at, now, 10).keys()]).toEqual(["a"]);
  at = now - 2_000;
  expect(townQuietAgents(agents, () => at, now, 10).size).toBe(0);
});

test("quiet agents keep roster order and their last activity", () => {
  const agents = [
    { key: "a", semanticStatus: "working" },
    { key: "b", semanticStatus: "idle" },
    { key: "c", semanticStatus: "working" },
    { key: "d", semanticStatus: "working" },
  ];
  const times: Record<string, number | undefined> = {
    a: now - 25 * MINUTE,
    b: now - 90 * MINUTE,
    c: undefined,
    d: now - 12 * MINUTE,
  };
  const quiet = townQuietAgents(agents, (agent) => times[agent.key], now, 10);
  expect([...quiet]).toEqual([
    ["a", now - 25 * MINUTE],
    ["d", now - 12 * MINUTE],
  ]);
  expect(
    townQuietAgents(agents, (agent) => times[agent.key], now, 20).size,
  ).toBe(1);
});

test("quiet maps compare by agents and times", () => {
  const a = new Map([["x", 1]]);
  expect(townQuietSame(a, new Map([["x", 1]]))).toBe(true);
  expect(townQuietSame(a, new Map([["x", 2]]))).toBe(false);
  expect(townQuietSame(a, new Map())).toBe(false);
});

test("the setting admits only offered thresholds", () => {
  expect(townQuietMinutes(30)).toBe(30);
  expect(townQuietMinutes(0)).toBe(0);
  expect(townQuietMinutes(7)).toBe(TOWN_QUIET_DEFAULT_MINUTES);
  expect(townQuietMinutes("30")).toBe(TOWN_QUIET_DEFAULT_MINUTES);
  expect(townQuietMinutes(undefined)).toBe(10);
});

test("the hover text says how long and when", () => {
  const since = now - 23 * MINUTE;
  expect(townQuietText(since, now)).toMatch(
    /^No progress for 23 m \(last .+\)$/,
  );
  expect(townQuietText(now - 75 * MINUTE, now)).toMatch(
    /^No progress for 1 h 15 m /,
  );
  expect(townQuietText(now - 120 * MINUTE, now)).toMatch(
    /^No progress for 2 h \(/,
  );
});

test("the mark's number is how long the agent has gone quiet", () => {
  expect(townQuietAge(now - 23 * MINUTE - 30_000, now)).toBe("23m");
  expect(townQuietAge(now - 65 * MINUTE, now)).toBe("1h 05m");
  // A clock behind the session file never shows a negative time.
  expect(townQuietAge(now + MINUTE, now)).toBe("0m");
});
