import assert from "node:assert/strict";
import { WorldSnapshotAdmission } from "../server/src/bridge/world-snapshot-admission";
import { observe } from "./observations";
import type { TraceState } from "./replay";
export type CreditState = {
  slots: { phase: string; index: number }[];
  live: boolean[];
  socket: number;
  id: number;
  index: number;
  released: boolean;
  rejected: boolean;
  releasedSocket: number;
  releasedIndex: number;
  releasedId: number;
};
type Pending = { state: "pending" | "resolved" | "rejected"; index: number };
export async function replayChunkCredits(
  states: TraceState[],
  Admission = WorldSnapshotAdmission,
) {
  const admission = new Admission(60_000);
  const sockets = [{}, {}];
  const handles = new Map<number, ReturnType<WorldSnapshotAdmission["open"]>>();
  const pending = new Map<number, Pending>();
  const tasks: Promise<void>[] = [];
  const witnesses = new Set<string>();
  let resolved = 0;
  const releasedTokens: { socket: number; id: number; index: number }[] = [];
  let rejected = 0;
  let failure: unknown;
  let operationFailure: unknown;
  try {
    for (const [sequence, state] of states.entries()) {
      const before = sequence ? states[sequence - 1]! : state;
      const h = state.socket;
      const i = state.id;
      const key = h === 0 ? i : 3;
      const socket = sockets[h]!;
      const id = `synthetic-request-${i}`;
      const oldResolved = resolved;
      const oldRejected = rejected;
      switch (state.op) {
        case "init":
          break;
        case "open":
          try {
            handles.set(key, admission.open(socket, id));
          } catch (error) {
            assert(error instanceof Error);
            assert.match(error.message, /capacity exceeded/);
            rejected++;
          }
          break;
        case "wait": {
          const outcome: Pending = { state: "pending", index: state.index };
          const waiting = handles.get(key)!.wait([3, 7, 11][state.index]!);
          if (before.slots[key]!.phase === "open") pending.set(key, outcome);
          const task = waiting.then(
            () => {
              outcome.state = "resolved";
              resolved++;
              releasedTokens.push({ socket: h, id: i, index: outcome.index });
            },
            (error) => {
              outcome.state = "rejected";
              rejected++;
              if (
                !(error instanceof Error) ||
                !/already pending|transfer retired/.test(error.message)
              )
                failure = error;
            },
          );
          tasks.push(task);
          break;
        }
        case "acknowledge":
          observe(
            "credits.recognized",
            admission.acknowledge(socket, {
              world_snapshot_admitted: { id, index: [3, 7, 11][state.index]! },
            }),
            true,
          );
          break;
        case "close":
          handles.get(key)!.close();
          break;
        case "retire":
          admission.retire(socket);
          break;
        default:
          throw new Error("Unknown chunk credit action");
      }
      await Promise.resolve();
      if (failure !== undefined) throw failure;
      observe(
        "credits.released",
        resolved - oldResolved,
        state.released ? 1 : 0,
      );
      if (state.released) {
        const token = releasedTokens.at(-1)!;
        observe("credits.released.socket", token.socket, state.releasedSocket);
        observe("credits.released.request", token.id, state.releasedId);
        observe("credits.released.index", token.index, state.releasedIndex);
      }
      observe("credits.rejected", rejected > oldRejected, state.rejected);
      for (const [key, value] of pending) {
        const phase = state.slots[key]!.phase;
        observe(
          "credits.wait.state",
          value.state === "pending",
          phase === "waiting",
        );
        if (phase === "waiting")
          observe("credits.wait.index", value.index, state.slots[key]!.index);
      }
      if (
        state.op === "open" &&
        state.rejected &&
        state.slots[key]!.phase === "new" &&
        state.slots.filter(
          (slot, k) =>
            Math.floor(k / 3) === h && ["open", "waiting"].includes(slot.phase),
        ).length === 2
      )
        witnesses.add("capacityDenied");
      if (
        state.op === "open" &&
        !state.rejected &&
        state.slots.some(
          (slot, k) => Math.floor(k / 3) === h && slot.phase === "closed",
        )
      )
        witnesses.add("capacityReused");
      if (
        state.op === "wait" &&
        state.rejected &&
        state.slots[key]!.phase === "waiting"
      )
        witnesses.add("duplicateWait");
      if (state.op === "retire" && state.rejected)
        witnesses.add("retirementCancelled");
      if (state.op === "acknowledge") {
        const peer = h === 1 ? i : 3;
        if (
          (h === 1 || i === 0) &&
          state.slots[peer]!.phase === "waiting" &&
          state.slots[peer]!.index === state.index &&
          !state.released
        )
          witnesses.add("wrongSocket");
        if (
          (h === 0 || i === 0) &&
          state.slots[key]!.phase === "waiting" &&
          state.slots[key]!.index !== state.index
        )
          witnesses.add("wrongIndex");
      }
    }
  } catch (error) {
    operationFailure = error;
  } finally {
    for (const socket of sockets) admission.retire(socket);
    await Promise.all(tasks);
  }
  if (failure !== undefined) throw failure;
  if (operationFailure !== undefined) throw operationFailure;
  return witnesses;
}
