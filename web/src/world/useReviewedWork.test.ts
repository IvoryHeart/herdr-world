import { expect, test } from "bun:test";
import type { DeskRecord } from "../../../shared/deskState";
import type { WorldDeskStore } from "./deskStateStore";
import { handoffId, IDLE_WINDOW_MS } from "./handoffs";
import { deskIdentity, deskMetadata } from "./useDeskState";
import {
  awaitsReview,
  isReviewedStop,
  markReviewed,
  reviewStop,
  reviewStopKnown,
  reviewedAgentKeys,
} from "./useReviewedWork";
import type { WorldLeafObject } from "./worldObject";

const NOW = 1_000_000;
const agent = (status: WorldLeafObject["status"], lastActivityAt = NOW - 50) =>
  ({
    id: "local:agent:w1:p1",
    kind: "agent",
    connectionId: "local",
    generation: 3,
    terminalId: "terminal-1",
    agentSessionFingerprint: "session-a",
    status,
    lastActivityAt,
  }) as unknown as WorldLeafObject;
const record = (
  leaf: WorldLeafObject,
  values: Partial<DeskRecord> = {},
): DeskRecord => ({
  ...deskIdentity(leaf),
  reviewed_stop: null,
  stopped_at: NOW - 100,
  observed_stop_id: "stop-1",
  opened_at: null,
  ...values,
});

test("Town and Needs you name a stop as Desk does, so one mark clears it everywhere", () => {
  const leaf = agent("idle");
  const stop = reviewStop(leaf, record(leaf));
  const deskId = handoffId(leaf, NOW - 100, "stop-1");
  expect(stop).toBe((JSON.parse(deskId) as [string, string])[1]);
  // Marking that stop in Town or Needs you is what Desk counts as handled.
  const marked = record(leaf, { reviewed_stop: stop });
  expect(isReviewedStop(leaf, marked)).toBe(true);
  const desk = deskMetadata([leaf], {
    revision: 1,
    records: [marked],
    verified: true,
    error: null,
  });
  expect(desk.handled.has(deskId)).toBe(true);
});

test("a new turn clears an old review mark", () => {
  const leaf = agent("done");
  const marked = record(leaf, {
    reviewed_stop: reviewStop(leaf, record(leaf)),
  });
  expect(awaitsReview(leaf, marked, NOW)).toBe(false);
  // The service saw a new stop.
  expect(
    awaitsReview(leaf, { ...marked, observed_stop_id: "stop-2" }, NOW),
  ).toBe(true);
  // Or the agent was active again since.
  expect(awaitsReview(agent("done", NOW - 10), marked, NOW)).toBe(true);
});

test("finished work is a done agent, or an idle one the service saw stop recently", () => {
  expect(awaitsReview(agent("done"), undefined, NOW)).toBe(true);
  const idle = agent("idle");
  expect(awaitsReview(idle, record(idle), NOW)).toBe(true);
  expect(awaitsReview(idle, undefined, NOW)).toBe(false);
  expect(
    awaitsReview(
      idle,
      record(idle, { stopped_at: NOW - IDLE_WINDOW_MS - 1 }),
      NOW,
    ),
  ).toBe(false);
  expect(awaitsReview(agent("working"), record(idle), NOW)).toBe(false);
});

function stores(records: DeskRecord[] = []) {
  const calls: unknown[][] = [];
  const store = {
    get: () => ({ revision: 1, records, verified: true, error: null }),
    mutate: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as WorldDeskStore;
  store.refresh = async () => {
    calls.push(["world.desk.get"]);
  };
  return {
    calls,
    store,
    replace: (next: DeskRecord[]) => {
      records = next;
    },
  };
}

test("Mark reviewed sends the stop the caller showed", async () => {
  const leaf = agent("done"),
    { calls, store } = stores([record(leaf)]);
  expect(await markReviewed(store, leaf, "stop:shown")).toBe(true);
  expect(calls).toEqual([
    [
      "world.desk.review",
      deskIdentity(leaf),
      { stop_id: "stop:shown", reviewed: true },
    ],
  ]);
});

test("Mark reviewed uses the current qualified Desk stop without changing its shape", async () => {
  const leaf = agent("done"),
    current = record(leaf);
  const { calls, store } = stores([current]);
  await markReviewed(store, leaf);
  expect(calls).toEqual([
    [
      "world.desk.review",
      deskIdentity(leaf),
      { stop_id: reviewStop(leaf, current), reviewed: true },
    ],
  ]);
});

test("missing or unverified Desk stops refresh authoritatively and never mark by terminal or activity alone", async () => {
  for (const leaf of [
    agent("done"),
    { ...agent("done"), lastActivityAt: undefined } as WorldLeafObject,
  ]) {
    const { calls, store } = stores();
    expect(reviewStopKnown(leaf, undefined)).toBe(false);
    expect(await markReviewed(store, leaf)).toBe(false);
    expect(await markReviewed(store, leaf, reviewStop(leaf, undefined))).toBe(
      false,
    );
    expect(calls).toEqual([["world.desk.get"], ["world.desk.get"]]);
  }
  const leaf = agent("done"),
    f = stores([record(leaf)]);
  f.store.get = () => ({
    revision: 1,
    records: [record(leaf)],
    verified: false,
    error: null,
  });
  expect(await markReviewed(f.store, leaf)).toBe(false);
  expect(f.calls).toEqual([["world.desk.get"]]);
});

test("a refreshed same-identity stop can be reviewed, but a replacement cannot", async () => {
  const leaf = agent("done");
  for (const replacement of [false, true]) {
    const f = stores();
    f.store.refresh = async () => {
      f.replace([
        record(
          leaf,
          replacement ? { agent_session_fingerprint: "replacement" } : {},
        ),
      ]);
    };
    expect(await markReviewed(f.store, leaf)).toBe(!replacement);
    expect(f.calls.length).toBe(replacement ? 0 : 1);
  }
});

test("Town's reviewed agents stay the same set while nothing changed", () => {
  const roster = [
    { agent: { key: "a", nodeId: "n-a", semanticStatus: "done" } },
    { agent: { key: "b", nodeId: "n-b", semanticStatus: "idle" } },
    { agent: { key: "c", nodeId: "n-c", semanticStatus: "working" } },
  ];
  const looked: string[] = [];
  const leafOf = (nodeId: string) => (
    looked.push(nodeId), { id: nodeId } as unknown as WorldLeafObject
  );
  const reviewed = (leaf: WorldLeafObject) => leaf.id !== "n-b";
  const first = reviewedAgentKeys(
    roster,
    new Set(["b"]),
    leafOf,
    reviewed,
    new Set(),
  );
  expect([...first]).toEqual(["a"]);
  // Only finished agents (done, or idle that Town saw finish) are looked up.
  expect(looked).toEqual(["n-a", "n-b"]);
  // Same keys: the same set, so Town's presented office is not rebuilt.
  expect(
    reviewedAgentKeys(roster, new Set(["b"]), leafOf, reviewed, first),
  ).toBe(first);
  const next = reviewedAgentKeys(
    roster,
    new Set(["b"]),
    leafOf,
    () => true,
    first,
  );
  expect(next).not.toBe(first);
  expect([...next].sort()).toEqual(["a", "b"]);
});

test("a report with only activity cannot claim review after a service stop appears", async () => {
  const leaf = agent("done"),
    f = stores();
  f.store.refresh = async () => {
    f.replace([record(leaf)]);
  };
  expect(await markReviewed(f.store, leaf, reviewStop(leaf, undefined))).toBe(
    false,
  );
  expect(f.calls).toEqual([]);
});
