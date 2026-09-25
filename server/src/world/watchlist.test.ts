import { describe, expect, test } from "bun:test";
import { WorldWatchlistRegistry } from "./watchlist";

const record = (index = 1) => ({
  connection_id: "host-a",
  connection_generation: 1,
  terminal_id: `terminal-${index}`,
  label: `Watch ${index}`,
});

describe("WorldWatchlistRegistry", () => {
  test("keeps exact identities, is idempotent, and bounds admission", () => {
    const watches = new WorldWatchlistRegistry();
    expect(watches.pin(record())).toEqual({ changed: true, revision: 1 });
    expect(watches.pin(record())).toEqual({ changed: false, revision: 1 });
    expect(watches.pin({ ...record(), connection_id: "host-b" })).toEqual({
      changed: true,
      revision: 2,
    });
    for (let index = 2; index <= 127; index += 1) watches.pin(record(index));
    expect(watches.list().records).toHaveLength(128);
    expect(() => watches.pin(record(128))).toThrow("watchlist is full");
    expect(
      watches.unpin({
        connection_id: "host-a",
        connection_generation: 1,
        terminal_id: "gone",
      }),
    ).toEqual({ changed: false, revision: 128 });
    expect(watches.unpin(record())).toEqual({ changed: true, revision: 129 });
  });

  test("retires old generations before a native terminal can be reused", () => {
    const watches = new WorldWatchlistRegistry();
    watches.pin(record());
    expect(watches.retireConnectionGeneration("host-a", 2)).toEqual({
      changed: true,
      revision: 2,
    });
    expect(watches.list().records).toEqual([]);
  });
});
