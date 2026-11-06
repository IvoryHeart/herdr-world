import { expect, test } from "bun:test";
import {
  BIN_BUS_INTERVAL_MS,
  BIN_BUS_DRIVE_MS,
  type BinEntry,
} from "../../../shared/bin";
import { WorldBinRegistry, type BinAdd } from "./bin";

function fixture(epoch = "run") {
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const committed: BinEntry[][] = [];
  const registry = new WorldBinRegistry({
    epoch,
    scheduled: true,
    clock: { now: () => now, monotonic: () => now },
    scheduler: {
      schedule(run, delay) {
        const timer = { at: now + delay, run };
        timers.add(timer);
        return { cancel: () => timers.delete(timer) };
      },
    },
    countdown: () => 30,
    commit: async (entries) => {
      committed.push([...entries]);
    },
    publish() {},
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].sort((a, b) => a.at - b.at)[0];
      if (!next || next.at > end) break;
      now = next.at;
      timers.delete(next);
      next.run();
    }
    now = end;
  };
  return {
    registry,
    committed,
    advance,
    wakeLate(ms: number) {
      now += ms;
      const timer = [...timers].sort((a, b) => a.at - b.at)[0]!;
      timers.delete(timer);
      timer.run();
    },
  };
}
const agent = (pane: string): BinAdd => ({
  connection_id: "example",
  connection_generation: 1,
  workspace_id: "room",
  tab_id: "tab",
  pane_id: pane,
  terminal_id: `terminal-${pane}`,
  label: pane,
  view: "town",
});

test("holds share the fixed bus, board together, and close only after it leaves", () => {
  const f = fixture();
  f.registry.add(agent("a"));
  f.advance(60_000);
  f.registry.add(agent("b"));
  expect(f.committed).toEqual([]);
  expect(f.registry.list().bus?.remaining_ms).toBe(
    BIN_BUS_INTERVAL_MS - 60_000,
  );
  f.advance(BIN_BUS_INTERVAL_MS - 60_000);
  expect(f.registry.list().entries.every((e) => e.boarded)).toBe(true);
  expect(f.committed).toEqual([]);
  f.advance(BIN_BUS_DRIVE_MS);
  expect(f.committed[0]?.map((e) => e.pane_id)).toEqual(["a", "b"]);
  expect(f.registry.list().closing_entries?.map((e) => e.pane_id)).toEqual([
    "a",
    "b",
  ]);
});

test("Put back is reversible until boarding; opening a tray never pauses the schedule", () => {
  const f = fixture();
  const a = f.registry.add(agent("a")).entries[0]!;
  f.registry.restore(a.id);
  const b = f.registry.add(agent("b")).entries[0]!;
  f.registry.pause();
  f.advance(BIN_BUS_INTERVAL_MS);
  expect(f.registry.restore(b.id).entries).toHaveLength(1);
  f.advance(BIN_BUS_DRIVE_MS);
  expect(f.committed.flat().map((e) => e.pane_id)).toEqual(["b"]);
});

test("an agent binned during a route waits for the next scheduled bus", () => {
  const f = fixture();
  f.advance(BIN_BUS_INTERVAL_MS);
  f.registry.add(agent("late"));
  f.advance(BIN_BUS_DRIVE_MS);
  expect(f.committed).toEqual([]);
  expect(f.registry.list().entries[0]?.boarded).toBe(false);
  f.advance(BIN_BUS_INTERVAL_MS - BIN_BUS_DRIVE_MS);
  f.advance(BIN_BUS_DRIVE_MS);
  expect(f.committed.flat().map((e) => e.pane_id)).toEqual(["late"]);
});

test("restart forgets holds and a retired generation never boards", () => {
  const f = fixture();
  f.registry.add(agent("old"));
  f.registry.retireConnectionGeneration("example", 2);
  f.advance(BIN_BUS_INTERVAL_MS + BIN_BUS_DRIVE_MS);
  expect(f.committed).toEqual([]);
  f.registry.add(agent("held"));
  f.registry.dispose();
  const restarted = fixture("new-run");
  restarted.advance(BIN_BUS_INTERVAL_MS * 2);
  expect(restarted.committed).toEqual([]);
});

test("a delayed wake gives the bus its drive, then returns to the fixed schedule", () => {
  const f = fixture();
  f.registry.add(agent("a"));
  f.wakeLate(BIN_BUS_INTERVAL_MS + 10_000);
  expect(f.committed).toEqual([]);
  f.advance(BIN_BUS_DRIVE_MS);
  expect(f.committed).toHaveLength(1);
  expect(f.registry.list().bus?.remaining_ms).toBe(
    BIN_BUS_INTERVAL_MS - BIN_BUS_DRIVE_MS - 10_000,
  );
});
