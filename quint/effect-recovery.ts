import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { effectFixture, OWNER } from "../server/src/effects/testing/fixture";
import {
  createEffectRunner,
  EffectExecutionStopped,
} from "../server/src/effects/runner";
import type { EffectRecovery } from "../server/src/storage/world-protocol";
import { observe } from "./observations";
import { openWorldWriter } from "../server/src/storage/world-writer";
import type { TraceState } from "./replay";

export const effectActions = [
  "init",
  "claimCrash",
  "dispatchCrash",
  "sourceCrash",
  "receipt",
  "crash",
  "offline",
  "attach",
  "gone",
  "cancel",
  "revoke",
  "upgrade",
  "migrate",
  "ownerDecision",
  "permanent",
  "peerClaim",
  "duplicateClaim",
  "recover",
];
export type EffectState = {
  recovery: EffectRecovery;
  phase: string;
  resume: string;
  attempt: number;
  ever: boolean;
  applied: number;
  receipt: boolean;
  handle: boolean;
  authorized: boolean;
  cancelled: boolean;
  binding: string;
  version: number;
  supported: number;
  owner: boolean;
  peerClaimed: boolean;
  peerAttempt: number;
};
export function validateEffectTrace(value: unknown): void {
  assert(Array.isArray(value) && value.length > 1, "empty effect trace");
  for (const [i, state] of value.entries()) {
    assert(
      state && typeof state === "object" && effectActions.includes(state.op),
      "unknown effect action",
    );
    assert(
      i === 0 ? state.op === "init" : state.op !== "init",
      "invalid effect initialization order",
    );
    const e = state.effect;
    assert(
      e &&
        [
          "keyed",
          "reconcilable",
          "reattachable",
          "repeatable",
          "opaque",
        ].includes(e.recovery),
      "invalid effect recovery",
    );
    assert(
      [
        "pending",
        "claimed",
        "dispatching",
        "source",
        "delivered",
        "uncertain",
        "refused",
        "cancelled",
        "needs-migration",
      ].includes(e.phase),
      "invalid effect phase",
    );
    assert(typeof e.resume === "string", "invalid effect resume phase");
    for (const key of [
      "ever",
      "receipt",
      "handle",
      "authorized",
      "cancelled",
      "owner",
      "peerClaimed",
    ])
      assert(typeof e[key] === "boolean", "invalid effect flag");
    for (const key of ["attempt", "applied", "peerAttempt"])
      assert(
        Number.isSafeInteger(e[key]) && e[key] >= 0 && e[key] <= 2,
        "invalid effect bound",
      );
    for (const number of [e.version, e.supported, state.incarnation])
      assert(number === 1 || number === 2, "invalid effect identity");
    assert(
      ["attached", "unresolved", "ended"].includes(e.binding),
      "invalid effect binding",
    );
    if (i) {
      const before: EffectState = value[i - 1].effect;
      assert(e.recovery === before.recovery, "effect recovery changed");
      if (
        ["claimCrash", "dispatchCrash", "sourceCrash", "permanent"].includes(
          state.op,
        )
      )
        assert(
          before.phase === "pending" && before.attempt === 0,
          "invalid effect attempt precondition",
        );
      if (state.op === "crash")
        assert(
          ["claimed", "dispatching", "source"].includes(before.phase) &&
            value[i - 1].incarnation === 1,
          "invalid effect crash precondition",
        );
      if (state.op === "receipt")
        assert(
          before.phase === "source",
          "invalid effect receipt precondition",
        );
      if (state.op === "recover")
        assert(
          ["pending", "uncertain"].includes(before.phase) && before.attempt < 2,
          "invalid effect recovery precondition",
        );
    }
  }
}

/** Real outbox/source SQLite, real kernel, event-held crash boundaries. The
 * separate process-kill matrix checks source and compiled process durability. */
export async function replayEffectRecovery(
  states: TraceState[],
  runner = createEffectRunner,
  writer = openWorldWriter,
) {
  const directory = mkdtempSync(join(tmpdir(), "synthetic-effect-replay-"));
  const recovery = states[0]!.effect.recovery as EffectRecovery;
  let incarnation = 1,
    version = 1;
  let wall = 1000;
  let pauseAt: string | undefined;
  let gate: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let reached: ReturnType<typeof Promise.withResolvers<void>> | undefined;
  let work: Promise<unknown> | undefined;
  const open = () =>
    effectFixture(directory, recovery, {
      incarnation: `effect-incarnation-${incarnation}`,
      version,
      now: wall,
      runner,
      writer,
      checkpoint: async (phase) => {
        if (phase === pauseAt) {
          reached!.resolve();
          await gate!.promise;
        }
      },
    });
  let f = open();
  const peerContract = { ...f.contract, idempotency_key: "peer-key" };
  f.writer.batch(
    [
      {
        ticket: 1,
        request: {
          type: "write",
          write: {
            at: 1000,
            revision: f.writer.read().document.revision,
            asks: { put: [], remove: [] },
            changes: { put: [], remove: [] },
            results: {
              put: [
                {
                  id: "r-peer",
                  at: 1000,
                  actor: { label: "Synthetic owner", verified: false },
                  task: "peer",
                  summary: "Independent intent",
                  status: "done",
                },
              ],
              remove: [],
            },
            effects: [
              {
                kind: "synthetic.delivery",
                record_id: "r-peer",
                recovery,
                target: peerContract.targets[0]!,
                contract: peerContract,
              },
            ],
          },
        },
      },
    ],
    1000,
  );
  const peerId = f.writer
    .read()
    .attention.find((entry) => entry.record_id === "r-peer")!.id;
  const witnesses = new Set<string>();
  const abandon = async () => {
    gate?.reject(new EffectExecutionStopped());
    await work;
    work = undefined;
    gate = undefined;
    pauseAt = undefined;
  };
  try {
    for (const state of states) {
      const e = state.effect as EffectState;
      const checkedBefore = Number(f.read("authorizations"));
      const callsBefore = Number(f.read("calls"));
      const attemptBefore = (await f.store.get(f.id))!.attempt;
      switch (state.op) {
        case "init":
          break;
        case "claimCrash":
        case "dispatchCrash":
        case "sourceCrash": {
          pauseAt = {
            claimCrash: "claimed",
            dispatchCrash: "dispatching",
            sourceCrash: "after-source",
          }[state.op as "claimCrash"];
          reached = Promise.withResolvers<void>();
          gate = Promise.withResolvers<void>();
          work = f.runner.run(f.id).catch((error) => {
            if (!(error instanceof EffectExecutionStopped)) throw error;
          });
          await Promise.race([reached.promise, work]);
          break;
        }
        case "receipt":
          gate!.resolve();
          await work;
          work = undefined;
          pauseAt = undefined;
          break;
        case "crash":
          await abandon();
          wall = f.clock.now() + 3_600_000;
          await f.close();
          incarnation = 2;
          f = open();
          break;
        case "offline":
          f.set("binding", "unresolved");
          break;
        case "attach":
          f.set("binding", "attached");
          break;
        case "gone":
          f.set("binding", "ended");
          break;
        case "revoke":
          f.set("authorized", "0");
          break;
        case "cancel":
          await f.store.transition({
            action: "cancel",
            id: f.id,
            actor: OWNER,
            reason: "Owner cancelled this intent",
          });
          break;
        case "upgrade":
          wall = f.clock.now() + 3_600_000;
          await f.close();
          version = 2;
          f = open();
          break;
        case "migrate":
          await f.store.transition({
            action: "migrate",
            id: f.id,
            from: 1,
            to: 2,
            actor: OWNER,
            reason: "Owner approved the version migration",
          });
          break;
        case "ownerDecision":
          await f.store.transition({
            action: "decide",
            id: f.id,
            attempt: (await f.store.get(f.id))!.attempt,
            actor: OWNER,
            reason: "Owner approved a possible duplicate",
          });
          break;
        case "permanent":
          f.set("permanent", "1");
          await f.runner.run(f.id);
          break;
        case "peerClaim":
          await f.store.transition({
            action: "claim",
            id: peerId,
            incarnation: f.incarnation,
          });
          break;
        case "duplicateClaim":
          observe(
            "effect.peer.cas",
            await f.store.transition({
              action: "claim",
              id: peerId,
              incarnation: f.incarnation,
            }),
            null,
          );
          break;
        case "recover":
          f.advance(f.clock.now() + 1_000_000_000);
          await f.runner.run(f.id);
          break;
      }
      const actual = (await f.store.get(f.id))!;
      const phase =
        actual.state === "pending" && actual.claimed
          ? "claimed"
          : actual.state === "dispatching" && pauseAt === "after-source"
            ? "source"
            : actual.state;
      observe("effect.phase", phase, e.phase);
      observe("effect.attempt", actual.attempt, e.attempt);
      const keys = f.source.query("SELECT key FROM applied").all() as {
        key: string;
      }[];
      observe(
        "effect.receipt",
        keys.every((row) => row.key === f.contract.idempotency_key),
        true,
      );
      if (
        ["dispatchCrash", "sourceCrash", "permanent"].includes(state.op) ||
        Number(f.read("calls")) > callsBefore
      )
        observe(
          "effect.authorized",
          Number(f.read("authorizations")) - checkedBefore >= 2,
          true,
        );
      observe("effect.applied", f.applied().length, e.applied);
      observe("effect.ever", actual.ever_dispatched, e.ever);
      observe("effect.receipt", Boolean(actual.receipt), e.receipt);
      observe("effect.handle", Boolean(actual.external_handle), e.handle);
      observe("effect.version", actual.contract?.version, e.version);
      if (actual.claimed || actual.state === "dispatching")
        observe("effect.fence", actual.attempt_fence, {
          service_incarnation: f.incarnation,
          attempt: actual.attempt,
        });
      if (
        actual.state === "dispatching" ||
        (actual.attempt > attemptBefore && actual.targets.length > 0)
      )
        observe("effect.target", actual.targets[0]?.fence, {
          connection_id: "example",
          generation: 1,
          service_incarnation: f.incarnation,
        });
      const peer = (await f.store.get(peerId))!;
      observe("effect.peer.claimed", peer.claimed, e.peerClaimed);
      observe("effect.peer.attempt", peer.attempt, e.peerAttempt);
      if (actual.not_sent)
        observe("effect.notSent", actual.ever_dispatched, false);
      if (e.phase === "delivered" && e.attempt === 2) {
        const name = {
          keyed: "keyedRetry",
          reconcilable: "reconciled",
          reattachable: "reattached",
        }[recovery as "keyed"];
        if (name) witnesses.add(name);
      }
      if (recovery === "repeatable" && e.applied === 2)
        witnesses.add("repeated");
      if (recovery === "opaque" && e.phase === "uncertain")
        witnesses.add("opaqueStopped");
      if (incarnation === 2 && !e.ever && e.phase === "pending")
        witnesses.add("claimReleased");
      if (e.phase === "refused") witnesses.add("permanentRefusal");
      if (e.phase === "needs-migration") witnesses.add("migrationBlocked");
      if (e.version === 2) witnesses.add("migrated");
      if (e.cancelled && !e.ever) witnesses.add("cancelBefore");
      if (e.cancelled && e.receipt) witnesses.add("cancelAfter");
      if (!e.authorized && e.phase === "refused") witnesses.add("revoked");
      if (e.binding === "unresolved" && e.phase === "pending" && e.attempt > 0)
        witnesses.add("offlineWaits");
      if (e.binding === "ended" && e.phase === "uncertain")
        witnesses.add("goneAfterDispatch");
      if (state.op === "duplicateClaim") witnesses.add("peerFenced");
    }
    return witnesses;
  } finally {
    await abandon();
    await f.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
