import { describe, expect, test } from "bun:test";
import {
  createDraftStore,
  type DraftStorage,
  type KeptDraft,
} from "./boardDrafts";

/** A shared backing store; `full` makes writes fail while reads still work. */
function sharedStorage() {
  const map = new Map<string, string>();
  const state = { full: false };
  const storage: DraftStorage = {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      if (state.full) throw new Error("QuotaExceededError");
      map.set(key, value);
    },
    removeItem: (key) => {
      if (state.full) throw new Error("QuotaExceededError");
      map.delete(key);
    },
  };
  return { storage, state };
}
const draft = (key: string, noteId: string, text = "Draft"): KeptDraft => ({
  key,
  text,
  reason: "changed",
  started: { id: noteId, text: "Old", color: "yellow", x: 0, y: 0, rev: 1 },
});
const keys = (store: ReturnType<typeof createDraftStore>) =>
  store
    .list()
    .map((d) => d.key)
    .sort();

describe("Board kept drafts", () => {
  test("two tabs keep each other's drafts, even when both read before either writes", () => {
    const { storage } = sharedStorage();
    const tabA = createDraftStore(storage);
    const tabB = createDraftStore(storage);
    // Neither has seen the other's write when it keeps its own draft.
    tabA.keep(draft("a", "n1"));
    tabB.keep(draft("b", "n2"));
    expect(keys(createDraftStore(storage))).toEqual(["a", "b"]);
    tabA.refresh(); // the storage event
    expect(keys(tabA)).toEqual(["a", "b"]);
    tabB.remove("a");
    expect(keys(createDraftStore(storage))).toEqual(["b"]);
  });

  test("a change one tab could not store is merged with other tabs' drafts when it can", () => {
    const { storage, state } = sharedStorage();
    const tabA = createDraftStore(storage);
    const tabB = createDraftStore(storage);
    state.full = true;
    tabA.keep(draft("a", "n1"));
    expect(keys(tabA)).toEqual(["a"]);
    state.full = false;
    tabB.keep(draft("b", "n2"));
    tabA.refresh(); // B's change arrives, A's draft still shows
    expect(keys(tabA)).toEqual(["a", "b"]);
    tabA.update("a", { text: "Edited" });
    // A's retry stored its draft without touching B's.
    const fresh = createDraftStore(storage);
    expect(keys(fresh)).toEqual(["a", "b"]);
    expect(fresh.list().find((d) => d.key === "a")!.text).toBe("Edited");
  });

  test("a pending edit in one tab survives another tab's write and its own later retry", () => {
    const { storage, state } = sharedStorage();
    const tabA = createDraftStore(storage);
    const tabB = createDraftStore(storage);
    state.full = true;
    tabB.keep(draft("b", "n2"));
    state.full = false;
    tabA.keep(draft("a", "n1"));
    tabB.refresh();
    tabB.update("b", { text: "B edited" });
    expect(keys(createDraftStore(storage))).toEqual(["a", "b"]);
  });

  test("storage that reads but rejects writes keeps the drafts, then persists once it can", () => {
    const { storage, state } = sharedStorage();
    const store = createDraftStore(storage);
    state.full = true;
    store.keep(draft("a", "n1"));
    store.keep(draft("b", "n2"));
    expect(keys(store)).toEqual(["a", "b"]);
    state.full = false;
    store.remove("a");
    expect(keys(createDraftStore(storage))).toEqual(["b"]);
  });

  test("blocked storage that reads as empty still keeps the drafts", () => {
    const store = createDraftStore({
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {},
    });
    store.keep(draft("a", "n1"));
    expect(keys(store)).toEqual(["a"]);
  });

  test("one draft per note: a newer draft for the same note replaces the older", () => {
    const { storage } = sharedStorage();
    const store = createDraftStore(storage);
    store.keep(draft("a", "n1", "first"));
    store.keep(draft("a2", "n1", "second"));
    expect(createDraftStore(storage).list()).toEqual([
      expect.objectContaining({ key: "a2", text: "second" }),
    ]);
  });

  test("a save finishing after Board unmounts still removes the draft; a failure keeps it", async () => {
    const { storage } = sharedStorage();
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
    expect(keys(createDraftStore(storage))).toEqual(["b"]);
    await store.save("b", async () => "write failed");
    expect(store.list()).toEqual([
      expect.objectContaining({ key: "b", error: "write failed" }),
    ]);
    expect(store.isSaving("b")).toBe(false);
  });

  test("without storage, drafts still outlive remounts in this page", () => {
    const store = createDraftStore(null);
    store.keep(draft("a", "n1"));
    expect(keys(store)).toEqual(["a"]);
  });
});
