import { describe, expect, test } from "bun:test";
import type { BinEntry } from "../../../shared/bin";
import { MIN_JOIN_MS, WorldBinRegistry, type BinClock } from "./bin";
import { closeBinEntry } from "./bin-close";

function fakeClock() {
  let now = 1_000;
  let timer: { run: () => void; at: number } | null = null;
  const clock: BinClock = {
    now: () => now,
    setTimer: (run, ms) => (timer = { run, at: now + ms }),
    clearTimer: (value) => {
      if (timer === value) timer = null;
    },
  };
  return {
    clock,
    advance(ms: number) {
      now += ms;
      while (timer && timer.at <= now) {
        const due = timer;
        timer = null;
        due.run();
      }
    },
    pending: () => timer !== null,
  };
}

const target = (pane: string, generation = 1) => ({
  connection_id: "local",
  connection_generation: generation,
  workspace_id: "w1",
  tab_id: "t1",
  pane_id: pane,
  terminal_id: `term-${pane}`,
  label: `agent ${pane}`,
  view: "board" as const,
});

function setup() {
  const time = fakeClock();
  const closed: BinEntry[] = [];
  const published: number[] = [];
  const bin = new WorldBinRegistry(
    async (entry) => {
      closed.push(entry);
      return { result: "closed", closed_tab: true };
    },
    (revision) => published.push(revision),
    time.clock,
  );
  return { bin, time, closed, published };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("WorldBinRegistry", () => {
  test("nothing closes before the countdown ends, then exactly one close", async () => {
    const { bin, time, closed } = setup();
    bin.add(target("p1"), 30_000);
    time.advance(29_999);
    await settle();
    expect(closed).toHaveLength(0);
    expect(bin.list().entries[0]?.remaining_ms).toBe(1);
    time.advance(1);
    await settle();
    expect(closed.map((entry) => entry.pane_id)).toEqual(["p1"]);
    expect(bin.list().entries).toHaveLength(0);
    expect(bin.list().outcomes.at(-1)).toMatchObject({
      result: "closed",
      label: "agent p1",
    });
  });

  test("each agent keeps its own timer, and adding the same pane twice keeps the first", async () => {
    const { bin, time, closed } = setup();
    bin.add(target("p1"), 10_000);
    time.advance(5_000);
    bin.add(target("p2"), 10_000);
    bin.add(target("p1"), 10_000);
    expect(bin.list().entries.map((entry) => entry.remaining_ms)).toEqual([
      5_000, 10_000,
    ]);
    time.advance(5_000);
    await settle();
    expect(closed.map((entry) => entry.pane_id)).toEqual(["p1"]);
  });

  test("pausing stops every timer until resumed", async () => {
    const { bin, time, closed } = setup();
    bin.add(target("p1"), 10_000);
    time.advance(4_000);
    bin.pause();
    time.advance(60_000);
    await settle();
    expect(closed).toHaveLength(0);
    expect(bin.list()).toMatchObject({ paused: true });
    expect(bin.list().entries[0]?.remaining_ms).toBe(6_000);
    bin.resume();
    time.advance(6_000);
    await settle();
    expect(closed).toHaveLength(1);
  });

  test("restore takes an agent out without closing it and unpauses an empty bin", async () => {
    const { bin, time, closed } = setup();
    const id = bin.add(target("p1"), 10_000).entries[0]!.id;
    bin.pause();
    bin.restore(id);
    expect(bin.list()).toMatchObject({ paused: false, entries: [] });
    time.advance(20_000);
    await settle();
    expect(closed).toHaveLength(0);
    expect(time.pending()).toBe(false);
  });

  test("close now closes one or all at once", async () => {
    const { bin, closed } = setup();
    const first = bin.add(target("p1"), 30_000).entries[0]!.id;
    bin.add(target("p2"), 30_000);
    bin.add(target("p3"), 30_000);
    bin.closeNow(first);
    await settle();
    expect(closed.map((entry) => entry.pane_id)).toEqual(["p1"]);
    bin.closeNow("all");
    await settle();
    expect(closed.map((entry) => entry.pane_id).sort()).toEqual([
      "p1",
      "p2",
      "p3",
    ]);
  });

  test("a later agent joins the bus while it has time left, else waits for the next", async () => {
    const { bin, time } = setup();
    const bus = bin.add({ ...target("p1"), view: "town" }, 30_000).entries[0]!
      .id;
    time.advance(10_000);
    bin.add({ ...target("p2"), view: "town", join: bus }, 30_000);
    expect(bin.list().entries.map((entry) => entry.remaining_ms)).toEqual([
      20_000, 20_000,
    ]);
    time.advance(20_000 - MIN_JOIN_MS + 1);
    bin.add({ ...target("p3"), view: "town", join: bus }, 30_000);
    expect(bin.list().entries.at(-1)?.remaining_ms).toBe(30_000);
  });

  test("a new runtime generation retires old entries without closing them", async () => {
    const { bin, time, closed } = setup();
    bin.add(target("p1", 1), 10_000);
    bin.add(target("p2", 2), 10_000);
    bin.retireConnectionGeneration("local", 2);
    expect(bin.list().entries.map((entry) => entry.pane_id)).toEqual(["p2"]);
    expect(bin.list().outcomes.at(-1)).toMatchObject({ result: "gone" });
    time.advance(10_000);
    await settle();
    expect(closed.map((entry) => entry.pane_id)).toEqual(["p2"]);
  });

  test("entry IDs name this service run, so a restart never reuses one", () => {
    const first = setup().bin;
    const second = setup().bin;
    const a = first.add(target("p1"), 30_000);
    const b = second.add(target("p1"), 30_000);
    expect(a.epoch).not.toBe(b.epoch);
    expect(a.entries[0]!.id).not.toBe(b.entries[0]!.id);
    expect(a.entries[0]!.id.startsWith(`bin-${a.epoch}-`)).toBe(true);
  });

  test("rejects an unqualified target", () => {
    const { bin } = setup();
    expect(() => bin.add({ ...target("p1"), pane_id: "" }, 10_000)).toThrow(
      "invalid bin target",
    );
    expect(() =>
      bin.add({ ...target("p1"), connection_generation: -1 }, 10_000),
    ).toThrow("invalid bin target");
  });
});

describe("closeBinEntry", () => {
  const entry: BinEntry = {
    ...target("p2"),
    id: "bin-1",
    duration_ms: 30_000,
    remaining_ms: 0,
  };
  function herdr(panes: Record<string, string>[]) {
    const calls: [string, Record<string, unknown>][] = [];
    let current = panes;
    return {
      calls,
      lease: {
        generation: 1,
        isCurrent: () => true,
        call: async (method: string, params: Record<string, unknown>) => {
          calls.push([method, params]);
          if (method === "pane.list") return { panes: current };
          current = current.filter(
            (pane) =>
              pane.pane_id !== params.pane_id &&
              pane.workspace_id !== params.workspace_id,
          );
          return {};
        },
      },
    };
  }
  const pane = (id: string, tab = "t1", workspace = "w1") => ({
    pane_id: id,
    tab_id: tab,
    workspace_id: workspace,
    terminal_id: `term-${id}`,
  });

  test("closes the pane when its workspace keeps others", async () => {
    const { lease, calls } = herdr([pane("p1"), pane("p2")]);
    expect(await closeBinEntry(entry, lease)).toEqual({
      result: "closed",
      closed_tab: false,
    });
    expect(calls.filter(([method]) => method !== "pane.list")).toEqual([
      ["pane.close", { pane_id: "p2" }],
    ]);
  });

  test("closes due together run one at a time, so the last pane closes its workspace", async () => {
    const { lease, calls } = herdr([pane("p1"), pane("p2")]);
    const slow = {
      ...lease,
      // Herdr answers a moment later, as it does for a real close.
      call: async (method: string, params: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        return lease.call(method, params);
      },
    };
    const bin = new WorldBinRegistry(
      (entry) => closeBinEntry(entry, slow),
      () => {},
      fakeClock().clock,
    );
    bin.add(target("p1"), 30_000);
    bin.add(target("p2"), 30_000);
    bin.closeNow("all");
    await bin.settled();
    expect(calls.filter(([method]) => method !== "pane.list")).toEqual([
      ["pane.close", { pane_id: "p1" }],
      ["workspace.close", { workspace_id: "w1" }],
    ]);
    expect(
      bin.list().outcomes.map(({ result, closed_tab }) => [result, closed_tab]),
    ).toEqual([
      ["closed", false],
      ["closed", true],
    ]);
  });

  test("closes the workspace when it is the workspace's last pane", async () => {
    const { lease, calls } = herdr([pane("p2"), pane("p9", "t9", "w9")]);
    expect(await closeBinEntry(entry, lease)).toEqual({
      result: "closed",
      closed_tab: true,
    });
    expect(calls.filter(([method]) => method !== "pane.list")).toEqual([
      ["workspace.close", { workspace_id: "w1" }],
    ]);
  });

  test("leaves a changed pane, another generation or a missing host alone", async () => {
    const swapped = herdr([{ ...pane("p2"), terminal_id: "term-new" }]);
    expect((await closeBinEntry(entry, swapped.lease)).result).toBe("gone");
    expect(swapped.calls.map(([method]) => method)).toEqual(["pane.list"]);
    const restarted = herdr([pane("p2")]);
    expect(
      (await closeBinEntry(entry, { ...restarted.lease, generation: 2 }))
        .result,
    ).toBe("gone");
    expect(restarted.calls).toEqual([]);
    expect((await closeBinEntry(entry, null)).result).toBe("gone");
  });

  test("reports a refused worktree-group close without retrying", async () => {
    const calls: string[] = [];
    const outcome = await closeBinEntry(entry, {
      generation: 1,
      isCurrent: () => true,
      call: async (method) => {
        calls.push(method);
        if (method === "pane.list") return { panes: [pane("p2")] };
        throw new Error("workspace_group_close_required: group");
      },
    });
    expect(outcome.result).toBe("failed");
    expect(calls).toEqual(["pane.list", "workspace.close"]);
  });
});
