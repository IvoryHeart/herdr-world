import assert from "node:assert/strict";
import { resolveBinding } from "../server/src/world/binding-resolution";
import type {
  BindingEvent,
  BindingFence,
  SourceBinding,
} from "../server/src/world/binding-types";
import type { TraceState } from "./replay";
import { observe } from "./observations";

export type BindingModelState = {
  policy: "board" | "appearance";
  native: number;
  witness: number;
  state: SourceBinding["state"];
  source: number;
  terminal: number;
  present: boolean;
  duplicate: boolean;
  health: "current" | "partial" | "offline";
  gen: number;
  inc: number;
  lost: boolean;
  followedLost: boolean;
  endedByListing: boolean;
  allowed: boolean;
  absenceSafe: boolean;
  retargetSafe: boolean;
  preserved: boolean;
};
const actions = [
  "init",
  "observeComplete",
  "observePartial",
  "offline",
  "herdrRestart",
  "worldRestart",
  "moveByWorld",
  "moveReplyLost",
  "moveOutside",
  "closeObserved",
  "notFound",
  "duplicate",
  "userKeep",
  "userDetach",
  "lookAlike",
];
export function validateBindingTrace(
  value: unknown,
): asserts value is TraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty binding trace");
  for (const [index, entry] of value.entries()) {
    assert(
      entry &&
        actions.includes(entry.op) &&
        (index === 0 ? entry.op === "init" : entry.op !== "init"),
    );
    const b = entry.binding;
    assert(
      b &&
        ["board", "appearance"].includes(b.policy) &&
        ["attached", "unresolved", "unconfirmed", "ended"].includes(b.state),
    );
    assert(["current", "partial", "offline"].includes(b.health));
    for (const key of ["native", "witness", "source", "terminal", "inc"])
      assert([0, 1].includes(b[key]));
    assert([1, 2].includes(b.gen));
    for (const key of [
      "present",
      "duplicate",
      "lost",
      "followedLost",
      "endedByListing",
      "allowed",
      "absenceSafe",
      "retargetSafe",
      "preserved",
    ])
      assert(typeof b[key] === "boolean");
  }
}
const fence = (b: BindingModelState): BindingFence => ({
  adapter: "synthetic",
  instance: "studio",
  service_incarnation: `service-${b.inc}`,
  generation: b.gen,
});
const entity = (b: BindingModelState) => ({
  native_id: `pane-${b.source}`,
  terminals: [`terminal-${b.terminal}`],
});
export async function replayBindingResolution(
  states: TraceState[],
  resolve = resolveBinding,
) {
  let b = states[0]!.binding;
  let saved: SourceBinding = {
    id: "b-fixture",
    revision: 0,
    record_id: "n-fixture",
    slot: "to",
    policy: b.policy === "board" ? "board-string" : "appearance",
    adapter: "synthetic",
    instance: "studio",
    kind: "pane",
    native_id: `pane-${b.native}`,
    evidence: { terminals: [`terminal-${b.witness}`] },
    state: b.state,
    checked_at: null,
  };
  const witnesses = new Set<string>();
  for (const entry of states.slice(1)) {
    const next = entry.binding;
    const previous = saved;
    let event: BindingEvent;
    switch (entry.op) {
      case "observeComplete":
      case "observePartial": {
        const rows = next.present ? [entity(next)] : [];
        if (next.present && next.duplicate) rows.push(entity(next));
        event = {
          type: "listing",
          fence: fence(next),
          complete: entry.op === "observeComplete",
          entities: rows,
        };
        break;
      }
      case "moveByWorld":
        event = {
          type: "world-move",
          fence: fence(next),
          from: `pane-${b.native}`,
          target: entity(next),
        };
        break;
      case "closeObserved":
        event = {
          type: "absence",
          fence: fence(next),
          via: "close",
          native_id: `pane-${b.source}`,
        };
        break;
      case "notFound":
        event = {
          type: "absence",
          fence: fence(next),
          via: "not-found",
          native_id: `pane-${b.native}`,
        };
        break;
      case "userKeep":
        event = {
          type: "user-keep",
          target: {
            adapter: "synthetic",
            instance: "studio",
            kind: "pane",
            native_id: `pane-${next.source}`,
            evidence: { terminals: [`terminal-${next.terminal}`] },
          },
        };
        break;
      case "userDetach":
        event = { type: "user-detach" };
        break;
      default:
        event = { type: "offline" };
    }
    const result = resolve(
      saved,
      event,
      next.health === "offline" ? null : fence(next),
      1000,
    );
    saved = result.binding;
    const target = Boolean(result.target);
    const label =
      next.duplicate &&
      entry.op === "observeComplete" &&
      previous.state !== "ended"
        ? "binding.ambiguous"
        : saved.state === "attached" || next.state === "attached"
          ? "binding.attached"
          : (saved.state === "ended") !== (next.state === "ended")
            ? "binding.absence"
            : "binding.attached";
    observe(label, saved.state, next.state);
    observe("binding.target", saved.native_id, `pane-${next.native}`);
    observe("binding.evidence", saved.evidence.terminals, [
      `terminal-${next.witness}`,
    ]);
    observe("binding.authority", target, next.allowed);
    if (
      entry.op === "observeComplete" &&
      next.policy === "board" &&
      next.gen === 2 &&
      saved.state === "unconfirmed"
    )
      witnesses.add("restartUnconfirmed");
    if (
      entry.op === "observeComplete" &&
      next.inc === 1 &&
      saved.state === "attached"
    )
      witnesses.add("worldRestartReattached");
    if (entry.op === "observePartial" && saved.state === "unresolved")
      witnesses.add("partialKept");
    if (
      entry.op === "closeObserved" &&
      next.policy === "board" &&
      saved.state === "ended"
    )
      witnesses.add("closeEnded");
    if (
      entry.op === "observeComplete" &&
      next.policy === "appearance" &&
      previous.state !== "ended" &&
      saved.state === "ended" &&
      !next.duplicate &&
      (!next.present || next.terminal !== next.witness)
    )
      witnesses.add("allTerminalsGoneEnded");
    if (entry.op === "moveByWorld" && saved.state === "attached")
      witnesses.add("moveFollowed");
    if (
      entry.op === "observeComplete" &&
      next.policy === "appearance" &&
      next.lost &&
      saved.state === "attached" &&
      saved.native_id !== previous.native_id
    )
      witnesses.add("lostReplyFollowedByTerminal");
    if (
      entry.op === "observeComplete" &&
      next.policy === "board" &&
      next.present &&
      next.terminal === next.witness &&
      next.source !== next.native &&
      saved.state === "unresolved"
    )
      witnesses.add("outsideMoveUnresolved");
    if (
      entry.op === "observeComplete" &&
      next.duplicate &&
      saved.state === "unresolved"
    )
      witnesses.add("duplicateUnresolved");
    if (
      entry.op === "observeComplete" &&
      next.present &&
      next.source === next.native &&
      next.terminal !== next.witness &&
      saved.state !== "attached"
    )
      witnesses.add("lookAlikeRejected");
    b = next;
  }
  return witnesses;
}
