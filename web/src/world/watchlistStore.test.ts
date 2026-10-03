import { describe, expect, test } from "bun:test";
import { WorldWatchlistStore } from "./watchlistStore";

function response(revision: number, terminalId = "terminal-a") {
  return {
    revision,
    records: [
      {
        connection_id: "host-a",
        connection_generation: 1,
        terminal_id: terminalId,
        label: "Synthetic watch",
      },
    ],
  };
}

describe("WorldWatchlistStore", () => {
  test("colliding watched terminals remain separately qualified and one mutation carries only its captured owner", async () => {
    const records = ["alpha", "beta"].map((connection_id) => ({
      connection_id,
      connection_generation: 7,
      terminal_id: "shared",
      label: `Synthetic ${connection_id}`,
    }));
    const calls: Array<{ method: string; params?: Record<string, unknown> }> =
      [];
    const store = new WorldWatchlistStore({
      call: async (method, params) => {
        calls.push({ method, params });
        return { revision: 1, records };
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    await store.refresh();
    expect(store.get().records.map((record) => record.connectionId)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(
      await store.mutate("world.watchlist.pin", {
        connectionId: "beta",
        generation: 7,
        terminalId: "shared",
        label: "Synthetic beta",
      }),
    ).toBe(true);
    expect(
      calls.find((call) => call.method === "world.watchlist.pin")?.params,
    ).toMatchObject({
      connection_id: "beta",
      connection_generation: 7,
      terminal_id: "shared",
    });
    expect(store.get().records).toHaveLength(2);
  });
  test("ignores an older reply until reconnect permits a restarted service revision", async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    let status: (value: "connecting" | "connected" | "disconnected") => void =
      () => undefined;
    const store = new WorldWatchlistStore({
      call: () => new Promise((resolve) => resolvers.push(resolve)),
      onControl: () => () => undefined,
      onStatus: (listener) => {
        status = listener;
        return () => undefined;
      },
    });
    store.start();
    status("connected");
    resolvers[0](response(9));
    await Promise.resolve();
    expect(store.get()).toMatchObject({ revision: 9, verified: true });
    const older = store.refresh();
    resolvers[1](response(8));
    await older;
    expect(store.get().revision).toBe(9);
    status("disconnected");
    status("connected");
    resolvers[2]({ revision: 0, records: [] });
    await Promise.resolve();
    expect(store.get()).toEqual({
      revision: 0,
      records: [],
      verified: true,
      error: null,
    });
  });

  test("shows a disconnected mutation failure without rejecting", async () => {
    const store = new WorldWatchlistStore({
      call: async () => response(1),
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    await expect(
      store.mutate("world.watchlist.pin", {
        connectionId: "host-a",
        generation: 1,
        terminalId: "terminal-a",
        label: "Synthetic",
      }),
    ).resolves.toBe(false);
    expect(store.get()).toMatchObject({
      verified: false,
      error: "World watchlist is disconnected",
    });
  });

  test("shows a full watchlist mutation failure without an unhandled rejection", async () => {
    const store = new WorldWatchlistStore({
      call: async (method) => {
        if (method === "world.watchlist.list") return response(128);
        throw new Error("World watchlist is full (128 records)");
      },
      onControl: () => () => undefined,
      onStatus: () => () => undefined,
    });
    await store.refresh();
    await expect(
      store.mutate("world.watchlist.pin", {
        connectionId: "host-a",
        generation: 1,
        terminalId: "terminal-a",
        label: "Synthetic",
      }),
    ).resolves.toBe(false);
    expect(store.get()).toMatchObject({
      verified: true,
      error: "World watchlist is full (128 records)",
    });
  });
});
