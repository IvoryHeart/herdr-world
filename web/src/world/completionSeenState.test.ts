import { describe, expect, test } from "bun:test";
import {
  COMPLETION_SEEN_STORAGE_KEY,
  officeCompletionIdentity,
  readCompletionSeen,
  writeCompletionSeen,
} from "./completionSeenState";

describe("completion seen state", () => {
  test("qualifies acknowledgement by host, generation, terminal and agent", () => {
    expect(
      officeCompletionIdentity({
        hostKey: "host-a",
        observedGeneration: 7,
        key: "agent-a",
        currentTerminalRef: { nativeId: "terminal-a" },
      } as never),
    ).toBe('["host-a",7,"terminal-a","agent-a"]');
  });

  test("filters malformed storage and writes admitted identities", () => {
    const storage = memoryStorage(JSON.stringify(["ok", 2, "", "next"]));
    expect([...readCompletionSeen(storage)]).toEqual(["ok", "next"]);

    writeCompletionSeen(storage, new Set(["first", "second"]));
    expect(storage.written).toEqual({
      key: COMPLETION_SEEN_STORAGE_KEY,
      value: JSON.stringify(["first", "second"]),
    });
  });

  test("fails closed when storage is unavailable", () => {
    expect(
      readCompletionSeen({
        getItem() {
          throw new Error("denied");
        },
        setItem() {},
      }),
    ).toEqual(new Set());
  });
});

function memoryStorage(initial: string | null) {
  const storage = {
    written: null as { key: string; value: string } | null,
    getItem: () => initial,
    setItem(key: string, value: string) {
      storage.written = { key, value };
    },
  };
  return storage;
}
