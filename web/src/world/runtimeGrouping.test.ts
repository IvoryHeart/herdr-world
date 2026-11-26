import { afterAll, beforeEach, expect, test } from "bun:test";

const values = new Map<string, string>();
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  },
});
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

const { worldLocalStorage } = await import("../browserStorage");
const { OFFICE_PREFERENCES_KEY } = await import("./officePreferences");
const {
  adoptRuntimeGrouping,
  connectRuntimeGrouping,
  RUNTIME_GROUPING_DEFAULT,
  runtimeGrouping,
  saveRuntimeGrouping,
  subscribeRuntimeGrouping,
} = await import("./runtimeGrouping");

beforeEach(() => {
  values.clear();
  connectRuntimeGrouping(null);
});

test("the grouping is World's: saved to the service, adopted from other browsers", async () => {
  adoptRuntimeGrouping("machine");
  expect(runtimeGrouping()).toBe("machine");
  const sent: unknown[] = [];
  let revision = 0;
  connectRuntimeGrouping(async (value) => {
    sent.push(value);
    return { value, revision: ++revision };
  });
  let changes = 0;
  const stop = subscribeRuntimeGrouping(() => changes++);
  await saveRuntimeGrouping("runtime");
  expect(sent).toEqual(["runtime"]);
  expect(runtimeGrouping()).toBe("runtime");
  expect(changes).toBe(1);
  // The default is stored too, so an older browser choice never replaces it.
  await saveRuntimeGrouping("machine");
  expect(sent).toEqual(["runtime", "machine"]);
  // Another browser's change arrives as a push.
  adoptRuntimeGrouping("runtime", ++revision);
  expect(runtimeGrouping()).toBe("runtime");
  // A refused write puts back the last saved value.
  connectRuntimeGrouping(async () => {
    throw new Error("refused");
  });
  await expect(saveRuntimeGrouping("machine")).rejects.toThrow("refused");
  expect(runtimeGrouping()).toBe("runtime");
  connectRuntimeGrouping(null);
  await expect(saveRuntimeGrouping("machine")).rejects.toThrow("Not connected");
  stop();
});

test("a browser's old Town buildings choice is sent once, only while the service has none", async () => {
  // Before #1307: "One per runtime" in this browser's Town preferences.
  worldLocalStorage.setItem(
    OFFICE_PREFERENCES_KEY,
    JSON.stringify({ townBuildings: "runtime" }),
  );
  const sent: unknown[] = [];
  const onlyIfAbsent: unknown[] = [];
  connectRuntimeGrouping(async (value, options) => {
    sent.push(value);
    onlyIfAbsent.push(options?.onlyIfAbsent);
    return { value, revision: 2 };
  });
  // The service has a value: it wins, nothing is sent.
  adoptRuntimeGrouping("machine", 0);
  expect(runtimeGrouping()).toBe("machine");
  expect(sent).toEqual([]);

  // A fresh service with no value: this browser's old choice goes up once.
  // It is offered only if the service still has none when it arrives.
  connectRuntimeGrouping(null);
  connectRuntimeGrouping(async (value, options) => {
    sent.push(value);
    onlyIfAbsent.push(options?.onlyIfAbsent);
    return { value, revision: 1 };
  });
  worldLocalStorage.removeItem("runtimeGrouping.v1");
  adoptRuntimeGrouping(undefined, 0);
  await Promise.resolve();
  expect(sent).toEqual(["runtime"]);
  expect(onlyIfAbsent).toEqual([true]);
  expect(runtimeGrouping()).toBe("runtime");
  // Its echo from the service confirms it; nothing more is sent.
  adoptRuntimeGrouping("runtime", 1);
  expect(sent).toEqual(["runtime"]);
});

test("a browser with the default sends nothing to an empty service", () => {
  const sent: unknown[] = [];
  connectRuntimeGrouping(async (value) => {
    sent.push(value);
    return { value };
  });
  adoptRuntimeGrouping(null);
  expect(runtimeGrouping()).toBe(RUNTIME_GROUPING_DEFAULT);
  expect(sent).toEqual([]);
  // A value the service does not know is ignored, as if it were missing.
  adoptRuntimeGrouping("sideways");
  expect(runtimeGrouping()).toBe(RUNTIME_GROUPING_DEFAULT);
});
