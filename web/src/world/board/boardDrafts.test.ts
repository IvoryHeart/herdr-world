import { describe, expect, test } from "bun:test";
import {
  createDraftStore,
  type DraftStorage,
  type KeptDraft,
} from "./boardDrafts";

const memoryStorage = (): DraftStorage => {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
};
const draft = (key: string, noteId: string, text = "Draft"): KeptDraft => ({
  key,
  text,
  reason: "changed",
  started: { id: noteId, text: "Old", color: "yellow", x: 0, y: 0, rev: 1 },
});

describe("Board kept drafts", () => {
  test("two tabs keep each other's drafts; reading never clears storage", () => {
    const storage = memoryStorage();
    const tabB = createDraftStore(storage); // initialised while empty
    const tabA = createDraftStore(storage);
    tabA.keep(draft("a", "n1"));
    // Tab B mounting Board again only reads.
    expect(
      createDraftStore(storage)
        .list()
        .map((d) => d.key),
    ).toEqual(["a"]);
    tabB.keep(draft("b", "n2"));
    expect(
      createDraftStore(storage)
        .list()
        .map((d) => d.key),
    ).toEqual(["a", "b"]);
    tabA.refresh(); // the storage event
    expect(tabA.list().map((d) => d.key)).toEqual(["a", "b"]);
    tabB.remove("a");
    expect(
      createDraftStore(storage)
        .list()
        .map((d) => d.key),
    ).toEqual(["b"]);
  });

  test("a save finishing after Board unmounts still removes the draft; a failure keeps it", async () => {
    const storage = memoryStorage();
    const store = createDraftStore(storage);
    store.keep(draft("a", "n1"));
    store.keep(draft("b", "n2"));
    let finish!: (problem: string | null) => void;
    const pending = store.save(
      "a",
      () => new Promise((resolve) => (finish = resolve)),
    );
    // Still in flight after a remount, and not started twice.
    expect(store.isSaving("a")).toBe(true);
    await store.save("a", async () => {
      throw new Error("must not run");
    });
    finish(null);
    await pending;
    expect(
      createDraftStore(storage)
        .list()
        .map((d) => d.key),
    ).toEqual(["b"]);
    await store.save("b", async () => "write failed");
    expect(store.list()).toEqual([
      expect.objectContaining({ key: "b", error: "write failed" }),
    ]);
    expect(store.isSaving("b")).toBe(false);
  });

  test("without storage, drafts still outlive remounts in this page", () => {
    const store = createDraftStore(null);
    store.keep(draft("a", "n1"));
    expect(store.list().map((d) => d.key)).toEqual(["a"]);
  });

  test("storage that reads but rejects writes keeps the drafts in memory, then persists once it can", () => {
    let full = true;
    const backing = memoryStorage();
    const storage: DraftStorage = {
      getItem: (key) => backing.getItem(key),
      setItem: (key, value) => {
        if (full) throw new Error("QuotaExceededError");
        backing.setItem(key, value);
      },
      removeItem: (key) => backing.removeItem(key),
    };
    const store = createDraftStore(storage);
    store.keep(draft("a", "n1"));
    expect(store.list().map((d) => d.key)).toEqual(["a"]);
    store.keep(draft("b", "n2"));
    expect(store.list().map((d) => d.key)).toEqual(["a", "b"]);
    // Space frees up: the next change writes everything kept so far.
    full = false;
    store.remove("a");
    expect(
      createDraftStore(storage)
        .list()
        .map((d) => d.key),
    ).toEqual(["b"]);
  });

  test("blocked storage that reads as empty still keeps the drafts", () => {
    const store = createDraftStore({
      getItem: () => null,
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    });
    store.keep(draft("a", "n1"));
    expect(store.list().map((d) => d.key)).toEqual(["a"]);
  });
});
