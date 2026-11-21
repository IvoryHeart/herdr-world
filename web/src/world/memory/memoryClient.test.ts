import { afterEach, expect, test } from "bun:test";
import type { MemoryCatalog, MemoryTarget } from "../../../../shared/memory";
import {
  MEMORY_CATALOG_FRESH_MS,
  memoryCatalogState,
  memoryClientOver,
  memoryErrorCode,
  memoryErrorText,
  memoryHosts,
  publishMemoryHosts,
  requestMemoryCatalog,
  setMemoryClientForTests,
  type MemoryClient,
} from "./memoryClient";
import {
  MEMORY_FIXTURE_TARGET,
  memoryFixtureClient,
  memoryFixtureTouch,
  setMemoryFixtureForTests,
} from "./memoryFixture";
import { townLibraryCounts, townLibrarySignText } from "../town/TownLibrary";

afterEach(() => {
  setMemoryClientForTests(null);
  setMemoryFixtureForTests(undefined);
});

const host = (generation: number) => ({
  connection_id: "c1",
  connection_generation: generation,
  label: "Example host",
  names: {},
});

test("every call names its connection and generation; writes say who asked", async () => {
  const calls: [string, Record<string, unknown>][] = [];
  const client = memoryClientOver(async (action, params) => {
    calls.push([action, params]);
    return action === "list"
      ? { projects: [], agents: [], sources: [], entries: [] }
      : {};
  });
  const at: MemoryTarget = { connection_id: "c1", connection_generation: 7 };
  await client.list(at);
  await client.search(at, "tests", { agent_id: "p1" });
  await client.read(at, "s1", "a.md");
  await client.create(at, "s1", "b.md", "hi");
  await client.update(at, "s1", "a.md", "r2", "new");
  await client.remove(at, "s1", "a.md", "r3");
  const where = { connection_id: "c1", connection_generation: 7 };
  expect(calls).toEqual([
    ["list", where],
    ["search", { ...where, query: "tests", agent_id: "p1" }],
    ["read", { ...where, source_id: "s1", path: "a.md" }],
    [
      "create",
      {
        ...where,
        source_id: "s1",
        path: "b.md",
        content: "hi",
        user_action: true,
      },
    ],
    [
      "update",
      {
        ...where,
        source_id: "s1",
        path: "a.md",
        revision: "r2",
        content: "new",
        user_action: true,
      },
    ],
    [
      "delete",
      {
        ...where,
        source_id: "s1",
        path: "a.md",
        revision: "r3",
        user_action: true,
        confirmed: true,
      },
    ],
  ]);
});

test("a list reply that is not a catalog fails the read, not the views", async () => {
  for (const reply of [{}, null, "ok", { entries: [] }]) {
    const client = memoryClientOver(async () => reply);
    const at: MemoryTarget = { connection_id: "c1", connection_generation: 7 };
    const failed = await client.list(at).catch((error: unknown) => error);
    expect(memoryErrorCode(failed)).toBe("invalid");
  }
  setMemoryClientForTests(memoryClientOver(async () => ({})));
  publishMemoryHosts([host(3)]);
  await requestMemoryCatalog(host(3));
  expect(memoryCatalogState(host(3))?.status).toBe("failed");
  expect(townLibrarySignText(townLibraryCounts())).toBe("unavailable");
});

test("failures keep their code and read without it", () => {
  const conflict = new Error("conflict: The file changed");
  expect(memoryErrorCode(conflict)).toBe("conflict");
  expect(memoryErrorText(conflict)).toBe("The file changed");
  expect(memoryErrorCode(new Error("boom: no"))).toBeNull();
  expect(memoryErrorCode("plain")).toBeNull();
  expect(memoryErrorText(new Error("request timed out"))).toBe(
    "The host did not answer in time.",
  );
  expect(memoryErrorText(new Error(""))).toBe("Memory is unavailable.");
});

function counting(): MemoryClient & { lists: number; resolve(): void } {
  let release = () => {};
  const self = {
    lists: 0,
    resolve: () => release(),
    ...memoryClientOver(async () => ({})),
    list(target: MemoryTarget) {
      self.lists += 1;
      return new Promise<MemoryCatalog>((done) => {
        release = () => done({ ...target, observed_at: 1 } as MemoryCatalog);
      });
    },
  };
  return self;
}

test("a catalog is read once per freshness window; a forced read shares one under way", async () => {
  const client = counting();
  setMemoryClientForTests(client);
  publishMemoryHosts([host(1)]);
  const first = requestMemoryCatalog(host(1));
  const forced = requestMemoryCatalog(host(1), { force: true });
  expect(client.lists).toBe(1);
  expect(memoryCatalogState(host(1))!.status).toBe("loading");
  client.resolve();
  await Promise.all([first, forced]);
  expect(memoryCatalogState(host(1))!.status).toBe("ready");
  await requestMemoryCatalog(host(1));
  expect(client.lists).toBe(1);
  const later = requestMemoryCatalog(host(1), {
    now: Date.now() + MEMORY_CATALOG_FRESH_MS + 1,
  });
  expect(client.lists).toBe(2);
  client.resolve();
  await later;
});

test("a generation that went away drops its catalog and never answers", async () => {
  const client = counting();
  setMemoryClientForTests(client);
  publishMemoryHosts([host(1)]);
  const read = requestMemoryCatalog(host(1));
  // The connection restarts while the read is under way.
  publishMemoryHosts([host(2)]);
  expect(memoryCatalogState(host(1))).toBeNull();
  client.resolve();
  await read;
  expect(memoryCatalogState(host(1))).toBeNull();
  expect(memoryHosts().map((h) => h.connection_generation)).toEqual([2]);
});

test("the testing switch offers its synthetic host and mimics conflicts", async () => {
  setMemoryFixtureForTests(true);
  expect(memoryHosts()).toHaveLength(1);
  const client = memoryFixtureClient();
  const t = MEMORY_FIXTURE_TARGET;
  const opened = await client.read(t, "fx-web-memory", "testing.md");
  memoryFixtureTouch("fx-web-memory", "testing.md", "# Someone else\n");
  await expect(
    client.update(t, "fx-web-memory", "testing.md", opened.revision, "mine"),
  ).rejects.toThrow(/^conflict:/);
  await expect(client.read(t, "fx-reviewer-memory", "x.md")).rejects.toThrow(
    /^refused:/,
  );
  const latest = await client.read(t, "fx-web-memory", "testing.md");
  await client.remove(t, "fx-web-memory", "testing.md", latest.revision);
  await expect(client.read(t, "fx-web-memory", "testing.md")).rejects.toThrow(
    /^not_found:/,
  );
  const hits = await client.search(t, "release", { agent_id: "p2" });
  expect(hits.matches).toHaveLength(0);
});

test("unsupported-only preview hides the host without reading a real connection", async () => {
  setMemoryFixtureForTests(true, true);
  expect(memoryHosts()).toEqual([]);
  const catalog = await memoryFixtureClient().list(MEMORY_FIXTURE_TARGET);
  expect(catalog.agents.map((agent) => agent.harness)).toEqual(["letta"]);
  expect(catalog.sources).toEqual([]);
  expect(townLibraryCounts()).toEqual({ status: "none" });
});
