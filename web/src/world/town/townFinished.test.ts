import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  nextTownFinished,
  TownFinishedTracker,
  townTrackedAgents,
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
});

test("a finished agent stops being finished when it works again or leaves", () => {
  const step = nextTownFinished(
    statuses({ a: "idle", b: "idle" }),
    agents({ a: "working" }),
    new Set(["a", "b"]),
  );
  expect(step.started).toEqual([]);
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
});

test("a check also applies to a finish Town inferred, wherever it was made", () => {
  const agent = (key: string, semanticStatus: string) => ({
    key,
    semanticStatus,
    roomKey: "room",
    currentPaneRef: { connectionId: "synthetic", nativeId: key },
  });
  const office = {
    rooms: [],
    receptions: [],
    barAgents: [],
    roster: [
      { roomKey: "room", agent: agent("a", "idle") },
      { roomKey: "room", agent: agent("b", "done") },
    ],
  } as unknown as HerdrOfficeProjection;
  // Both finished while Town watched; both are checked.
  const presented = withTownFinished(
    office,
    new Set(["a", "b"]),
    new Set(["a", "b"]),
  );
  expect(presented.roster.map(({ agent }) => agent.semanticStatus)).toEqual([
    "idle",
    "idle",
  ]);
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

const officeOf = (
  rooms: string[],
  agents: Record<string, [room: string, status: string]>,
) =>
  ({
    rooms: rooms.map((key) => ({ key })),
    roster: Object.entries(agents).map(([key, [roomKey, semanticStatus]]) => ({
      agent: { key, roomKey, semanticStatus },
    })),
  }) as unknown as HerdrOfficeProjection;

test("Board sees a finish Town observed before the switch (#787)", () => {
  const tracker = new TownFinishedTracker();
  // Town is open while the agent works, then closes; Board opens on it idle.
  tracker.observe(officeOf(["room"], { a: ["room", "working"] }));
  tracker.observe(officeOf(["room"], { a: ["room", "idle"] }));
  expect([...tracker.get()]).toEqual(["a"]);
  // The same tracker, fed by the other view, keeps it.
  tracker.observe(officeOf(["room"], { a: ["room", "idle"] }));
  expect([...tracker.get()]).toEqual(["a"]);
});

test("a finish seen working by Town and idle by Board is a finish (#787)", () => {
  const tracker = new TownFinishedTracker();
  tracker.observe(officeOf(["room"], { a: ["room", "working"] }));
  // Town unmounts; Board's first observation sees the agent idle.
  tracker.observe(officeOf(["room"], { a: ["room", "idle"] }));
  expect([...tracker.get()]).toEqual(["a"]);
});

test("an agent outside the presented rooms keeps its finish until it leaves", () => {
  const tracker = new TownFinishedTracker();
  // Town presents the selected room; Board, without that selection, does not.
  tracker.observe(officeOf(["sel"], { a: ["sel", "working"] }));
  tracker.observe(officeOf(["sel"], { a: ["sel", "idle"] }));
  tracker.observe(officeOf(["other"], { a: ["sel", "idle"] }));
  expect([...tracker.get()]).toEqual(["a"]);
  tracker.observe(officeOf(["other"], {}));
  expect([...tracker.get()]).toEqual([]);
});

test("a status kept for an unpresented agent counts when it is presented again", () => {
  const step = nextTownFinished(
    new Map([["a", "working"]]),
    [],
    new Set<string>(),
    () => new Set(["a"]),
  );
  expect(step.statuses.get("a")).toBe("working");
  const next = nextTownFinished(
    step.statuses,
    agents({ a: "idle" }),
    step.finished,
  );
  expect([...next.finished]).toEqual(["a"]);
});
