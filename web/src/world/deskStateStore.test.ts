import { expect, test } from "bun:test";
import { WorldDeskStore } from "./deskStateStore";
import type { BridgeControlMsg, ConnectionStatus } from "../api";

const identity = {
  connection_id: "alpha",
  connection_generation: 1,
  terminal_id: "terminal-a",
  agent_session_fingerprint: "a".repeat(64),
};
const state = (revision: number, stop = "turn-1") => ({
  revision,
  records: [{ ...identity, reviewed_stop: stop, stopped_at: 2, opened_at: 3 }],
});

test("two browsers share review and Undo through notifications without storage", async () => {
  let shared = {
    revision: 0,
    records: [] as ReturnType<typeof state>["records"],
  };
  const controls: ((control: BridgeControlMsg) => void)[] = [];
  const client = () => ({
    onControl: (callback: (control: BridgeControlMsg) => void) => {
      controls.push(callback);
      return () => {};
    },
    onStatus: () => () => {},
    call: async (method: string, params?: Record<string, unknown>) => {
      if (method === "world.desk.review") {
        shared = params?.reviewed
          ? state(shared.revision + 1, String(params.stop_id))
          : { revision: shared.revision + 1, records: [] };
        for (const callback of controls)
          callback({ type: "world_desk_changed", revision: shared.revision });
      }
      return shared;
    },
  });
  const a = new WorldDeskStore(client()),
    b = new WorldDeskStore(client());
  a.start();
  b.start();
  await Promise.all([a.refresh(), b.refresh()]);
  expect(
    await a.mutate("world.desk.review", identity, {
      stop_id: "turn-1",
      reviewed: true,
    }),
  ).toBe(true);
  await Promise.resolve();
  expect(b.get().records[0]!.reviewed_stop).toBe("turn-1");
  await b.mutate("world.desk.review", identity, {
    stop_id: "turn-1",
    reviewed: false,
  });
  await Promise.resolve();
  expect(a.get().records).toEqual([]);
  a.stop();
  b.stop();
});

test("obsolete reads and mutation replies cannot cross disconnect or overwrite newer state", async () => {
  const pending: ((value: unknown) => void)[] = [];
  let status: (status: ConnectionStatus) => void = () => {};
  const store = new WorldDeskStore({
    call: () => new Promise((resolve) => pending.push(resolve)),
    onControl: () => () => {},
    onStatus: (callback) => {
      status = callback;
      return () => {};
    },
  });
  store.start();
  pending.shift()!(state(9));
  await Promise.resolve();
  const late = store.refresh();
  const mutation = store.mutate("world.desk.open", identity);
  status("disconnected");
  expect(store.get().verified).toBe(false);
  status("connected");
  pending[2]!({ revision: 0, records: [] });
  await Promise.resolve();
  pending[0]!(state(10));
  pending[1]!(state(11));
  await Promise.all([late, mutation]);
  expect(store.get()).toMatchObject({
    revision: 0,
    records: [],
    verified: true,
  });
  const older = store.refresh(),
    newer = store.refresh();
  pending[4]!(state(2));
  await newer;
  pending[3]!(state(1));
  await older;
  expect(store.get().revision).toBe(2);
  store.stop();
});

test("malformed replies and disconnected writes remain unavailable", async () => {
  let calls = 0;
  const store = new WorldDeskStore({
    call: async () => {
      calls++;
      return { revision: 1, records: [{}] };
    },
    onControl: () => () => {},
    onStatus: () => () => {},
  });
  expect(await store.mutate("world.desk.open", identity)).toBe(false);
  expect(calls).toBe(0);
  await store.refresh();
  expect(store.get().verified).toBe(false);
  expect(store.get().error).toContain("Invalid Desk state");
});
