import assert from "node:assert/strict";
import type { Frame } from "./herdr-core-observe";

/** The herdr-core model's state, as Quint's ITF traces carry it. */
export type Terminal = {
  alive: boolean;
  born: boolean;
  x: number;
  y: number;
  occupant: number;
};
export type Event = {
  epoch: number;
  gen: number;
  seq: number;
  target: number;
  kind: string;
};
export type CoreState = {
  source: Terminal[];
  mirror: Terminal[];
  history: Terminal[][];
  queue: Event[];
  seq: number;
  cursor: number;
  epoch: number;
  generation: number;
  owner: number;
  connected: boolean;
  ready: boolean;
  running: boolean;
  changes: number;
  replaced: boolean;
  captured: boolean;
  leaseGen: number;
  leaseOwner: number;
  leaseEpoch: number;
  session: number;
  foreground: boolean;
  pending: boolean;
  queued: boolean;
  uncertain: boolean;
  attempts: number;
  delivered: number;
  admitted: boolean;
  dispatched: boolean;
  published: boolean;
  safe: boolean;
  /** Terminal 2 (index 1) dies with terminal 1 when core ends it (M7). */
  child: boolean;
  planned: boolean;
  confirmedChild: boolean;
  confirmedOccupant: number;
  killed: boolean;
  lead: number;
  grid: number;
  watching: boolean;
  confirmed: boolean;
  frames: Frame[];
  credit: boolean;
  pendingGrid: number;
  backlog: boolean;
  stream: number;
  shown: number;
  misdrawn: boolean;
  typed: boolean;
  outputs: number;
  /** World's keyboard (typing family): 0 none, 1 attach in flight, 2 open. */
  keys: number;
  waiting: number;
  left: boolean;
  asked: boolean;
  pressed: number;
  sent: number;
  refused: number;
  replies: number;
  worldLeads: boolean;
  stray: boolean;
};
export type CoreTraceState = {
  c: CoreState;
  op: string;
  target: number;
  family?: string;
};

/** Rejects a trace whose actions, families or state fields the replay does not know. */
export function checkCoreTrace(
  value: unknown,
  shape: CoreState,
  eventBound: number,
): asserts value is CoreTraceState[] {
  assert(Array.isArray(value) && value.length > 1, "empty core trace");
  for (const [index, item] of value.entries()) {
    assert(item && typeof item === "object" && typeof item.op === "string");
    assert(
      [
        "init",
        "connect",
        "baseline",
        "create",
        "remove",
        "x",
        "y",
        "receive",
        "missed",
        "drop",
        "heartbeat",
        "disconnect",
        "restart",
        "absent",
        "switchProfile",
        "replace",
        "capture",
        "loseForeground",
        "dispatch",
        "deliver",
        "complete",
        "recover",
        "plan",
        "kill",
        "pane",
        "output",
        "watch",
        "unwatch",
        "stall",
        "drain",
        "frame",
        "viewport",
        "paneTouch",
        "key",
        "attached",
        "attachRefused",
        "leave",
        "reply",
        "keyboardLost",
        "reoccupy",
      ].includes(item.op),
      "unknown core trace action",
    );
    assert(index === 0 ? item.op === "init" : item.op !== "init");
    assert(
      item.family === undefined ||
        ["ordering", "authority", "observe", "typing"].includes(item.family),
      "unknown core family",
    );
    assert(item.family === value[0].family, "core family changed");
    assert(
      item.target === 0 ||
        item.target === 1 ||
        (item.op === "pane" && item.target === 2),
    );
    assert(item.c && typeof item.c === "object");
    assert.deepEqual(Object.keys(item.c).sort(), Object.keys(shape).sort());
    for (const [key, initial] of Object.entries(shape)) {
      const field = item.c[key];
      if (typeof initial === "number")
        assert(Number.isSafeInteger(field) && field >= -1 && field <= 3);
      else if (typeof initial === "boolean") assert(typeof field === "boolean");
      else assert(Array.isArray(field));
    }
    for (const group of [item.c.source, item.c.mirror, ...item.c.history]) {
      assert(Array.isArray(group) && group.length === 2);
      for (const t of group) {
        assert(
          t && typeof t.alive === "boolean" && typeof t.born === "boolean",
        );
        assert.deepEqual(Object.keys(t).sort(), [
          "alive",
          "born",
          "occupant",
          "x",
          "y",
        ]);
        for (const key of ["x", "y", "occupant"])
          assert(
            Number.isSafeInteger(t[key]) && t[key] >= 0 && t[key] <= eventBound,
          );
      }
    }
    for (const frame of item.c.frames) {
      assert.deepEqual(Object.keys(frame).sort(), ["grid", "kind", "stream"]);
      assert(["resize", "data"].includes(frame.kind));
      assert(
        Number.isSafeInteger(frame.grid) && frame.grid >= 0 && frame.grid <= 3,
      );
      assert(
        Number.isSafeInteger(frame.stream) &&
          frame.stream >= 0 &&
          frame.stream <= 2,
      );
    }
    for (const event of item.c.queue) {
      assert.deepEqual(Object.keys(event).sort(), [
        "epoch",
        "gen",
        "kind",
        "seq",
        "target",
      ]);
      assert(["create", "remove", "x", "y"].includes(event.kind));
      assert(event.target === 0 || event.target === 1);
      for (const key of ["epoch", "gen", "seq", "target"])
        assert(
          Number.isSafeInteger(event[key]) &&
            event[key] >= 0 &&
            event[key] <= eventBound,
        );
    }
  }
}
