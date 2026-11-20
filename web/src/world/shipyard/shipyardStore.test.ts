import { afterEach, describe, expect, test } from "bun:test";
import { worldLocalStorage } from "../../browserStorage";
import {
  FIXTURE_REPO,
  shipyardFixtureCatalog,
  shipyardFixtureSnapshot,
} from "./shipyardFixture";
import { pickRepo, SHIPYARD_REPO_KEY, shipyardStore } from "./shipyardStore";

const NOW = Date.UTC(2026, 10, 20, 12);

// No browser here: a page's storage, in memory.
if (!("localStorage" in globalThis)) {
  const items = new Map<string, string>();
  const memory: Storage = {
    get length() {
      return items.size;
    },
    key: (index) => [...items.keys()][index] ?? null,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, String(value)),
    removeItem: (key) => void items.delete(key),
    clear: () => items.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: memory,
    configurable: true,
  });
}

type Call = { path: string; method: string };

/** A service that answers from the fixture and records what was asked. */
function service(hold?: (call: Call) => Promise<void> | undefined) {
  const calls: Call[] = [];
  shipyardStore.useFetch(async (input, init) => {
    const call = { path: String(input), method: init?.method ?? "GET" };
    calls.push(call);
    await hold?.(call);
    const url = new URL(call.path, "http://fixture.invalid");
    const repo = url.searchParams.get("repo");
    return Response.json(
      repo
        ? shipyardFixtureSnapshot("ready", NOW, repo)
        : shipyardFixtureCatalog("ready", NOW),
    );
  });
  return calls;
}

afterEach(() => {
  shipyardStore.reset();
  shipyardStore.useFetch(null);
  worldLocalStorage.removeItem(SHIPYARD_REPO_KEY);
});

describe("shipyard store", () => {
  test("reads the catalog, then its first suggested repository", async () => {
    const calls = service();
    await shipyardStore.read();
    expect(calls).toEqual([
      { path: "/api/world/shipyard", method: "GET" },
      {
        path: `/api/world/shipyard?repo=${encodeURIComponent(FIXTURE_REPO)}`,
        method: "GET",
      },
    ]);
    const state = shipyardStore.state();
    expect(state.repo).toBe(FIXTURE_REPO);
    expect(state.snapshot?.repo).toBe(FIXTURE_REPO);
    expect(state.error).toBeNull();
  });

  test("a chosen repository is read and remembered on this browser", async () => {
    const calls = service();
    await shipyardStore.choose("example-org/gadgets");
    expect(worldLocalStorage.getItem(SHIPYARD_REPO_KEY)).toBe(
      "example-org/gadgets",
    );
    expect(calls[calls.length - 1]?.path).toBe(
      "/api/world/shipyard?repo=example-org%2Fgadgets",
    );
    expect(shipyardStore.state().snapshot?.repo).toBe("example-org/gadgets");
    expect(() => shipyardStore.choose("not a repository")).toThrow();
  });

  test("Read GitHub again asks the service to refresh", async () => {
    const calls = service();
    await shipyardStore.read(true);
    expect(calls[calls.length - 1]).toEqual({
      path: `/api/world/shipyard/refresh?repo=${encodeURIComponent(FIXTURE_REPO)}`,
      method: "POST",
    });
  });

  test("a slower earlier read never overwrites a newer choice", async () => {
    let release = () => {};
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    let first = true;
    service((call) => {
      if (call.path.includes("repo=") && first) {
        first = false;
        return slow;
      }
      return undefined;
    });
    const before = shipyardStore.read();
    await shipyardStore.choose("example-org/gadgets");
    expect(shipyardStore.state().snapshot?.repo).toBe("example-org/gadgets");
    release();
    await before;
    expect(shipyardStore.state().repo).toBe("example-org/gadgets");
    expect(shipyardStore.state().snapshot?.repo).toBe("example-org/gadgets");
  });

  test("a failed read says so", async () => {
    shipyardStore.useFetch(async () =>
      Response.json({ error: "Shipyard is busy" }, { status: 503 }),
    );
    await shipyardStore.read();
    expect(shipyardStore.state().error).toBeTruthy();
  });

  test("a stored name that is no longer a repository falls back", () => {
    const catalog = shipyardFixtureCatalog("ready", NOW);
    expect(pickRepo("not a repository", catalog)).toBe(FIXTURE_REPO);
    expect(pickRepo("example-org/other", catalog)).toBe("example-org/other");
    expect(pickRepo(null, shipyardFixtureCatalog("empty", NOW))).toBeNull();
  });
});
