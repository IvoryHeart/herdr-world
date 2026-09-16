import { expect, test } from "bun:test";
import { worldStorage } from "./browserStorage";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(initial));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
    clear() {
      values.clear();
    },
  };
}

const prefix = "herdr-world:foundation-v2:";

test("fresh browser writes use the isolated World foundation namespace", () => {
  const raw = memoryStorage();
  const storage = worldStorage(raw);
  storage.setItem("theme", "dark");
  expect(raw.getItem(`${prefix}theme`)).toBe("dark");
  expect(raw.getItem("herdr-world:theme")).toBeNull();
  expect(raw.getItem("theme")).toBeNull();
});

test("old World, upstream and unscoped preferences remain untouched and unread", () => {
  const raw = memoryStorage({
    theme: "unscoped",
    "herdr-world:theme": "old-world",
    "roamgate:theme": "upstream",
  });
  const storage = worldStorage(raw);
  expect(storage.getItem("theme")).toBeNull();
  expect(storage.length).toBe(0);
  storage.setItem("theme", "new-world");
  expect(storage.getItem("theme")).toBe("new-world");
  expect(raw.getItem("herdr-world:theme")).toBe("old-world");
  expect(raw.getItem("roamgate:theme")).toBe("upstream");
});

test("enumeration and clearing affect only current World foundation keys", () => {
  const raw = memoryStorage({
    [`${prefix}theme`]: "dark",
    [`${prefix}scale`]: "1",
    "roamgate:theme": "upstream",
  });
  const storage = worldStorage(raw);
  expect(new Set([storage.key(0), storage.key(1)])).toEqual(
    new Set(["theme", "scale"]),
  );
  storage.clear();
  expect(storage.length).toBe(0);
  expect(raw.getItem("roamgate:theme")).toBe("upstream");
});
