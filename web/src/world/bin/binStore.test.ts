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
