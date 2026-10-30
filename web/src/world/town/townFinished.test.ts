import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  nextTownFinished,
  townTrackedAgents,
  townCheckedKeys,
  withTownFinished,
} from "./townFinished";

const statuses = (entries: Record<string, string>) =>
  new Map(Object.entries(entries));
const agents = (entries: Record<string, string>) =>
  Object.entries(entries).map(([key, semanticStatus]) => ({
    key,
    semanticStatus: semanticStatus as "working",
  }));

test("an agent that goes from working to idle has finished", () => {
  const step = nextTownFinished(
    statuses({ a: "working", b: "blocked", c: "idle" }),
    agents({ a: "idle", b: "idle", c: "idle" }),
    new Set(),
  );
  expect(step.started).toEqual(["a", "b"]);
  expect([...step.finished]).toEqual(["a", "b"]);
  expect(step.renewed.map((agent) => agent.key)).toEqual(["a", "b"]);
});

test("a finished agent stops being finished when it works again or leaves", () => {
  const step = nextTownFinished(
    statuses({ a: "idle", b: "idle" }),
    agents({ a: "working" }),
    new Set(["a", "b"]),
  );
  expect(step.started).toEqual([]);
  expect(step.renewed.map((agent) => agent.key)).toEqual(["a"]);
  expect([...step.finished]).toEqual([]);
});

test("an agent idle from the start has not finished anything", () => {
  const current = new Set<string>();
  const step = nextTownFinished(new Map(), agents({ a: "idle" }), current);
  expect(step.finished).toBe(current);
});

test("Town presents unchecked finishes as done and checked ones as idle", () => {
  const agent = (key: string, semanticStatus: string) => ({
    key,
    semanticStatus,
    roomKey: "room",
    currentPaneRef: { connectionId: "synthetic", nativeId: key },
  });
  const office = {
    rooms: [{ roomAgents: [agent("a", "idle"), agent("b", "done")] }],
    receptions: [],
    barAgents: [],
    roster: [
      { roomKey: "room", agent: agent("a", "idle") },
      { roomKey: "room", agent: agent("b", "done") },
      { roomKey: "room", agent: agent("c", "idle") },
    ],
  } as unknown as HerdrOfficeProjection;
  const presented = withTownFinished(office, new Set(["a"]), new Set(["b"]));
  expect(presented.roster.map(({ agent }) => agent.semanticStatus)).toEqual([
    "done",
    "idle",
    "idle",
  ]);
  expect(
    presented.rooms[0]!.roomAgents.map((agent) => agent.semanticStatus),
  ).toEqual(["done", "idle"]);
  expect(withTownFinished(office, new Set(), new Set())).toBe(office);
  // A finish Town saw that was reviewed elsewhere (Desk, Needs you, another
  // browser) is no longer presented as done.
  expect(
    withTownFinished(office, new Set(["a"]), new Set(["a"])).roster.map(
      ({ agent }) => agent.semanticStatus,
    ),
  ).toEqual(["idle", "done", "idle"]);
  // Reviewed keys are looked up for done agents and Town's own finishes only.
  const asked: string[] = [];
  const checked = townCheckedKeys(office, new Set(["a"]), ({ key }) => {
    asked.push(key);
    return key === "a";
  });
  expect(asked).toEqual(["a", "b"]);
  expect([...checked]).toEqual(["a"]);
});

test("finishes are tracked for every agent of a presented room", () => {
  // Office's bar shows at most 16 agents; the 17th still sits in Town.
  const roster = Array.from({ length: 17 }, (_, index) => ({
    agent: { key: `a${index}`, roomKey: "room", semanticStatus: "idle" },
  }));
  roster.push({
    agent: { key: "elsewhere", roomKey: "hidden", semanticStatus: "idle" },
  });
  const office = {
    rooms: [{ key: "room" }],
    roster,
    barAgents: roster.slice(0, 16).map(({ agent }) => agent),
  } as unknown as HerdrOfficeProjection;
  const tracked = townTrackedAgents(office).map((agent) => agent.key);
  expect(tracked).toContain("a16");
  expect(tracked).not.toContain("elsewhere");
  const step = nextTownFinished(
    new Map([["a16", "working"]]),
    townTrackedAgents(office),
    new Set(),
  );
  expect([...step.finished]).toEqual(["a16"]);
});
