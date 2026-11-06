import { expect, test } from "bun:test";
import type { BinEntry } from "../../../shared/bin";
import { BinCloseNotRecorded, WorldBinRegistry, type BinAdd } from "./bin";

function fixture(
  epoch = "run1",
  options: { failCommit?: "not-recorded" | "unknown" } = {},
) {
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const committed: BinEntry[][] = [];
  const revisions: number[] = [];
  const registry = new WorldBinRegistry({
    epoch,
    clock: { now: () => 1_000_000 + now, monotonic: () => now },
    scheduler: {
      schedule(run, delay) {
        const timer = { at: now + delay, run };
        timers.add(timer);
        return { cancel: () => timers.delete(timer) };
      },
    },
    commit: async (entries) => {
      committed.push([...entries]);
      if (options.failCommit === "not-recorded")
        throw new BinCloseNotRecorded("World storage is closing");
      if (options.failCommit === "unknown") throw new Error("reply lost");
    },
    publish: (revision) => revisions.push(revision),
    interval_ms: 60_000,
    trip_ms: 10_000,
  });
  /** Runs every timer due by then, in order, including those they schedule. */
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...timers]
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = Math.max(now, due.at);
      timers.delete(due);
      due.run();
    }
    now = end;
    await Promise.resolve();
  };
  return {
    registry,
    committed,
    revisions,
    advance,
    timers,
  };
}

const agent = (pane: string, extra: Partial<BinAdd> = {}): BinAdd => ({
  connection_id: "studio",
  connection_generation: 3,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: pane,
  terminal_id: `term-${pane}`,
  label: `agent ${pane}`,
  view: "board",
  ...extra,
});

const ids = (batches: BinEntry[][]) =>
  batches.map((batch) => batch.map((entry) => entry.pane_id));

test("holding closes nothing until the scheduled bus leaves the map", async () => {
  const { registry, committed, advance } = fixture();
  await advance(20_000);
  const state = registry.add(agent("p1"));
  const id = state.entries[0]!.id;
  expect(id).toStartWith("bin-run1-");
  expect(state.entries[0]!.riding).toBe(false);
  // The schedule is fixed from the service's start, not from the add.
  expect(state.bus).toEqual({
    interval_ms: 60_000,
    trip_ms: 10_000,
    next_ms: 40_000,
    elapsed_ms: null,
  });
  await advance(39_999);
  expect(registry.list().entries[0]!.riding).toBe(false);
  await advance(1);
  expect(registry.list().entries[0]!.riding).toBe(true);
  expect(registry.list().bus.elapsed_ms).toBe(0);
  await advance(9_999);
  expect(committed).toEqual([]);
  await advance(1);
  expect(ids(committed)).toEqual([["p1"]]);
  const left = registry.list();
  expect(left.entries).toEqual([]);
  expect(left.closing.map((entry) => entry.id)).toEqual([id]);
  expect(left.bus.elapsed_ms).toBeNull();
  registry.settle(id, { result: "closed", closed_tab: true });
  expect(registry.list().closing).toEqual([]);
  expect(registry.list().outcomes).toEqual([
    {
      id,
      label: "agent p1",
      view: "board",
      result: "closed",
      closed_tab: true,
    },
  ]);
});

test("one bus takes everyone waiting; a later agent waits for the next one", async () => {
  const { registry, committed, advance } = fixture();
  registry.add(agent("p1"));
  await advance(30_000);
  registry.add(agent("p2"));
  await advance(30_000);
  // The bus is out: p3 waits at its stop for the next departure.
  registry.add(agent("p3"));
  expect(
    registry.list().entries.map((entry) => [entry.pane_id, entry.riding]),
  ).toEqual([
    ["p1", true],
    ["p2", true],
    ["p3", false],
  ]);
  await advance(10_000);
  expect(ids(committed)).toEqual([["p1", "p2"]]);
  expect(registry.list().bus.next_ms).toBe(50_000);
  await advance(60_000);
  expect(ids(committed)).toEqual([["p1", "p2"], ["p3"]]);
});

test("no bus sets off for an empty bin, and no timer waits for one", async () => {
  const { registry, committed, advance, timers } = fixture();
  expect(timers.size).toBe(0);
  const id = registry.add(agent("p1")).entries[0]!.id;
  expect(timers.size).toBe(1);
  registry.restore(id);
  expect(timers.size).toBe(0);
  await advance(120_000);
  expect(committed).toEqual([]);
  expect(registry.list().bus.elapsed_ms).toBeNull();
});

test("put back works until the bus has left the map", async () => {
  const { registry, committed, advance } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  expect(registry.restore(a).entries).toEqual([]);
  const b = registry.add(agent("p2")).entries[0]!.id;
  const c = registry.add(agent("p3")).entries[1]!.id;
  await advance(60_000);
  // The bus is out: Town may still show it waiting at a later stop.
  expect(registry.list().entries.every((entry) => entry.riding)).toBe(true);
  expect(registry.restore(b).entries.map((entry) => entry.id)).toEqual([c]);
  await advance(10_000);
  expect(ids(committed)).toEqual([["p3"]]);
  // Once it has left, the close is recorded and Put back does nothing.
  expect(registry.restore(c).closing.map((entry) => entry.id)).toEqual([c]);
});

test("close now takes exactly the entries named", async () => {
  const { registry, committed } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  const b = registry.add(agent("p2", { view: "town" })).entries[1]!.id;
  const c = registry.add(agent("p3", { view: "town" })).entries[2]!.id;
  registry.add(agent("p4"));
  registry.closeNow([a]);
  expect(committed.at(-1)!.map((e) => e.pane_id)).toEqual(["p1"]);
  registry.closeNow([b, c]);
  expect(committed.at(-1)!.map((e) => e.pane_id)).toEqual(["p2", "p3"]);
  const before = registry.list().revision;
  registry.closeNow([a]);
  expect(registry.list().revision).toBe(before);
  expect(registry.list().entries.map((e) => e.pane_id)).toEqual(["p4"]);
});

test("close now from a page showing an earlier service run closes nothing", async () => {
  // The old page saw run1's entry; World restarted and run2 held others.
  const old = fixture().registry.add(agent("p1")).entries[0]!.id;
  const { registry, committed } = fixture("run2");
  const fresh = registry.add(agent("p2")).entries[0]!.id;
  expect(fresh).toStartWith("bin-run2-");
  for (const ids of [[old], [old, fresh], [], ["all"]])
    expect(() => registry.closeNow(ids)).toThrow("nothing was closed");
  expect(committed).toEqual([]);
  expect(registry.list().entries.map((e) => e.id)).toEqual([fresh]);
});

test("a World restart drops held agents and riders without closing them", async () => {
  const first = fixture();
  first.registry.add(agent("p1"));
  await first.advance(60_000);
  expect(first.registry.list().entries[0]!.riding).toBe(true);
  // The run ends mid-trip: nothing was committed, and a new run starts empty.
  first.registry.dispose();
  await first.advance(60_000);
  expect(first.committed).toEqual([]);
  const next = fixture("run2");
  expect(next.registry.list().entries).toEqual([]);
});

test("the same pane is never held twice", () => {
  const { registry } = fixture();
  registry.add(agent("p1"));
  expect(registry.add(agent("p1")).entries).toHaveLength(1);
  expect(registry.holds(agent("p1"))("p1")).toBe(true);
  expect(registry.holds(agent("p1", { connection_generation: 4 }))("p1")).toBe(
    false,
  );
});

test("a host's new runtime returns its held agents without closing them", async () => {
  const { registry, committed, advance } = fixture();
  registry.add(agent("p1"));
  registry.add(agent("p2", { connection_id: "other" }));
  registry.retireConnectionGeneration("studio", 3);
  expect(registry.list().entries).toHaveLength(2);
  registry.retireConnectionGeneration("studio", 4);
  const state = registry.list();
  expect(state.entries.map((e) => e.connection_id)).toEqual(["other"]);
  expect(state.outcomes[0]).toMatchObject({ result: "gone" });
  await advance(70_000);
  expect(committed.flat().map((e) => e.connection_id)).toEqual(["other"]);
});

test("a close that could not be recorded is reported as not sent", async () => {
  const { registry, advance } = fixture("run1", {
    failCommit: "not-recorded",
  });
  registry.add(agent("p1"));
  await advance(70_000);
  await Promise.resolve();
  const state = registry.list();
  expect(state.closing).toEqual([]);
  expect(state.outcomes[0]).toMatchObject({
    result: "refused",
    detail: "World could not record the close, so nothing was sent.",
  });
});

test("a close whose recording is unknown stays closing, never reported unrecorded", async () => {
  const { registry, advance } = fixture("run1", { failCommit: "unknown" });
  const id = registry.add(agent("p1")).entries[0]!.id;
  await advance(70_000);
  await Promise.resolve();
  const state = registry.list();
  expect(state.closing.map((entry) => entry.id)).toEqual([id]);
  expect(state.outcomes).toEqual([]);
});

test("a pinned tab is carried to the close", () => {
  const { registry } = fixture();
  const state = registry.add(agent("p1", { preserve_tab: true }));
  expect(state.entries[0]!.preserve_tab).toBe(true);
  expect(registry.add(agent("p2")).entries[1]!.preserve_tab).toBe(false);
});

test("invalid targets are refused before anything is staged", () => {
  const { registry } = fixture();
  expect(() => registry.add(agent("", {}))).toThrow("invalid bin target");
  expect(() =>
    registry.add(agent("p1", { connection_generation: -1 })),
  ).toThrow("invalid bin target");
  expect(registry.list().entries).toEqual([]);
});
