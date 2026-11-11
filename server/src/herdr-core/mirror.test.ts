import { describe, expect, test } from "bun:test";
import type { CoreEventLine } from "./client";
import { CoreMirror, DEFAULT_CORE_MIRROR_LIMITS } from "./mirror";

const record = (address: string, fields: Record<string, unknown> = {}) => ({
  address,
  labels: {},
  argv: ["claude"],
  state: "live",
  pid: 100,
  reported: true,
  ...fields,
});
const event = (
  seq: number,
  type: string,
  terminal: string,
  data: unknown,
): CoreEventLine => ({
  method: "event",
  params: { seq, type, terminal, data },
});
const heartbeat = (seq: number): CoreEventLine => ({
  method: "heartbeat",
  params: { seq },
});
const missed = (seq: number, terminals: unknown[]): CoreEventLine => ({
  method: "missed",
  params: { seq, terminals: terminals as never },
});

describe("ordered mirror", () => {
  test("applies independent deltas in order and drops seq at or below the cursor", () => {
    const mirror = new CoreMirror();
    mirror.baseline(10, [record("t1"), record("t2")]);
    expect(mirror.apply(event(11, "title", "t1", { title: "a" }))).toBe(
      "applied",
    );
    expect(
      mirror.apply(event(12, "labels", "t2", { labels: { x: "1" } })),
    ).toBe("applied");
    // A delayed callback below the cursor never rolls state back.
    expect(mirror.apply(event(11, "title", "t1", { title: "old" }))).toBe(
      "stale",
    );
    expect(mirror.terminal("t1")?.title).toBe("a");
    expect(mirror.terminal("t2")?.labels).toEqual({ x: "1" });
    expect(mirror.cursor).toBe(12);
    expect(mirror.actionable).toBe(true);
  });

  test("an unexplained gap retires actionability and keeps the facts", () => {
    const mirror = new CoreMirror();
    mirror.baseline(1, [record("t1", { title: "kept" })]);
    expect(mirror.apply(event(3, "title", "t1", { title: "later" }))).toBe(
      "retired",
    );
    expect(mirror.retired).toBe("gap");
    expect(mirror.actionable).toBe(false);
    expect(mirror.terminal("t1")?.title).toBe("kept");
    // Nothing further is admitted over the hole.
    expect(mirror.apply(event(4, "title", "t1", { title: "x" }))).toBe(
      "ignored",
    );
  });

  test("a heartbeat above the cursor exposes silently dropped events", () => {
    const mirror = new CoreMirror();
    mirror.baseline(5, [record("t1")]);
    expect(mirror.apply(heartbeat(5))).toBe("alive");
    expect(mirror.cursor).toBe(5);
    expect(mirror.apply(heartbeat(7))).toBe("retired");
    expect(mirror.retired).toBe("heartbeat-jump");
    // Heartbeats never advance the cursor.
    expect(mirror.cursor).toBe(5);
  });

  test("missed replaces everything at its cut; older callbacks cannot undo it", () => {
    const mirror = new CoreMirror();
    mirror.baseline(1, [record("t1"), record("t2")]);
    expect(
      mirror.apply(missed(9, [record("t2", { title: "cut" }), record("t3")])),
    ).toBe("applied");
    expect(
      mirror
        .terminals()
        .map((t) => t.address)
        .sort(),
    ).toEqual(["t2", "t3"]);
    expect(mirror.apply(event(8, "title", "t2", { title: "stale" }))).toBe(
      "stale",
    );
    expect(mirror.apply(event(9, "removed", "t3", {}))).toBe("stale");
    expect(mirror.terminal("t2")?.title).toBe("cut");
    expect(mirror.apply(event(10, "removed", "t3", {}))).toBe("applied");
    expect(mirror.terminal("t3")).toBeUndefined();
  });

  test("a restarted core's baseline is accepted below the old cursor", () => {
    const before = new CoreMirror();
    before.baseline(500, [record("t4")]);
    const after = new CoreMirror();
    expect(after.baseline(0, [record("t4", { screen: "inexact" })])).toBe(true);
    expect(after.cursor).toBe(0);
    expect(after.terminal("t4")?.address).toBe("t4");
  });

  test("README apply rules: lost, finished, foreground, keep, size, turn, status", () => {
    const mirror = new CoreMirror();
    mirror.baseline(0, [
      record("t1", { foreground: { pid: 1, name: "claude" } }),
    ]);
    mirror.apply(
      event(1, "lost", "t1", {
        reason: "signaled",
        exit_code: null,
        signal: 9,
        finished_ms: null,
      }),
    );
    expect(mirror.terminal("t1")?.pid).toBeNull();
    expect(mirror.terminal("t1")?.foreground).toBeUndefined();
    expect(mirror.terminal("t1")?.state).toBe("live");
    mirror.apply(event(2, "keep", "t1", { keep: true }));
    mirror.apply(event(3, "size", "t1", { cols: 90, rows: 20 }));
    mirror.apply(event(4, "turn", "t1", { turn: 3, state: "done" }));
    mirror.apply(
      event(5, "status", "t1", {
        status: { state: "idle" },
        records: {},
        reported: true,
      }),
    );
    mirror.apply(
      event(6, "finished", "t1", {
        reason: "killed",
        exit_code: null,
        signal: 9,
        finished_ms: 5,
      }),
    );
    expect(mirror.terminal("t1")).toMatchObject({
      keep: true,
      cols: 90,
      rows: 20,
      turn: 3,
      status: { state: "idle" },
      state: "finished",
      reason: "killed",
    });
    expect(mirror.cursor).toBe(6);
  });

  test("linked machines and documents consume positions; unknown types are reported", () => {
    const mirror = new CoreMirror();
    mirror.baseline(0, []);
    expect(
      mirror.apply(event(1, "created", "rohan/t7", record("rohan/t7"))),
    ).toBe("applied");
    expect(
      mirror.apply({
        method: "event",
        params: { seq: 2, type: "doc", data: { name: "x", version: 1 } },
      }),
    ).toBe("applied");
    expect(mirror.apply(event(3, "future-fact", "rohan/t7", {}))).toBe(
      "applied",
    );
    expect(mirror.terminal("rohan/t7")?.remote).toBe(true);
    expect([...mirror.unknownEvents]).toEqual([["future-fact", 1]]);
    expect(mirror.cursor).toBe(3);
  });

  test("an event for a terminal the mirror never saw is divergence, not a guess", () => {
    const mirror = new CoreMirror();
    mirror.baseline(0, []);
    expect(mirror.apply(event(1, "title", "t9", { title: "?" }))).toBe(
      "retired",
    );
    expect(mirror.retired).toBe("divergence");
  });
});

describe("admission limits", () => {
  test("an oversized label retires without partial admission", () => {
    const mirror = new CoreMirror({
      ...DEFAULT_CORE_MIRROR_LIMITS,
      maxLabelBytes: 64,
    });
    mirror.baseline(0, [record("t1", { labels: { a: "1" } })]);
    expect(
      mirror.apply(
        event(1, "labels", "t1", { labels: { a: "x".repeat(100) } }),
      ),
    ).toBe("retired");
    expect(mirror.retired).toBe("limit");
    expect(mirror.terminal("t1")?.labels).toEqual({ a: "1" });
    expect(mirror.cursor).toBe(0);
  });

  test("a snapshot over the terminal or byte limits is refused whole", () => {
    const few = new CoreMirror({
      ...DEFAULT_CORE_MIRROR_LIMITS,
      maxTerminals: 1,
    });
    expect(few.baseline(0, [record("t1"), record("t2")])).toBe(false);
    expect(few.size).toBe(0);
    expect(few.retired).toBe("limit");
    const small = new CoreMirror({
      ...DEFAULT_CORE_MIRROR_LIMITS,
      maxMirrorBytes: 200,
    });
    expect(small.baseline(0, [record("t1"), record("t2"), record("t3")])).toBe(
      false,
    );
    expect(small.actionable).toBe(false);
  });
});

describe("occupant evidence", () => {
  test("a kept replacement changes the occupancy token even if the pid is reused", () => {
    const mirror = new CoreMirror();
    mirror.baseline(0, [record("t1", { pid: 77, argv: ["claude"] })]);
    const before = mirror.occupancy("t1");
    mirror.apply(event(1, "title", "t1", { title: "work" }));
    expect(mirror.occupancy("t1")).toBe(before);
    mirror.apply(
      event(
        2,
        "restarted",
        "t1",
        record("t1", { pid: 77, argv: ["/bin/sh"], reported: false }),
      ),
    );
    expect(mirror.occupancy("t1")).not.toBe(before);
  });

  test("reported going false and pid/argv/template changes retire the occupant", () => {
    for (const fields of [
      { reported: false },
      { pid: 101 },
      { argv: ["sh"] },
      { template: "x" },
    ]) {
      const before = new CoreMirror();
      before.baseline(0, [record("t1")]);
      const token = before.occupancy("t1");
      before.apply(missed(1, [record("t1", fields)]));
      expect(before.occupancy("t1")).not.toBe(token);
    }
  });
});
