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

test("Mark reviewed sends the stop the caller showed", async () => {
  const calls: unknown[][] = [];
  const store = {
    mutate: async (...args: unknown[]) => {
      calls.push(args);
      return true;
    },
  } as unknown as WorldDeskStore;
  const leaf = agent("done");
  expect(await markReviewed(store, leaf, "stop:shown")).toBe(true);
  expect(calls).toEqual([
    [
      "world.desk.review",
      deskIdentity(leaf),
      { stop_id: "stop:shown", reviewed: true },
    ],
  ]);
});
