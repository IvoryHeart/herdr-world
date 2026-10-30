import { describe, expect, test } from "bun:test";
import { WorldCompletionSeenRegistry } from "./completion-seen";

const identity = (terminal: string, generation = 7, connection = "alpha") => ({
  connection_id: connection,
  connection_generation: generation,
  terminal_id: terminal,
});

describe("World completion seen registry", () => {
  test("marks once per terminal generation and revises only on change", () => {
    const registry = new WorldCompletionSeenRegistry();
    expect(registry.mark(identity("t1"))).toEqual({
      changed: true,
      revision: 1,
    });
    expect(registry.mark(identity("t1"))).toEqual({
      changed: false,
      revision: 1,
    });
    expect(registry.mark(identity("t1", 8))).toEqual({
      changed: true,
      revision: 2,
    });
    expect(registry.list().records).toEqual([
      { ...identity("t1"), revision: 1 },
      { ...identity("t1", 8), revision: 2 },
    ]);
  });

  test("a host read showing the agent busy ends its check", () => {
    const registry = new WorldCompletionSeenRegistry();
    registry.mark(identity("t1"));
    // A late read of the same completion keeps the check.
    expect(registry.observe(identity("t1"), false).changed).toBe(false);
    expect(registry.list().records).toHaveLength(1);

    expect(registry.observe(identity("t1"), true)).toEqual({
      changed: true,
      revision: 2,
    });
    expect(registry.list().records).toEqual([]);
    // While busy, a mark from a browser still showing the old finish is
    // ignored; once the next completion is observed, it applies.
    expect(registry.mark(identity("t1")).changed).toBe(false);
    registry.observe(identity("t1"), false);
    expect(registry.mark(identity("t1"))).toEqual({
      changed: true,
      revision: 3,
    });
    // Another terminal's work does not touch it.
    expect(registry.observe(identity("t2"), true).changed).toBe(false);
    expect(registry.list().records).toHaveLength(1);
  });

  test("a new runtime generation retires only its connection's older marks", () => {
    const registry = new WorldCompletionSeenRegistry();
    registry.mark(identity("t1", 7));
    registry.mark(identity("t2", 8));
    registry.mark(identity("t1", 7, "beta"));
    registry.observe(identity("t9", 7), true);

    expect(registry.retireConnectionGeneration("alpha", 8)).toEqual({
      changed: true,
      revision: 4,
    });
    expect(registry.list().records.map((record) => record.terminal_id)).toEqual(
      ["t2", "t1"],
    );
    expect(registry.retireConnectionGeneration("alpha", 8).changed).toBe(false);
    // The retired generation's busy terminal no longer blocks a mark.
    expect(registry.mark(identity("t9", 7)).changed).toBe(true);
  });

  test("rejects malformed identities and keeps the newest 4096 marks", () => {
    const registry = new WorldCompletionSeenRegistry();
    expect(() => registry.mark(identity(""))).toThrow("identity");
    expect(() => registry.mark(identity("t1", -1))).toThrow("identity");
    expect(() => registry.mark(identity("x".repeat(513)))).toThrow("identity");
    for (let index = 0; index <= 4_096; index++)
      registry.mark(identity(`t${index}`));
    const records = registry.list().records;
    expect(records).toHaveLength(4_096);
    expect(records[0]!.terminal_id).toBe("t1");
  });
});
