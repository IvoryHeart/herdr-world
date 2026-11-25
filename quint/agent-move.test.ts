import { expect, test } from "bun:test";
import {
  moveMismatches,
  replayMove,
  validateMoveTrace,
  type MoveState,
} from "./agent-move";
import { expectObservationMismatch } from "./observations";

// Hand-written settled scenarios of quint/agent-move.qnt, replayed through the
// real moveAgentAcross. The full sampled set runs in `bun quint/run.ts`.
const initial: MoveState = {
  dir: "tui-core",
  pinned: false,
  shape: "idle",
  pc: "admit",
  src: "idle",
  srcConn: "up",
  dstConn: "up",
  alive: true,
  copy: false,
  desk: "src",
  outcome: "none",
  reason: "",
  namesCopy: false,
  namesOrig: false,
  namesDesk: false,
  gone: false,
  events: 0,
  effects: [],
  closedBusy: false,
  unfenced: false,
  startReply: "-",
  startTruth: false,
  pinReply: "-",
  rehomeReply: "-",
  closeReply: "-",
  closeTruth: false,
  stillRead: "-",
  cleanupReply: "-",
  cleanupTruth: false,
  unhomeReply: "-",
  envStart: "-",
  envRehome: "-",
  envClose: "-",
  harness: "resume",
  route: "across",
  closeFirst: false,
  // Claude re-attaches: any copy continues the agent's own conversation.
  copyConv: true,
  namesSaved: false,
  resumeReply: "-",
  resumeTruth: false,
  resumeCleanup: "-",
  resumeCleanupTruth: false,
  backReply: "-",
  backTruth: false,
  nativeReply: "-",
  again: "-",
};
const quiet = { envStart: "none", envRehome: "none", envClose: "none" };
const moved = {
  ...quiet,
  pc: "done",
  outcome: "moved",
  effects: ["start", "rehome", "close"],
  alive: false,
  copy: true,
  desk: "dst" as const,
  startReply: "ready",
  rehomeReply: "ok",
  closeReply: "ended",
};

function trace(final: Partial<MoveState>, scenario: Partial<MoveState> = {}) {
  const start = { ...initial, ...scenario };
  return validateMoveTrace([start, { ...start, ...final }].map((m) => ({ m })));
}

test("moves both ways, and a pinned desk travels with the agent", async () => {
  expect(await replayMove(trace(moved))).toEqual(["movedTuiCore"]);
  const pinned = { dir: "core-tui" as const, pinned: true };
  expect(
    await replayMove(
      trace(
        {
          ...moved,
          effects: ["start", "pin", "rehome", "close"],
          pinReply: "ok",
        },
        pinned,
      ),
    ),
  ).toEqual(["movedCoreTui"]);
});

test("a split source is refused before anything starts", async () => {
  const split = { shape: "split", src: "split" };
  expect(
    await replayMove(
      trace({ pc: "done", outcome: "refused", reason: "split" }, split),
    ),
  ).toEqual(["refusedSplit"]);
});

test("a lost start reply names the copy that may be running", async () => {
  const lost = {
    pc: "done",
    outcome: "refused",
    reason: "start",
    effects: ["start"],
    startReply: "lost",
    startTruth: true,
    copy: true,
    namesCopy: true,
  };
  await replayMove(trace(lost));
  // The unnamed-start fault's counterexample: production names the copy.
  const mismatch = await expectObservationMismatch(
    () => replayMove(trace({ ...lost, namesCopy: false })),
    moveMismatches,
  );
  expect(mismatch.observation).toBe("move.report");
});

test("an unreadable source after a lost close keeps the copy", async () => {
  const lostClose = {
    ...moved,
    outcome: "uncertain",
    reason: "close",
    closeReply: "lostEnded",
    stillRead: "fail",
    namesOrig: true,
  };
  expect(await replayMove(trace(lostClose))).toEqual(["lostCloseUnread"]);
  // The model's counterexample to the earlier code: assuming the source
  // still ran put the desk back and closed the copy, leaving no agent.
  const mismatch = await expectObservationMismatch(
    () =>
      replayMove(
        trace({
          ...lostClose,
          outcome: "refused",
          namesOrig: false,
          effects: ["start", "rehome", "close", "unhome", "discard"],
          unhomeReply: "ok",
          cleanupReply: "ended",
          copy: false,
          desk: "src",
        }),
      ),
    moveMismatches,
  );
  expect(mismatch.observation).toBe("move.outcome");
});

test("a child started before the close keeps the source and drops the copy", async () => {
  expect(
    await replayMove(
      trace(
        {
          ...moved,
          outcome: "refused",
          reason: "close",
          src: "child",
          events: 1,
          envClose: "child",
          alive: true,
          copy: false,
          desk: "src",
          stillRead: "ok",
          effects: ["start", "rehome", "close", "unhome", "discard"],
          unhomeReply: "ok",
          cleanupReply: "ended",
        },
        { dir: "core-tui" },
      ),
    ),
  ).toEqual(["childRefusedKill"]);
});

test("a source that turns busy while the desk moves is not closed", async () => {
  expect(
    await replayMove(
      trace({
        ...quiet,
        pc: "done",
        outcome: "refused",
        reason: "changed",
        src: "busy",
        events: 1,
        envRehome: "busy",
        startReply: "ready",
        rehomeReply: "ok",
        effects: ["start", "rehome", "unhome", "discard"],
        unhomeReply: "ok",
        cleanupReply: "ended",
        envClose: "-",
      }),
    ),
  ).toEqual(["changedDuringRehome"]);
});

test("a reconnected target is never reached through another lease", async () => {
  const regen = {
    pc: "done",
    outcome: "refused",
    reason: "target",
    dstConn: "regen",
    events: 1,
    envStart: "dstRegen",
    startReply: "ready",
    copy: true,
    namesCopy: true,
    effects: ["start", "discard"],
    cleanupReply: "ended",
  };
  expect(await replayMove(trace(regen))).toEqual([
    "regenFenced",
    "cleanupNamed",
  ]);
  // The fallback fault: the cleanup reached the reconnected side.
  const mismatch = await expectObservationMismatch(
    () => replayMove(trace({ ...regen, copy: false, unfenced: true })),
    moveMismatches,
  );
  expect(mismatch.observation).toBe("move.fence");
});
