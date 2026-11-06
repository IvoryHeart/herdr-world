import { expect, test } from "bun:test";
import { replayEffectRecovery, type EffectState } from "./effect-recovery";
import type { EffectRecovery } from "../server/src/storage/world-protocol";
import { parseTrace } from "./traces";

function trace(recovery: EffectRecovery) {
  let effect: EffectState = {
    recovery,
    phase: "pending",
    resume: "pending",
    attempt: 0,
    ever: false,
    applied: 0,
    receipt: false,
    handle: false,
    authorized: true,
    cancelled: false,
    binding: "attached",
    version: 1,
    supported: 1,
    owner: false,
    peerClaimed: false,
    peerAttempt: 0,
  };
  let incarnation = 1;
  const states = [{ op: "init", effect, incarnation }];
  const step = (op: string, patch: Partial<EffectState>) => {
    effect = { ...effect, ...patch };
    states.push({ op, effect, incarnation });
  };
  step("peerClaim", { peerClaimed: true, peerAttempt: 1 });
  step("duplicateClaim", {});
  step("sourceCrash", {
    phase: "source",
    attempt: 1,
    ever: true,
    applied: 1,
    handle: recovery === "reattachable",
  });
  incarnation = 2;
  step("crash", { phase: "uncertain", peerClaimed: false });
  if (recovery === "opaque") step("recover", {});
  else
    step("recover", {
      phase: "delivered",
      attempt: 2,
      receipt: true,
      applied: recovery === "repeatable" ? 2 : 1,
    });
  step("upgrade", {
    supported: 2,
    resume: effect.phase,
    phase: effect.phase === "uncertain" ? "needs-migration" : effect.phase,
  });
  step("migrate", { version: 2, phase: effect.resume });
  return parseTrace("effect-recovery", JSON.stringify({ states }));
}
for (const recovery of [
  "keyed",
  "reconcilable",
  "reattachable",
  "repeatable",
  "opaque",
] as const)
  test(`M5 replays ${recovery} recovery, peer CAS and migration on actual SQLite`, async () => {
    const witnesses = await replayEffectRecovery(trace(recovery));
    expect(witnesses.has("peerFenced")).toBe(true);
    expect(witnesses.has("migrated")).toBe(true);
    if (recovery === "repeatable") expect(witnesses.has("repeated")).toBe(true);
  });

test("M5 rejects invalid ordering before replay and incorrect model outcomes during replay", async () => {
  const states = trace("keyed");
  expect(() =>
    parseTrace(
      "effect-recovery",
      JSON.stringify({ states: [states[0], { ...states[1], op: "receipt" }] }),
    ),
  ).toThrow("invalid effect receipt precondition");
  const incorrect = states.map((state) =>
    state.op === "sourceCrash"
      ? { ...state, effect: { ...state.effect, applied: 2 } }
      : state,
  );
  await expect(replayEffectRecovery(incorrect)).rejects.toThrow(
    "effect.applied",
  );
});
