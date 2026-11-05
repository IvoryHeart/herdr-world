import { expect, test } from "bun:test";
import type { BinOutcome } from "../../../../shared/bin";
import { WorldBinStore } from "./binStore";

const entry = (id: string, pane = "p1") => ({
  id,
  connection_id: "studio",
  connection_generation: 1,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: pane,
  terminal_id: `term-${pane}`,
  label: "Example",
  view: "board",
  duration_ms: 30_000,
  remaining_ms: 20_000,
  trip: id,
});
const state = (epoch: string, revision: number, extra = {}) => ({
  epoch,
  revision,
  paused: false,
  entries: [],
  closing: [],
  outcomes: [],
  countdown_s: 30,
  ...extra,
});

function fixture() {
  let now = 1000;
  const calls: string[] = [];
  const replies = new Map<string, unknown>();
  const store = new WorldBinStore(
    {
      call: async (method) => {
        calls.push(method);
        return replies.get(method);
      },
      onControl: () => () => {},
      onStatus: () => () => {},
    },
    () => now,
  );
  const heard: BinOutcome[] = [];
  store.onOutcome((o) => heard.push(o));
  return {
    store,
    calls,
    replies,
    heard,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test("within one run an older revision never replaces a newer one", () => {
  const { store } = fixture();
  store.accept(state("run1", 5, { entries: [entry("bin-run1-1")] }));
  store.accept(state("run1", 4));
  expect(store.get().entries.map((e) => e.id)).toEqual(["bin-run1-1"]);
});

test("I1/R5: pending admission and a fresh observer retain qualified closing targets", async () => {
  const reply = Promise.withResolvers<unknown>();
  const client = {
    call: () => reply.promise,
    onControl: () => () => {},
    onStatus: () => () => {},
  };
  const store = new WorldBinStore(client);
  store.accept(state("run1", 1));
  const target = entry("bin-run1-1");
  const pending = store.add({
    connection_id: target.connection_id,
    connection_generation: 1,
    workspace_id: "w1",
    tab_id: "t1",
    pane_id: "p1",
    terminal_id: "term-p1",
    label: "Example",
    view: "board",
  });
  expect(store.reservedTargets()).toEqual([
    expect.objectContaining({ pane_id: "p1", terminal_id: "term-p1" }),
  ]);
  reply.resolve(
    state("run1", 2, { entries: [target], reservations: [target] }),
  );
  await pending;
  const closing = state("run1", 3, {
    closing: [target.id],
    reservations: [target],
  });
  store.accept(closing);
  expect(store.activeTargets().map((entry) => entry.pane_id)).toEqual(["p1"]);
  const observer = new WorldBinStore(client);
  observer.accept(closing);
  expect(observer.reservedTargets()).toEqual([
    expect.objectContaining({ pane_id: "p1", terminal_id: "term-p1" }),
  ]);
});

test("a new service run replaces the state whatever its revision", () => {
  const { store, heard } = fixture();
  store.accept(state("run1", 5, { entries: [entry("bin-run1-1")] }));
  const outcome = {
    id: "bin-run2-1",
    label: "Example",
    view: "board",
    result: "closed",
    closed_tab: false,
  };
  store.accept(state("run2", 1, { outcomes: [outcome] }));
  expect(store.get().epoch).toBe("run2");
  expect(store.get().entries).toEqual([]);
  // The page was showing the bin, so the new run's result is announced.
  expect(heard.map((o) => o.id)).toEqual(["bin-run2-1"]);
});

test("results are announced once, and not at a page's first load", () => {
  const { store, heard } = fixture();
  const old = {
    id: "bin-run1-1",
    label: "Old",
    view: "board",
    result: "closed",
    closed_tab: false,
  };
  store.accept(state("run1", 3, { outcomes: [old] }));
  expect(heard).toEqual([]);
  const next = { ...old, id: "bin-run1-2", label: "New" };
  store.accept(state("run1", 4, { outcomes: [old, next] }));
  store.accept(state("run1", 5, { outcomes: [old, next] }));
  expect(heard.map((o) => o.label)).toEqual(["New"]);
});

test("rolling outcome snapshots retain only the current dedup window without replaying notifications", () => {
  const { store, heard } = fixture();
  const outcome = (index: number): BinOutcome => ({
    id: `bin-run1-${index}`,
    label: `Example ${index}`,
    view: "board",
    result: "closed",
    closed_tab: false,
  });
  const initial = state("run1", 12, {
    outcomes: Array.from({ length: 12 }, (_, i) => outcome(i)),
  });
  store.accept(initial);
  store.accept(initial);
  expect(heard).toEqual([]);
  for (let index = 12; index < 10_000; index++) {
    const snapshot = state("run1", index + 1, {
      outcomes: Array.from({ length: 12 }, (_, i) => outcome(index - 11 + i)),
    });
    store.accept(snapshot);
    store.accept(snapshot);
  }
  expect(store.get().outcomes).toHaveLength(12);
  expect(heard).toHaveLength(10_000 - 12);
  expect(new Set(heard.map((o) => o.id)).size).toBe(heard.length);
  // Directly check the reported retention bound without adding a public
  // production API for inspecting this private resource.
  const retained = (store as unknown as { seen: ReadonlySet<string> }).seen;
  expect(retained.size).toBeLessThanOrEqual(store.get().outcomes.length);
  const latest = store.get();
  store.accept(initial);
  expect(store.get()).toBe(latest);
  expect(heard).toHaveLength(10_000 - 12);
});

test("time left runs from the read, and stops while the bin is paused", () => {
  const { store, advance } = fixture();
  store.accept(state("run1", 1, { entries: [entry("bin-run1-1")] }));
  advance(5000);
  expect(store.remaining(store.get().entries[0]!)).toBe(15_000);
  store.accept(
    state("run1", 2, { paused: true, entries: [entry("bin-run1-1")] }),
  );
  advance(5000);
  expect(store.remaining(store.get().entries[0]!)).toBe(20_000);
});

test("the browser retains an observed join time and defaults an older service to zero", () => {
  const { store, advance } = fixture();
  store.accept(
    state("run1", 1, {
      entries: [
        entry("bin-run1-1"),
        { ...entry("bin-run1-2", "p2"), trip_joined_ms: 19_000 },
      ],
    }),
  );
  advance(10_000);
  expect(store.get().entries.map((e) => e.trip_joined_ms)).toEqual([0, 19_000]);
});

test("a refused mutation keeps the state and reports the reason", async () => {
  const { store } = fixture();
  store.accept(state("run1", 1));
  const failing = new WorldBinStore({
    call: async () => {
      throw new Error("Unpin this tab before closing it");
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  await expect(failing.restore("x")).rejects.toThrow("Unpin");
  expect(failing.get().error).toBe("Unpin this tab before closing it");
});
