import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  replaySeen,
  type SeenState,
  type SeenSubjects,
  seenFaults,
  seenImplementationFaults,
  seenInitial,
  seenMismatches,
  seenStep,
  type SeenTraceState,
} from "./herdr-core-seen";
import { mutateImplementation } from "./implementationMutation";
import { expectObservationMismatch } from "./observations";
import { validateTrace } from "./traces";

type Op = Parameters<typeof seenStep>[1];
type Fault = Parameters<typeof seenStep>[2];

function trace(ops: Op[], fault: Fault = "none"): SeenTraceState[] {
  let s: SeenState = seenInitial;
  const states: SeenTraceState[] = [{ op: "init", s }];
  for (const op of ops) {
    const next = seenStep(s, op, fault);
    if (!next) throw new Error(`${op} is not enabled`);
    s = next;
    states.push({ op, s });
  }
  return states;
}

const safe = (s: SeenState) =>
  s.label <= s.turn && !s.blind && !s.lowered && !s.overUnread && !s.hidden;

// A look shares turn 1; the phone marks it unread while the page stays on;
// the next refresh keeps it unread; turn 2 is shared by the same look.
const kept: Op[] = [
  "endTurn",
  "look",
  "refresh",
  "dispatch",
  "appUnread",
  "refresh",
  "endTurn",
  "refresh",
  "dispatch",
];
// The phone looks, then marks it unread, between World's decision on a
// missing label and its write: the write is refused.
const moved: Op[] = [
  "endTurn",
  "look",
  "refresh",
  "appSeen",
  "appUnread",
  "dispatch",
];

test("production keeps another client's unread and never writes a moved label", () => {
  const first = trace(kept);
  expect(first.every((state) => safe(state.s))).toBe(true);
  expect([...replaySeen(first)].sort()).toEqual([
    "lookedAgain",
    "sharedTurn",
    "unreadKept",
  ]);
  const second = trace(moved);
  expect(second.at(-1)!.s).toMatchObject({ label: 0, refused: true });
  expect(replaySeen(second).has("refusedMoved")).toBe(true);
  // The recorded validator accepts both.
  validateTrace("herdr-core-seen", first);
  validateTrace("herdr-core-seen", second);
});

test("a hidden page, a stale host and a lost write decide or write nothing", () => {
  const states = trace([
    "endTurn",
    "look",
    "background",
    "refresh",
    "foreground",
    "flicker",
    "refresh",
    "flicker",
    "refresh",
    "lose",
    "refresh",
  ]);
  expect(states.at(-1)!.s).toMatchObject({ label: -1, writes: 0 });
  expect([...replaySeen(states)].sort()).toEqual([
    "flickerQuiet",
    "hiddenQuiet",
    "lostWrite",
  ]);
});

const witnessesOf: Record<(typeof seenFaults)[number], Op[]> = {
  "forget-look": kept.slice(0, 6),
  "hidden-look": ["endTurn", "look", "background", "refresh"],
  "stale-look": ["endTurn", "look", "flicker", "refresh"],
  "blind-write": moved,
  "unchecked-write": [
    "endTurn",
    "look",
    "refresh",
    "endTurn",
    "appSeen",
    "dispatch",
  ],
};

test("every model fault violates safety and diverges from production", async () => {
  for (const fault of seenFaults) {
    const states = trace(witnessesOf[fault], fault);
    expect(safe(states.at(-1)!.s)).toBe(false);
    await expectObservationMismatch(() => replaySeen(states), seenMismatches);
  }
});

const output = mkdtempSync(join(tmpdir(), "seen-mutants-"));
afterAll(() => rmSync(output, { recursive: true, force: true }));

test("every production fault is rejected by a valid trace", async () => {
  const valid: Record<(typeof seenImplementationFaults)[number], Op[]> = {
    "seen-forget-look": kept,
    "seen-hidden-look": ["endTurn", "look", "background", "refresh"],
    "seen-stale-look": ["endTurn", "look", "flicker", "refresh"],
    "seen-blind-write": moved,
  };
  for (const fault of seenImplementationFaults) {
    const states = trace(valid[fault]);
    replaySeen(states);
    const subjects = (await import(
      await mutateImplementation("herdr-core-seen", fault, {
        root: resolve(import.meta.dir, ".."),
        output,
      })
    )) as SeenSubjects;
    await expectObservationMismatch(
      () => replaySeen(states, subjects),
      seenMismatches,
    );
  }
});
