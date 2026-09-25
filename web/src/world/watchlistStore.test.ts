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

  test("does not mutate while the cached list is disconnected", async () => {
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
    ).rejects.toThrow("disconnected");
  });
});
