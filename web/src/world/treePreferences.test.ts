import { describe, expect, test } from "bun:test";
import {
  parseTreePreferences,
  readTreePreferences,
  TREE_PREFERENCES_KEY,
  writeTreePreferences,
} from "./treePreferences";

describe("Tree preferences", () => {
  test("admits bounded unique disclosure identities", () => {
    expect(
      parseTreePreferences({ collapsedIds: ["host", "host", "space", 3] }),
    ).toEqual({ collapsedIds: ["host", "space"] });
  });

  test("fails closed and writes only normalized disclosure", () => {
    const storage = memoryStorage("{");
    expect(readTreePreferences(storage)).toEqual({ collapsedIds: [] });
    writeTreePreferences(storage, { collapsedIds: ["a", "a", "b"] });
    expect(storage.written).toEqual({
      key: TREE_PREFERENCES_KEY,
      value: JSON.stringify({ collapsedIds: ["a", "b"] }),
    });
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
