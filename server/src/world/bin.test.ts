import { expect, test } from "bun:test";
import type { BinEntry } from "../../../shared/bin";
import {
  BinCloseNotRecorded,
  ENDED_BEFORE_BUS,
  WorldBinRegistry,
  type BinAdd,
} from "./bin";

function fixture(
  epoch = "run1",
  options: {
    failCommit?: "not-recorded" | "unknown";
    /** The trip's length for a route; a fixed 10 s unless given. */
    trip_ms?: (route_m: number, stops: number) => number;
  } = {},
) {
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const committed: BinEntry[][] = [];
  const revisions: number[] = [];
  const journal: string[] = [];
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
    info: (message) => journal.push(message),
    boarding_ms: 60_000,
    trip_ms: options.trip_ms ?? (() => 10_000),
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
    journal,
    advance,
    timers,
    /** The wall clock now, as a pane list's read time. */
    wall: () => 1_000_000 + now,
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

test("holding closes nothing until the bus that takes it is back", async () => {
  const { registry, committed, advance } = fixture();
  await advance(20_000);
  // Nobody waits: no bus is due.
  expect(registry.list().bus.next_ms).toBeNull();
  const state = registry.add(agent("p1"));
  const id = state.entries[0]!.id;
  expect(id).toStartWith("bin-run1-");
  expect(state.entries[0]).toMatchObject({
    riding: false,
    route_m: null,
    stop: null,
  });
  // The bus sets off a minute after the first agent starts waiting.
  expect(state.bus).toEqual({
    speed_kmh: 36,
    route_m: 0,
    trip_ms: 0,
    elapsed_ms: null,
    stopped: false,
    trip: null,
    next_ms: 60_000,
    next_route_m: 500,
    next_trip_ms: 10_000,
  });
  await advance(20_000);
  expect(registry.list().bus.next_ms).toBe(40_000);
  await advance(39_999);
  expect(registry.list().entries[0]!.riding).toBe(false);
  await advance(1);
  expect(registry.list().entries[0]!.riding).toBe(true);
  expect(registry.list().bus).toMatchObject({
    elapsed_ms: 0,
    route_m: 500,
    trip_ms: 10_000,
    next_ms: null,
    next_trip_ms: 0,
  });
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

test("a stopped bus closes nothing until it is let go", async () => {
  const { registry, committed, advance } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  registry.add(agent("p2"));
  await advance(60_000 + 4_000);
  expect(registry.list().bus.trip).toBe(1);
  expect(registry.stopBus().bus).toMatchObject({
    stopped: true,
    elapsed_ms: 4_000,
  });
  // It stands well past the trip's end: nothing is recorded.
  await advance(60_000);
  expect(committed).toEqual([]);
  expect(registry.list().bus.elapsed_ms).toBe(4_000);
  expect(registry.restore(a).entries.map((e) => e.pane_id)).toEqual(["p2"]);
  expect(registry.list().bus.stopped).toBe(true);
  // Let go, it drives the rest of its trip from where it stood.
  expect(registry.goBus().bus).toMatchObject({
    stopped: false,
    elapsed_ms: 4_000,
  });
  await advance(5_999);
  expect(committed).toEqual([]);
  await advance(1);
  expect(ids(committed)).toEqual([["p2"]]);
});

test("a stopped bus with nobody left aboard drives on", async () => {
  const { registry, committed, advance } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  await advance(60_000);
  registry.stopBus();
  expect(registry.restore(a).bus.stopped).toBe(false);
  await advance(10_000);
  expect(committed).toEqual([]);
  expect(registry.list().bus.elapsed_ms).toBeNull();
  // With no bus out, stopping does nothing.
  expect(registry.stopBus().bus.stopped).toBe(false);
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

const pane = (id: string) => ({ pane_id: id, terminal_id: `term-${id}` });

test("an agent that ends while held leaves the bin, and no bus comes for it", async () => {
  const { registry, committed, advance, timers, wall } = fixture();
  const id = registry.add(agent("p1")).entries[0]!.id;
  await advance(1_000);
  // Its pane is still there: it waits.
  registry.observeComplete("studio", 3, [pane("p1"), pane("p2")], wall());
  expect(registry.list().entries.map((entry) => entry.id)).toEqual([id]);
  // Its pane and terminal are gone: it ended by itself.
  registry.observeComplete("studio", 3, [pane("p2")], wall());
  const state = registry.list();
  expect(state.entries).toEqual([]);
  expect(state.closing).toEqual([]);
  expect(state.outcomes).toEqual([
    {
      id,
      label: "agent p1",
      view: "board",
      result: "gone",
      closed_tab: false,
      detail: ENDED_BEFORE_BUS,
    },
  ]);
  expect(timers.size).toBe(0);
  await advance(120_000);
  expect(committed).toEqual([]);
});

test("a rider that ends on the bus leaves it, and its close is never recorded", async () => {
  const { registry, committed, advance, wall } = fixture();
  registry.add(agent("p1"));
  registry.add(agent("p2"));
  await advance(60_000);
  expect(registry.list().entries.every((entry) => entry.riding)).toBe(true);
  registry.observeComplete("studio", 3, [pane("p2")], wall());
  await advance(10_000);
  expect(ids(committed)).toEqual([["p2"]]);
  expect(registry.list().outcomes.map((outcome) => outcome.detail)).toEqual([
    ENDED_BEFORE_BUS,
  ]);
});

test("a stopped bus whose last rider ended drives on", async () => {
  const { registry, committed, advance, wall } = fixture();
  registry.add(agent("p1"));
  await advance(60_000);
  registry.stopBus();
  registry.observeComplete("studio", 3, [], wall());
  expect(registry.list().bus.stopped).toBe(false);
  await advance(10_000);
  expect(committed).toEqual([]);
  expect(registry.list().bus.elapsed_ms).toBeNull();
});

test("a stopped bus whose last rider's host restarted drives on, and later agents still close", async () => {
  const { registry, committed, advance } = fixture();
  const core = (terminal: string, connection_generation: number) =>
    agent(terminal, {
      connection_id: "core-local",
      connection_generation,
      runtime: "herdr-core",
      terminal_id: terminal,
      confirmation: {
        core_id: "c0ffee",
        terminals: [{ address: terminal, pid: 4242, occupant: "claude" }],
      },
    });
  registry.add(core("t1", 2));
  await advance(60_000);
  registry.stopBus();
  registry.retireConnectionGeneration("core-local", 3);
  expect(registry.list().bus.stopped).toBe(false);
  // The replacement runtime's agent boards the next bus and closes.
  registry.add(core("t2", 3));
  await advance(10_000);
  expect(registry.list().bus.elapsed_ms).toBeNull();
  await advance(50_000);
  expect(registry.list().entries[0]?.riding).toBe(true);
  await advance(10_000);
  expect(ids(committed)).toEqual([["t2"]]);
});

test("only a current, complete list read after the hold witnesses an end", async () => {
  const { registry, advance, wall } = fixture();
  await advance(5_000);
  const readBefore = wall();
  await advance(1);
  const id = registry.add(agent("p1")).entries[0]!.id;
  // Read before it was held: the agent may not have existed yet.
  registry.observeComplete("studio", 3, [], readBefore);
  // Another runtime of the host, or another host, says nothing about it.
  registry.observeComplete("studio", 4, [], wall() + 1);
  registry.observeComplete("garage", 3, [], wall() + 1);
  // The terminal alone, or the pane alone, keeps it.
  registry.observeComplete(
    "studio",
    3,
    [{ pane_id: "moved", terminal_id: "term-p1" }],
    wall() + 1,
  );
  registry.observeComplete("studio", 3, [{ pane_id: "p1" }], wall() + 1);
  expect(registry.list().entries.map((entry) => entry.id)).toEqual([id]);
  expect(registry.list().outcomes).toEqual([]);
});

test("a herdr-core agent killed outside World leaves the bin the same way", async () => {
  const { registry, committed, advance, wall } = fixture();
  const id = registry.add(
    agent("t8", {
      connection_id: "core-local",
      connection_generation: 2,
      runtime: "herdr-core",
      terminal_id: "t8",
      confirmation: {
        core_id: "c0ffee",
        terminals: [{ address: "t8", pid: 4242, occupant: "claude" }],
      },
    }),
  ).entries[0]!.id;
  await advance(1_000);
  registry.observeComplete("core-local", 2, [pane("t1")], wall());
  expect(registry.list().entries).toEqual([]);
  expect(registry.list().outcomes[0]).toMatchObject({ id, result: "gone" });
  await advance(120_000);
  expect(committed).toEqual([]);
});

test("the bin journals each step of the journey", async () => {
  const { registry, journal, advance, wall } = fixture();
  const first = registry.add(agent("p1")).entries[0]!.id;
  const second = registry.add(agent("p2")).entries.at(-1)!.id;
  await advance(60_000);
  registry.observeComplete("studio", 3, [pane("p2")], wall());
  await advance(10_000);
  registry.settle(second, { result: "closed", closed_tab: false });
  expect(journal).toEqual([
    `Bin holds ${first}: herdr studio generation 3 pane p1 terminal term-p1`,
    `Bin holds ${second}: herdr studio generation 3 pane p2 terminal term-p2`,
    "Bin bus 1 set off with 2 aboard: 500 m there and back, 10000 ms",
    `Bin dropped ${first}: pane p1 terminal term-p1 ended on the bus`,
    `Bin closing ${second}`,
    `Bin close of ${second}: closed`,
  ]);
});

test("a Town's route times the bus: the first measure stands, and a farther stop takes longer", async () => {
  const trips: [number, number][] = [];
  const { registry, committed, advance } = fixture("run1", {
    trip_ms: (route_m, stops) => {
      trips.push([route_m, stops]);
      return route_m * 20 + stops * 1_000;
    },
  });
  const a = registry.add(agent("p1")).entries[0]!.id;
  const b = registry.add(agent("p2")).entries.at(-1)!.id;
  // Unmeasured, each counts as its own stop on the default route.
  expect(registry.list().bus).toMatchObject({
    next_route_m: 500,
    next_trip_ms: 500 * 20 + 2_000,
  });
  const state = registry.route([
    { id: a, route_m: 300.4, stop: "stop:park" },
    { id: b, route_m: 300, stop: "stop:park" },
  ]);
  expect(state.entries.map((entry) => [entry.route_m, entry.stop])).toEqual([
    [300, "stop:park"],
    [300, "stop:park"],
  ]);
  // One stop for both now.
  expect(state.bus).toMatchObject({
    next_route_m: 300,
    next_trip_ms: 300 * 20 + 1_000,
  });
  // Another page's measure of the same agent does not move it.
  registry.route([{ id: a, route_m: 900, stop: "stop:far" }]);
  expect(registry.list().entries[0]).toMatchObject({ route_m: 300 });
  // One farther out: the trip is out to it, halting at both stops.
  const c = registry.add(agent("p3")).entries.at(-1)!.id;
  registry.route([{ id: c, route_m: 800, stop: "stop:harbour" }]);
  expect(registry.list().bus).toMatchObject({
    next_route_m: 800,
    next_trip_ms: 800 * 20 + 2_000,
  });
  await advance(60_000);
  expect(registry.list().bus).toMatchObject({
    route_m: 800,
    trip_ms: 18_000,
    elapsed_ms: 0,
  });
  // Aboard, its route is fixed.
  registry.route([{ id: c, route_m: 100, stop: "stop:near" }]);
  expect(registry.list().entries.at(-1)).toMatchObject({ route_m: 800 });
  await advance(17_999);
  expect(committed).toEqual([]);
  await advance(1);
  expect(ids(committed)).toEqual([["p1", "p2", "p3"]]);
});

test("a route report for nothing held, or out of range, changes nothing", () => {
  const { registry, revisions } = fixture();
  const id = registry.add(agent("p1")).entries[0]!.id;
  const before = revisions.length;
  registry.route([{ id: "bin-run1-missing", route_m: 100, stop: "s" }]);
  expect(revisions.length).toBe(before);
  for (const bad of [
    { id, route_m: -1, stop: "s" },
    { id, route_m: Number.NaN, stop: "s" },
    { id, route_m: 50_001, stop: "s" },
    { id, route_m: 100, stop: "" },
    { id, route_m: 100, stop: "x".repeat(129) },
  ])
    expect(() => registry.route([bad])).toThrow("invalid bin route");
  expect(registry.list().entries[0]).toMatchObject({
    route_m: null,
    stop: null,
  });
  registry.route([{ id, route_m: 100, stop: "s" }]);
  expect(revisions.length).toBe(before + 1);
});

test("the next bus waits for the one out to come back", async () => {
  const { registry, advance } = fixture("run1", {
    trip_ms: () => 90_000,
  });
  registry.add(agent("p1"));
  await advance(60_000);
  await advance(5_000);
  registry.add(agent("p2"));
  // Its minute's wait ends at 125 s, but the bus is out until 150 s.
  expect(registry.list().bus.next_ms).toBe(85_000);
  const p2 = () =>
    registry.list().entries.find((entry) => entry.pane_id === "p2")!;
  await advance(84_999);
  expect(p2().riding).toBe(false);
  await advance(1);
  expect(p2().riding).toBe(true);
  expect(registry.list().bus.trip).toBe(2);
});
