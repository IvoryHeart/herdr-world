import { afterEach, describe, expect, test } from "bun:test";
import { worldLocalStorage } from "../../browserStorage";
import {
  FIXTURE_REPO,
  shipyardFixtureCatalog,
  shipyardFixtureSnapshot,
} from "./shipyardFixture";
import {
  pickRepo,
  SHIPYARD_REPO_KEY,
  shipyardLanes,
  shipyardStore,
} from "./shipyardStore";

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
  test("reads the catalog, then every suggested repository, the chosen first", async () => {
    const calls = service();
    await shipyardStore.read();
    const repos = shipyardFixtureCatalog("ready", NOW).repositories;
    expect(repos[0]).toBe(FIXTURE_REPO);
    expect(calls).toEqual([
      { path: "/api/world/shipyard", method: "GET" },
      ...repos.map((repo) => ({
        path: `/api/world/shipyard?repo=${encodeURIComponent(repo)}`,
        method: "GET",
      })),
    ]);
    const state = shipyardStore.state();
    expect(state.repo).toBe(FIXTURE_REPO);
    expect(state.snapshot?.repo).toBe(FIXTURE_REPO);
    expect(Object.keys(state.snapshots).sort()).toEqual([...repos].sort());
    expect(state.error).toBeNull();
  });

  test("a lane whose read fails keeps its last answer; the chosen one decides", async () => {
    service();
    await shipyardStore.read();
    const other = shipyardFixtureCatalog("ready", NOW).repositories[1]!;
    const before = shipyardStore.state().snapshots[other];
    expect(before).toBeDefined();
    let failChosen = false;
    shipyardStore.useFetch(async (input) => {
      const url = new URL(String(input), "http://fixture.invalid");
      const repo = url.searchParams.get("repo");
      if (repo === other || (failChosen && repo === FIXTURE_REPO))
        return Response.json({ error: "busy" }, { status: 503 });
      return Response.json(
        repo
          ? shipyardFixtureSnapshot("ready", NOW, repo)
          : shipyardFixtureCatalog("ready", NOW),
      );
    });
    await shipyardStore.read();
    expect(shipyardStore.state().error).toBeNull();
    expect(shipyardStore.state().snapshots[other]).toBe(before!);
    // Kept, but known to be old (TownShipyard reads it as out of date).
    expect(shipyardStore.state().laneErrors[other]).toBeTruthy();
    expect(shipyardStore.state().laneErrors[FIXTURE_REPO]).toBeUndefined();
    failChosen = true;
    await shipyardStore.read();
    expect(shipyardStore.state().error).toBeTruthy();
  });

  test("a chosen repository the catalog no longer suggests keeps its lane", () => {
    const catalog = shipyardFixtureCatalog("ready", NOW);
    expect(shipyardLanes(catalog, FIXTURE_REPO)).toEqual(catalog.repositories);
    expect(shipyardLanes(catalog, "example-org/other")).toEqual([
      "example-org/other",
      ...catalog.repositories,
    ]);
  });

  test("a chosen repository is read and remembered on this browser", async () => {
    const calls = service();
    await shipyardStore.choose("example-org/gadgets");
    expect(worldLocalStorage.getItem(SHIPYARD_REPO_KEY)).toBe(
      "example-org/gadgets",
    );
    // The chosen repository is read first, after the catalog.
    expect(calls[1]?.path).toBe(
      "/api/world/shipyard?repo=example-org%2Fgadgets",
    );
    expect(shipyardStore.state().snapshot?.repo).toBe("example-org/gadgets");
    expect(() => shipyardStore.choose("not a repository")).toThrow();
  });

  test("Read GitHub again asks the service to refresh", async () => {
    const calls = service();
    await shipyardStore.read(true);
    // Only the chosen repository is refreshed; other lanes read as they are.
    expect(calls.filter((call) => call.method === "POST")).toEqual([
      {
        path: `/api/world/shipyard/refresh?repo=${encodeURIComponent(FIXTURE_REPO)}`,
        method: "POST",
      },
    ]);
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

describe("the offline testing switch", () => {
  test("answers once, then every read fails and the view goes old", async () => {
    const { resetShipyardFixture } = await import("./shipyardFixture");
    const { shipyardView } = await import("./shipyardModel");
    const page = globalThis as unknown as Record<string, unknown>;
    const saved = { location: page.location, history: page.history };
    page.location = { href: "http://world.invalid/?shipyardFixture=offline" };
    page.history = { state: null, replaceState: () => {} };
    try {
      resetShipyardFixture();
      shipyardStore.reset();
      shipyardStore.useFetch(null);
      await shipyardStore.read();
      expect(shipyardStore.state().error).toBeNull();
      expect(shipyardView(shipyardStore.state()).status).toBe("open");
      await shipyardStore.read(true);
      const state = shipyardStore.state();
      expect(state.error).toBe("Failed to fetch");
      expect(state.snapshot).not.toBeNull();
      const view = shipyardView(state);
      if (view.status !== "open") throw new Error(view.status);
      expect(view.stale).toBe(true);
      expect(view.running.some((entry) => entry.openUrl)).toBe(false);
    } finally {
      page.location = saved.location;
      page.history = saved.history;
      resetShipyardFixture();
      shipyardStore.reset();
    }
  });
});
