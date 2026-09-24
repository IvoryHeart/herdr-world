const PREFIX = "herdr-world:foundation-v2:";

/** Isolate the new foundation from both old World and upstream browser state. */
export function worldStorage(storage: Storage): Storage {
  const keys = () =>
    Array.from({ length: storage.length }, (_, index) => storage.key(index))
      .filter((key): key is string => key?.startsWith(PREFIX) ?? false)
      .map((key) => key.slice(PREFIX.length));
  return {
    get length() {
      return keys().length;
    },
    key(index) {
      return keys()[index] ?? null;
    },
    getItem(key) {
      const current = storage.getItem(PREFIX + key);
      if (current !== null) return current;
      return null;
    },
    setItem(key, value) {
      storage.setItem(PREFIX + key, value);
    },
    removeItem(key) {
      storage.removeItem(PREFIX + key);
    },
    clear() {
      for (const key of keys()) this.removeItem(key);
    },
  };
}

function browserStorage(kind: "localStorage" | "sessionStorage"): Storage {
  const get = () => worldStorage(globalThis[kind]);
  return {
    get length() {
      return get().length;
    },
    key(index) {
      return get().key(index);
    },
    getItem(key) {
      try {
        return get().getItem(key);
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      get().setItem(key, value);
    },
    removeItem(key) {
      get().removeItem(key);
    },
    clear() {
      get().clear();
    },
  };
}

export const worldLocalStorage = browserStorage("localStorage");
export const worldSessionStorage = browserStorage("sessionStorage");
