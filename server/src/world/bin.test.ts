import { expect, test } from "bun:test";
import { BIN_DEPARTURE_MS, type BinEntry } from "../../../shared/bin";
import { BinCloseNotRecorded, WorldBinRegistry, type BinAdd } from "./bin";

function fixture(
  epoch = "run1",
  options: { failCommit?: "not-recorded" | "unknown" } = {},
) {
  let now = 0;
  const timers = new Set<{ at: number; run(): void }>();
  const committed: BinEntry[][] = [];
  const revisions: number[] = [];
  let countdown: 10 | 30 | 60 | 120 = 30;
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
    countdown: () => countdown,
    publish: (revision) => revisions.push(revision),
  });
  const advance = async (ms: number) => {
    now += ms;
    for (const timer of [...timers].sort((a, b) => a.at - b.at))
      if (timer.at <= now) {
        timers.delete(timer);
        timer.run();
      }
    await Promise.resolve();
  };
  return {
    registry,
    committed,
    revisions,
    advance,
    setCountdown: (value: typeof countdown) => {
      countdown = value;
    },
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

const TOTAL = 30_000 + BIN_DEPARTURE_MS;

test("closing a held browser during service shutdown cannot restart staging", async () => {
  const { registry, advance, committed } = fixture();
  const owner = {};
  registry.add(agent("p1"));
  registry.pause(owner);
  registry.dispose();
  registry.release(owner);
  await advance(TOTAL + 1);
  expect(committed).toEqual([]);
});

test("an open tray owns its socket hold; closing its last window resumes without resetting time", async () => {
  const { registry, advance, committed } = fixture();
  const first = {},
    second = {},
    unrelated = {};
  registry.add(agent("p1"));
  await advance(5000);
  registry.pause(first);
  await advance(60_000);
  registry.pause(second);
  registry.release(first);
  expect(registry.list()).toMatchObject({
    paused: true,
    entries: [{ remaining_ms: 31_000, trip_elapsed_ms: 5000 }],
  });
  registry.release(unrelated);
  expect(registry.list().paused).toBe(true);
  registry.release(second);
  expect(registry.list().paused).toBe(false);
  await advance(1000);
  expect(registry.list().entries[0]!.remaining_ms).toBe(30_000);
  expect(committed).toEqual([]);
  registry.pause(first);
  registry.resume();
  registry.release(first);
  expect(registry.list().paused).toBe(false);
  const id = registry.list().entries[0]!.id;
  registry.restore(id);
  registry.pause(first);
  expect(registry.add(agent("p2")).paused).toBe(false);
});

test("the close commits only when the bus has left, not when the countdown ends", async () => {
  const { registry, committed, advance } = fixture();
  const state = registry.add(agent("p1"));
  const id = state.entries[0]!.id;
  expect(id).toStartWith("bin-run1-");
  expect(state.entries[0]).toMatchObject({
    duration_ms: 30_000,
    departure_ms: BIN_DEPARTURE_MS,
    remaining_ms: TOTAL,
  });
  // The countdown ends; the bus drives away and can still be stopped.
  await advance(30_000);
  expect(committed).toEqual([]);
  expect(registry.list().entries[0]!.remaining_ms).toBe(BIN_DEPARTURE_MS);
  await advance(BIN_DEPARTURE_MS - 1);
  expect(committed).toEqual([]);
  expect(registry.list().entries[0]!.remaining_ms).toBe(1);
  await advance(1);
  expect(committed.map((batch) => batch.map((e) => e.id))).toEqual([[id]]);
  expect(registry.list().entries).toEqual([]);
  expect(registry.list().closing).toEqual([id]);
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

test("pause freezes every countdown; resume continues where it stopped", async () => {
  const { registry, committed, advance } = fixture();
  registry.add(agent("p1"));
  await advance(10_000);
  expect(registry.pause().paused).toBe(true);
  await advance(60_000);
  expect(committed).toEqual([]);
  expect(registry.list().entries[0]!.remaining_ms).toBe(TOTAL - 10_000);
  registry.resume();
  await advance(TOTAL - 10_000 - 1);
  expect(committed).toEqual([]);
  await advance(1);
  expect(committed).toHaveLength(1);
});

test("a bus held or emptied while it drives away closes nothing", async () => {
  const { registry, committed, advance } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  await advance(30_000 + BIN_DEPARTURE_MS / 2);
  registry.pause();
  await advance(120_000);
  expect(committed).toEqual([]);
  expect(registry.list().entries[0]!.remaining_ms).toBe(BIN_DEPARTURE_MS / 2);
  registry.resume();
  registry.restore(a);
  await advance(BIN_DEPARTURE_MS);
  expect(committed).toEqual([]);
  expect(registry.list().entries).toEqual([]);
});

test("put back closes nothing and an emptied bin is no longer paused", async () => {
  const { registry, committed, advance } = fixture();
  const id = registry.add(agent("p1")).entries[0]!.id;
  registry.pause();
  const state = registry.restore(id);
  expect(state.entries).toEqual([]);
  expect(state.paused).toBe(false);
  await advance(120_000);
  expect(committed).toEqual([]);
});

test("close now takes exactly the entries named", async () => {
  const { registry, committed } = fixture();
  const a = registry.add(agent("p1")).entries[0]!.id;
  const b = registry.add(agent("p2", { view: "town" })).entries[1]!.id;
  const c = registry.add(agent("p3", { view: "town", join: b })).entries[2]!.id;
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
  // The old page saw run1's entry; World restarted and run2 staged others.
  const old = fixture().registry.add(agent("p1")).entries[0]!.id;
  const { registry, committed } = fixture("run2");
  const fresh = registry.add(agent("p2")).entries[0]!.id;
  expect(fresh).toStartWith("bin-run2-");
  for (const ids of [[old], [old, fresh], [], ["all"]])
    expect(() => registry.closeNow(ids)).toThrow("nothing was closed");
  expect(committed).toEqual([]);
  expect(registry.list().entries.map((e) => e.id)).toEqual([fresh]);
});

test("boarding restarts the countdown in full for everyone on the bus", async () => {
  // Boarding at 0:11 (the bus still driving in) and at 0:01 (at the stop).
  for (const left of [11_000, 1_000]) {
    const { registry, committed, advance } = fixture();
    const bus = registry.add(agent("p1", { view: "town" })).entries[0]!;
    await advance(30_000 - left);
    const state = registry.add(agent("p2", { view: "town", join: bus.id }));
    const [first, second] = state.entries;
    expect(second!.trip).toBe(bus.trip);
    for (const entry of [first!, second!])
      expect(entry).toMatchObject({ duration_ms: 30_000, remaining_ms: TOTAL });
    // The first agent's old deadline passes without a close.
    await advance(left + BIN_DEPARTURE_MS);
    expect(committed).toEqual([]);
    // Both leave together on the new clock.
    await advance(TOTAL - left - BIN_DEPARTURE_MS);
    expect(committed.map((batch) => batch.map((e) => e.pane_id))).toEqual([
      ["p1", "p2"],
    ]);
  }
});

test("drops from Board, Desk and Town reset the shared clock without a join hint", async () => {
  for (const view of ["board", "desk", "town"] as const) {
    const { registry, advance, committed } = fixture();
    const first = registry.add(agent("p1", { view: "town" })).entries[0]!;
    await advance(29_000);
    const entries = registry.add(agent("p2", { view })).entries;
    expect(entries.map((entry) => entry.trip)).toEqual([
      first.trip,
      first.trip,
    ]);
    expect(entries.map((entry) => entry.remaining_ms)).toEqual([TOTAL, TOTAL]);
    await advance(7_000);
    expect(committed).toEqual([]);
  }
});

test("the original trip clock survives boarding, holds and new observers", async () => {
  const { registry, advance } = fixture();
  registry.add(agent("p1", { view: "town" }));
  await advance(19_000);
  const reset = registry.add(agent("p2", { view: "board" }));
  for (const entry of reset.entries)
    expect(entry).toMatchObject({
      trip_duration_ms: 30_000,
      trip_elapsed_ms: 19_000,
    });
  registry.pause();
  await advance(60_000);
  expect(registry.list().entries.map((entry) => entry.trip_elapsed_ms)).toEqual(
    [19_000, 19_000],
  );
  registry.resume();
  await advance(1_000);
  expect(registry.list().entries.map((entry) => entry.trip_elapsed_ms)).toEqual(
    [20_000, 20_000],
  );
});

test("closing and uncertain entries retain qualified pin reservations", () => {
  const { registry } = fixture();
  const first = registry.add(agent("p1")).entries[0]!;
  registry.closeNow([first.id]);
  expect(registry.list().entries).toEqual([]);
  expect(registry.list().reservations).toEqual([
    expect.objectContaining({
      id: first.id,
      pane_id: "p1",
      terminal_id: "term-p1",
      connection_id: "studio",
      connection_generation: 3,
    }),
  ]);
  registry.settle(first.id, { result: "uncertain", closed_tab: false });
  expect(registry.list().reservations).toHaveLength(1);
});

test("once the bus has pulled away, a later agent waits for the next one", async () => {
  const { registry, committed, advance } = fixture();
  const bus = registry.add(agent("p1", { view: "town" })).entries[0]!;
  await advance(30_000 + 1);
  const late = registry
    .add(agent("p2", { view: "town", join: bus.id }))
    .entries.find((e) => e.pane_id === "p2")!;
  expect(late.trip).toBe(late.id);
  expect(late.remaining_ms).toBe(TOTAL);
  // The leaving bus keeps its own clock: p1 closes on time, p2 later.
  await advance(BIN_DEPARTURE_MS);
  expect(committed.flat().map((e) => e.pane_id)).toEqual(["p1"]);
});

test("boarding a held bus restarts its countdown and keeps it held", () => {
  const { registry } = fixture();
  const bus = registry.add(agent("p1", { view: "town" })).entries[0]!;
  registry.pause();
  const state = registry.add(agent("p2", { view: "town", join: bus.id }));
  expect(state.paused).toBe(true);
  expect(state.entries.map((e) => e.remaining_ms)).toEqual([TOTAL, TOTAL]);
});

test("the same pane is never staged twice and the setting sets new countdowns", () => {
  const { registry, setCountdown } = fixture();
  registry.add(agent("p1"));
  expect(registry.add(agent("p1")).entries).toHaveLength(1);
  setCountdown(10);
  const state = registry.add(agent("p2"));
  expect(state.countdown_s).toBe(10);
  expect(state.entries.find((e) => e.pane_id === "p2")!.duration_ms).toBe(
    10_000,
  );
});

test("a host's new runtime returns its staged agents without closing them", async () => {
  const { registry, committed, advance } = fixture();
  registry.add(agent("p1"));
  registry.add(agent("p2", { connection_id: "other" }));
  registry.retireConnectionGeneration("studio", 3);
  expect(registry.list().entries).toHaveLength(2);
  registry.retireConnectionGeneration("studio", 4);
  const state = registry.list();
  expect(state.entries.map((e) => e.connection_id)).toEqual(["other"]);
  expect(state.outcomes[0]).toMatchObject({ result: "gone" });
  await advance(TOTAL);
  expect(committed.flat().map((e) => e.connection_id)).toEqual(["other"]);
});

test("a close that could not be recorded is reported as not sent", async () => {
  const { registry, advance } = fixture("run1", {
    failCommit: "not-recorded",
  });
  registry.add(agent("p1"));
  await advance(TOTAL);
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
  await advance(TOTAL);
  await Promise.resolve();
  const state = registry.list();
  expect(state.closing).toEqual([id]);
  expect(state.outcomes).toEqual([]);
});

test("invalid targets are refused before anything is staged", () => {
  const { registry } = fixture();
  expect(() => registry.add(agent("", {}))).toThrow("invalid bin target");
  expect(() =>
    registry.add(agent("p1", { connection_generation: -1 })),
  ).toThrow("invalid bin target");
  expect(registry.list().entries).toEqual([]);
});
