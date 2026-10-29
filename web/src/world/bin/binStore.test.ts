import { afterEach, expect, test } from "bun:test";
import type { BinState } from "../../../../shared/bin";
import {
  closeFromBin,
  configureBinClient,
  onBinOutcome,
  pauseBin,
  refreshBin,
  resetBinStore,
} from "./binStore";

const entry = (id: string, pane: string) => ({
  id,
  connection_id: "local",
  connection_generation: 1,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: pane,
  terminal_id: `term-${pane}`,
  label: `agent ${pane}`,
  view: "board" as const,
  duration_ms: 30_000,
  remaining_ms: 20_000,
});

/** A service whose state the test sets, recording each call. */
function service(initial: BinState) {
  let current = initial;
  const calls: [string, Record<string, unknown> | undefined][] = [];
  const replies: (() => Promise<unknown>)[] = [];
  configureBinClient({
    call: (method, params) => {
      calls.push([method, params]);
      return replies.shift()?.() ?? Promise.resolve(structuredClone(current));
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  return {
    calls,
    replies,
    set: (next: BinState) => (current = next),
  };
}

afterEach(() => {
  configureBinClient(null);
  resetBinStore();
});

test("a restarted service's state replaces the old run's, whatever its revision", async () => {
  const heard: string[] = [];
  const off = onBinOutcome((outcome) => heard.push(outcome.label));
  const herdr = service({
    epoch: "run1",
    revision: 5,
    paused: true,
    entries: [entry("bin-run1-1", "p1")],
    outcomes: [],
  });
  await refreshBin();
  // The service restarts: revision 1, and a different agent in the bin.
  herdr.set({
    epoch: "run2",
    revision: 1,
    paused: false,
    entries: [entry("bin-run2-1", "p2")],
    outcomes: [
      {
        id: "bin-run2-0",
        label: "agent p3",
        view: "board",
        result: "closed",
        closed_tab: false,
      },
    ],
  });
  const now = await pauseBin();
  expect(now.epoch).toBe("run2");
  expect(now.entries.map((item) => item.pane_id)).toEqual(["p2"]);
  expect(heard).toEqual(["agent p3"]);
  off();
});

test("a late reply from the old run never comes back", async () => {
  const herdr = service({
    epoch: "run1",
    revision: 9,
    paused: false,
    entries: [entry("bin-run1-1", "p1")],
    outcomes: [],
  });
  await refreshBin();
  herdr.set({
    epoch: "run2",
    revision: 1,
    paused: false,
    entries: [],
    outcomes: [],
  });
  await refreshBin();
  herdr.replies.push(async () => ({
    epoch: "run1",
    revision: 10,
    paused: false,
    entries: [entry("bin-run1-1", "p1")],
    outcomes: [],
  }));
  const now = await closeFromBin("bin-run1-1");
  expect(now.epoch).toBe("run2");
  expect(now.entries).toEqual([]);
  // A stale row names its own run, so it can never close another agent.
  expect(herdr.calls[herdr.calls.length - 1]).toEqual([
    "world.bin.close_now",
    { id: "bin-run1-1" },
  ]);
});
