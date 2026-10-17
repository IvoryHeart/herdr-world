import { expect, test } from "bun:test";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import { nextTownFinished, withTownFinished } from "./townFinished";

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
  });
  const office = {
    rooms: [{ roomAgents: [agent("a", "idle"), agent("b", "done")] }],
    receptions: [],
    barAgents: [],
    roster: [
      { agent: agent("a", "idle") },
      { agent: agent("b", "done") },
      { agent: agent("c", "idle") },
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
