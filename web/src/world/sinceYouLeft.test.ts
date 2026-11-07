import { expect, test } from "bun:test";
import type { WorkItem } from "../../../shared/worldSources";
import type { NeedsYouItem } from "./needsYou";
import {
  arrivedWhileAway,
  AWAY_MS,
  awayFor,
  sinceYouLeft,
  sinceYouLeftShort,
} from "./sinceYouLeft";
import type { WorldAsk } from "./worldAsks";
import type { WorldLeafObject } from "./worldObject";

const MIN = 60_000;
// The owner left at 11:40 (minute 100) and came back three hours later.
const window = { since: 100 * MIN, at: 280 * MIN };

const leaf = (id: string, at: number) =>
  ({ id, agentName: id, lastActivityAt: at }) as unknown as WorldLeafObject;
const ask = (id: string, at: number, name: string) =>
  ({ id, at, actor: { label: name, verified: true, name } }) as WorldAsk;

const asked = (id: string, at: number, name: string): NeedsYouItem => ({
  kind: "asks",
  key: `ask:${id}`,
  ask: ask(id, at, name),
  leaf: null,
});
const blocked = (id: string, at: number): NeedsYouItem => ({
  kind: "needs",
  key: `leaf:${id}`,
  leaf: leaf(id, at),
});
const done = (id: string, at: number): NeedsYouItem => ({
  kind: "done",
  key: `leaf:${id}`,
  leaf: leaf(id, at),
});
const name = (item: NeedsYouItem) =>
  item.kind === "asks" ? (item.ask.actor.name ?? "") : item.leaf.id;
const merged = (id: string, finishedAt?: number): WorkItem =>
  ({
    key: `github:pr:example/repo#${id}`,
    kind: "pull_request",
    status: "merged",
    ...(finishedAt === undefined ? {} : { finishedAt }),
  }) as WorkItem;

// Needs you's own order: questions, blocked agents, then finished work.
const items: NeedsYouItem[] = [
  asked("before", 90 * MIN, "early"),
  asked("q1", 150 * MIN, "builder"),
  blocked("stuck-old", 60 * MIN),
  blocked("stuck-new", 200 * MIN),
  // Last activity predates leaving, but the service saw it block while away.
  blocked("stuck-seen", 70 * MIN),
  done("old-finish", 50 * MIN),
  // Herdr's last activity is old, but the service saw the stop while away.
  done("stop-seen", 40 * MIN),
  done("finish-1", 120 * MIN),
  done("after-return", 300 * MIN),
];
const stops: Record<string, number> = {
  "stop-seen": 260 * MIN,
  "stuck-seen": 210 * MIN,
};
const stoppedAt = (item: WorldLeafObject) =>
  stops[item.id] ?? item.lastActivityAt ?? null;

test("only what arrived while away counts, from facts World keeps", () => {
  expect(
    arrivedWhileAway(window, items, stoppedAt).map((item) => item.key),
  ).toEqual([
    "ask:q1",
    "leaf:stuck-new",
    "leaf:stuck-seen",
    "leaf:stop-seen",
    "leaf:finish-1",
  ]);
});

test("the recap is at most four lines, most important first", () => {
  const lines = sinceYouLeft({
    window,
    items,
    stoppedAt,
    name,
    sources: [
      merged("1", 110 * MIN),
      merged("2", 270 * MIN),
      merged("3", 10 * MIN),
      merged("4"),
      { ...merged("5", 130 * MIN), status: "open" },
    ],
  });
  expect(lines.map((line) => [line.text, line.itemKey])).toEqual([
    // A new question and two newly blocked agents, opening at the first.
    ["3 new for you", "ask:q1"],
    ["1 new question from builder", "ask:q1"],
    ["2 finished", "leaf:stop-seen"],
    // Merged pull requests have no Needs you item: the line opens Needs you.
    ["2 PRs merged", undefined],
  ]);
  expect(sinceYouLeftShort(lines)).toBe("3 for you, 2 finished, 2 merged");
});

test("questions alone take one line, and nothing new means no recap", () => {
  const lines = sinceYouLeft({
    window,
    items: [
      asked("q1", 150 * MIN, "builder"),
      asked("q2", 160 * MIN, "tester"),
      done("finish", 170 * MIN),
    ],
    stoppedAt,
    name,
  });
  expect(lines.map((line) => line.text)).toEqual([
    "2 new questions from builder and others",
    "1 finished",
  ]);
  expect(sinceYouLeftShort(lines)).toBe("2 for you, 1 finished");
  // Without a GitHub source there is no merged line.
  expect(
    sinceYouLeft({ window, items: items.slice(0, 1), stoppedAt, name }),
  ).toEqual([]);
});

test("away reads in minutes, hours, then days", () => {
  expect(awayFor(AWAY_MS)).toBe("30 min");
  expect(awayFor(3 * 60 * MIN)).toBe("3 h");
  expect(awayFor(47 * 60 * MIN)).toBe("47 h");
  expect(awayFor(3 * 24 * 60 * MIN)).toBe("3 d");
});
