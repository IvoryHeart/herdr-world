import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  readTerminalInputMode,
  rememberTerminalInputMode,
  TERMINAL_INPUT_MODE_STORAGE_KEY,
} from "./terminalInputMode";

const key = `herdr-world:foundation-v2:${TERMINAL_INPUT_MODE_STORAGE_KEY}`;
const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
let values: Map<string, string>;
let writes: string[];
let failWrites: boolean;

beforeEach(() => {
  values = new Map();
  writes = [];
  failWrites = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error("QuotaExceededError");
        values.set(key, value);
        writes.push(key);
      },
    },
  });
  // Clear any failed-write override from the preceding test.
  rememberTerminalInputMode("composer");
  values.clear();
  writes.length = 0;
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: { setItem() {} },
  });
  rememberTerminalInputMode("composer");
  if (original) Object.defineProperty(globalThis, "localStorage", original);
  else Reflect.deleteProperty(globalThis, "localStorage");
});

test("missing and invalid values default to Composer without writing", () => {
  expect(readTerminalInputMode()).toBe("composer");
  for (const value of ["", "invalid", '"direct"', "DIRECT", "{}", "null"]) {
    values.set(key, value);
    expect(readTerminalInputMode()).toBe("composer");
  }
  expect(writes).toEqual([]);
});

test("explicit choices persist in the existing browser preference namespace", () => {
  for (const mode of ["direct", "composer", "direct"] as const) {
    rememberTerminalInputMode(mode);
    expect(values.get(key)).toBe(mode);
    expect(values.has(TERMINAL_INPUT_MODE_STORAGE_KEY)).toBe(false);
    expect(readTerminalInputMode()).toBe(mode);
  }
  expect(writes).toEqual([key, key, key]);
});

test("each open reads the latest stored choice without stale instance writes", () => {
  rememberTerminalInputMode("direct");
  values.set(key, "composer");
  expect(readTerminalInputMode()).toBe("composer");
  values.set(key, "direct");
  expect(readTerminalInputMode()).toBe("direct");
  values.delete(key);
  expect(readTerminalInputMode()).toBe("composer");
  expect(writes).toEqual([key]);
});

test("failed writes override readable old storage for the current page", () => {
  rememberTerminalInputMode("composer");
  failWrites = true;
  rememberTerminalInputMode("direct");
  expect(values.get(key)).toBe("composer");
  expect(readTerminalInputMode()).toBe("direct");
  rememberTerminalInputMode("composer");
  expect(readTerminalInputMode()).toBe("composer");
  rememberTerminalInputMode("direct");
  expect(readTerminalInputMode()).toBe("direct");
  failWrites = false;
  rememberTerminalInputMode("direct");
  // A successful write retires the fallback, so subsequent storage changes win.
  values.set(key, "composer");
  expect(readTerminalInputMode()).toBe("composer");
});

test("denied browser storage remains usable without throwing", () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  expect(readTerminalInputMode()).toBe("composer");
  rememberTerminalInputMode("direct");
  expect(readTerminalInputMode()).toBe("direct");
  rememberTerminalInputMode("composer");
  expect(readTerminalInputMode()).toBe("composer");
});
