import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  __resetBuildFreshnessForTests,
  currentBuildFreshness,
  dismissReloadRequest,
} from "./buildFreshness";
import { importWithReload } from "./lazyWithReload";

const COMPONENT_KEY = "diff-content-view";
const RELOAD_ATTEMPTED_KEY = `herdr-world:foundation-v2:herdr:lazy-chunk-reload:${COMPONENT_KEY}`;

let storage: Map<string, string>;
let reloadCount = 0;

beforeEach(() => {
  storage = new Map();
  reloadCount = 0;
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
      removeItem: (key: string) => void storage.delete(key),
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { reload: mock(() => void (reloadCount += 1)) } },
  });
});

afterEach(() => {
  __resetBuildFreshnessForTests();
  delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
  delete (globalThis as { window?: unknown }).window;
});

const PLACEHOLDER = { ok: false };

test("returns the module and clears the reload marker on success", async () => {
  storage.set(RELOAD_ATTEMPTED_KEY, "1");
  storage.set("herdr:lazy-chunk-reload:terminal-view", "1");
  const module = await importWithReload(
    COMPONENT_KEY,
    () => Promise.resolve({ ok: true }),
    PLACEHOLDER,
  );
  expect(module).toEqual({ ok: true });
  expect(storage.has(RELOAD_ATTEMPTED_KEY)).toBe(false);
  expect(storage.get("herdr:lazy-chunk-reload:terminal-view")).toBe("1");
  expect(reloadCount).toBe(0);
});

const reloadOffered = () => currentBuildFreshness().reloadNeeded;

test("offers a reload once when the import fails, never reloads, then throws on a retry", async () => {
  const failure = () => Promise.reject(new Error("chunk 404"));
  // The first failure settles on the placeholder, which asks again on mount.
  await expect(
    importWithReload(COMPONENT_KEY, failure, PLACEHOLDER),
  ).resolves.toBe(PLACEHOLDER);
  expect(reloadOffered()).toBe(true);
  await expect(
    importWithReload(COMPONENT_KEY, failure, PLACEHOLDER),
  ).rejects.toThrow("chunk 404");
  expect(reloadCount).toBe(0);
});

test("a chunk failure after Later offers the reload again instead of taking it", async () => {
  dismissReloadRequest();
  void importWithReload(
    COMPONENT_KEY,
    () => Promise.reject(new Error("chunk 404")),
    PLACEHOLDER,
  );
  await Promise.resolve();
  expect(reloadOffered()).toBe(true);
  expect(reloadCount).toBe(0);
});

test("a successful terminal import does not reset a failing diff's reload guard", async () => {
  const error = new Error("diff chunk 404");
  const failure = () => Promise.reject(error);
  void importWithReload(COMPONENT_KEY, failure, PLACEHOLDER);
  await Promise.resolve();
  expect(reloadOffered()).toBe(true);

  // TerminalView loads first after a reload; Changes is then opened again.
  for (let retry = 0; retry < 2; retry++) {
    await importWithReload(
      "terminal-view",
      () => Promise.resolve({ ok: true }),
      PLACEHOLDER,
    );
    expect(storage.get(RELOAD_ATTEMPTED_KEY)).toBe("1");
    await expect(
      importWithReload(COMPONENT_KEY, failure, PLACEHOLDER),
    ).rejects.toBe(error);
  }
  expect(reloadCount).toBe(0);
});

test("each lazy component has its own reload offer", async () => {
  const error = new Error("chunk 404");
  const failure = () => Promise.reject(error);
  for (const key of [COMPONENT_KEY, "terminal-view"]) {
    dismissReloadRequest();
    void importWithReload(key, failure, PLACEHOLDER);
    await Promise.resolve();
    expect(reloadOffered()).toBe(true);
  }
  for (const key of [COMPONENT_KEY, "terminal-view"]) {
    await expect(importWithReload(key, failure, PLACEHOLDER)).rejects.toBe(
      error,
    );
  }
  expect(reloadCount).toBe(0);
});
