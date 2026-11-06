import { expect, test } from "bun:test";
import type { BridgeControlMsg, ConnectionStatus } from "../../api";
import type { BinState } from "../../../../shared/bin";
import { binBusClock, binClockLabel, WorldBinStore } from "./binStore";

const state = (over: Partial<BinState> = {}): BinState => ({
  epoch: "run1",
  revision: 1,
  entries: [],
  closing: [],
  outcomes: [],
  bus: {
    interval_ms: 180_000,
    trip_ms: 20_000,
    next_ms: 60_000,
    elapsed_ms: null,
  },
  ...over,
});

const entry = (id: string, riding = false) => ({
  id,
  connection_id: "studio",
  connection_generation: 1,
  workspace_id: "w",
  tab_id: "t",
  pane_id: `p-${id}`,
  terminal_id: `term-${id}`,
  label: `Agent ${id}`,
  view: "town" as const,
  riding,
  preserve_tab: false,
});

function fixture() {
  let now = 1_000;
  const replies: unknown[] = [];
  const calls: [string, Record<string, unknown> | undefined][] = [];
  let control: ((message: BridgeControlMsg) => void) | null = null;
  let status: ((value: ConnectionStatus) => void) | null = null;
  const store = new WorldBinStore(
    {
      call: async (method, params) => {
        calls.push([method, params]);
        const reply = replies.shift();
        if (reply instanceof Error) throw reply;
        return reply;
      },
      onControl: (callback) => {
        control = callback;
        return () => (control = null);
      },
      onStatus: (callback) => {
        status = callback;
        return () => (status = null);
      },
    },
    () => now,
  );
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store,
    replies,
    calls,
    flush,
    tick: (ms: number) => (now += ms),
    control: (message: BridgeControlMsg) => control?.(message),
    status: (value: ConnectionStatus) => status?.(value),
    listening: () => control !== null,
  };
}

test("the store follows revision notices and ignores older replies of the same run", async () => {
  const f = fixture();
  f.replies.push(state({ revision: 3, entries: [entry("a")] }));
  f.store.start();
  await f.flush();
  expect(f.store.get().entries.map((e) => e.id)).toEqual(["a"]);
  f.replies.push(state({ revision: 2 }));
  f.control({ type: "world_bin_changed", revision: 2 });
  await f.flush();
  expect(f.store.get().revision).toBe(3);
  // A restarted service counts again from 1: its state replaces the old run's.
  f.replies.push(state({ epoch: "run2", revision: 1 }));
  f.control({ type: "world_bin_changed", revision: 1 });
  await f.flush();
  expect(f.store.get()).toMatchObject({ epoch: "run2", entries: [] });
  f.status("disconnected");
  expect(f.store.get().verified).toBe(false);
});

test("the subscription is shared and ends with its last user", async () => {
  const f = fixture();
  f.replies.push(state(), state());
  f.store.start();
  f.store.start();
  f.store.stop();
  expect(f.listening()).toBe(true);
  f.store.stop();
  expect(f.listening()).toBe(false);
});

test("actions take the service's reply, and report its refusal", async () => {
  const f = fixture();
  f.replies.push(state({ revision: 2, entries: [entry("a")] }));
  expect(
    await f.store.add({
      ...entry("a"),
      label: "Agent a",
      view: "town",
      preserve_tab: true,
    }),
  ).toBeNull();
  expect(f.calls[0]![0]).toBe("world.bin.add");
  expect(f.calls[0]![1]).toMatchObject({ pane_id: "p-a", preserve_tab: true });
  expect(f.store.get().entries).toHaveLength(1);
  f.replies.push(new Error("It has already boarded the bus"), state());
  expect(await f.store.restore("a")).toBe("It has already boarded the bus");
  f.replies.push(state({ revision: 4 }));
  expect(await f.store.closeNow(["a"])).toBeNull();
  expect(f.calls[f.calls.length - 1]).toEqual([
    "world.bin.close_now",
    { ids: ["a"] },
  ]);
});

test("malformed replies and entries are dropped", async () => {
  const f = fixture();
  f.replies.push({ epoch: "run1", revision: 1, entries: [] });
  await f.store.refresh();
  expect(f.store.get().verified).toBe(false);
  f.replies.push(
    state({
      entries: [entry("a"), { id: "b" } as never],
      closing: [entry("c", true)],
    }),
  );
  await f.store.refresh();
  expect(f.store.get().entries.map((e) => e.id)).toEqual(["a"]);
  expect(f.store.get().closing.map((e) => e.riding)).toEqual([true]);
});

test("the bus clock runs from when the state was read", async () => {
  const f = fixture();
  f.replies.push(
    state({
      bus: {
        interval_ms: 180_000,
        trip_ms: 20_000,
        next_ms: 5_000,
        elapsed_ms: null,
      },
    }),
  );
  await f.store.refresh();
  const read = f.store.get();
  expect(binBusClock(read, read.readAt + 2_000)).toEqual({
    elapsed: null,
    next: 3_000,
  });
  // The schedule repeats even before the next state arrives.
  expect(binBusClock(read, read.readAt + 6_000).next).toBe(179_000);
  const driving = {
    ...read,
    bus: { ...read.bus, next_ms: 170_000, elapsed_ms: 10_000 },
  };
  expect(binBusClock(driving, read.readAt + 5_000).elapsed).toBe(15_000);
  // Past its trip the bus has left the map.
  expect(binBusClock(driving, read.readAt + 10_000).elapsed).toBeNull();
  expect(binClockLabel(125_000)).toBe("2:05");
  expect(binClockLabel(0)).toBe("0:00");
});

test("each entry remembers when this page first saw it", async () => {
  const f = fixture();
  f.replies.push(state({ entries: [entry("a")] }));
  await f.store.refresh();
  const first = f.store.firstSeen("a");
  f.tick(20_000);
  f.replies.push(state({ revision: 2, entries: [entry("a"), entry("b")] }));
  await f.store.refresh();
  expect(f.store.firstSeen("a")).toBe(first);
  expect(f.store.firstSeen("b")).toBe(first + 20_000);
});
