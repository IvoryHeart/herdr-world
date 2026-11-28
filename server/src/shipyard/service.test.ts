import { expect, test } from "bun:test";
import { SHIPYARD_LIMITS as L } from "../../../shared/shipyard";
import { ShipyardService } from "./service";
import { githubFixture } from "./testing/fixture";
import type { RunProcess } from "../sources/github";
import type { OpenProjects } from "./projects";

function setup(
  run?: RunProcess,
  waitMs?: number,
  projects: OpenProjects = {
    projects: [{ repo: "example-org/widgets", name: "widgets", rooms: 1 }],
    pending: 0,
    omitted: 0,
  },
) {
  const fixture = githubFixture();
  let now = 100_000,
    enabled = true,
    generation = 0;
  const service = new ShipyardService({
    run: run ?? fixture.run,
    now: () => now,
    source: () => ({ enabled, generation }),
    projects: async () => projects,
    instances: () => ({ items: [], complete: true, detail: null }),
    waitMs,
  });
  return {
    service,
    fixture,
    advance: (ms: number) => {
      now += ms;
    },
    disable: () => {
      enabled = false;
      generation++;
    },
    enable: () => {
      enabled = true;
      generation++;
    },
  };
}

test("cache shares reads, applies cadence and returns defensive copies", async () => {
  const { service, fixture, advance } = setup();
  const a = await service.snapshot("Example-Org/Widgets");
  const count = fixture.calls.length;
  a.data!.releases.items.splice(0);
  expect(
    (await service.snapshot("example-org/widgets", true)).data!.releases.items
      .length,
  ).toBe(2);
  expect(fixture.calls.length).toBe(count);
  advance(L.forcedRefreshMs);
  await service.snapshot("example-org/widgets", true);
  expect(fixture.calls.length).toBe(count * 2);
  advance(L.refreshMs);
  expect(service.current("example-org/widgets").state).toBe("stale");
  service.close();
});

test("failed refresh retains last-success data as stale with safe guidance", async () => {
  let fail = false;
  const fixture = githubFixture();
  const { service, advance } = setup((argv, timeout) =>
    fail
      ? Promise.resolve({
          code: 1,
          stdout: "",
          stderr: "private credential text",
        })
      : fixture.run(argv, timeout),
  );
  const first = await service.snapshot("example-org/widgets");
  fail = true;
  advance(L.forcedRefreshMs);
  const last = await service.snapshot("example-org/widgets", true);
  expect(last.state).toBe("stale");
  expect(last.data).toEqual(first.data);
  expect(last.lastSuccessAt).toBe(first.lastSuccessAt);
  expect(last.checkedAt).toBeGreaterThan(first.checkedAt!);
  expect(JSON.stringify(last)).not.toContain("private credential");
  service.close();
});

test("reads run several at once, within the bound, and disabled generations fence late replies", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = githubFixture();
  // Every read starts by checking the sign-in, then waits here.
  let started = 0;
  const { service, disable, enable } = setup(async (argv, timeout) => {
    if (argv[1] === "auth") started++;
    await gate;
    return fixture.run(argv, timeout);
  }, 0);
  const pending = await service.snapshot("example-org/widgets");
  expect(pending.refreshing).toBe(true);
  await service.snapshot("example-org/widgets", true);
  const names = Array.from(
    { length: L.concurrentReads + 2 },
    (_, index) => `example-org/other-${index}`,
  );
  for (const name of names) {
    const other = await service.snapshot(name);
    // Each repository is reading (or waiting for a slot) on its own.
    expect(other.refreshing).toBe(true);
    expect(other.retryAfterMs).toBeGreaterThan(0);
  }
  // Let every started read reach its first GitHub call.
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(started).toBe(L.concurrentReads);
  disable();
  expect(service.current("example-org/widgets").state).toBe("disabled");
  enable();
  release();
  await service.snapshot("example-org/widgets");
  expect(service.current("example-org/widgets").data).toBeNull();
  const current = await service.snapshot("example-org/widgets");
  expect(current.state).toBe("fresh");
  service.close();
});

test("the catalog is the open projects, every one, with no silent cut-off", async () => {
  const many = Array.from({ length: 15 }, (_, index) => ({
    repo: `example-org/project-${String(index).padStart(2, "0")}`,
    name: `project-${index}`,
    rooms: 1,
  }));
  const { service } = setup(undefined, undefined, {
    projects: [
      ...many,
      { repo: null, name: "scratch", rooms: 2 },
      { repo: "Example-Org/Zebra", name: "Zebra", rooms: 1 },
    ],
    pending: 1,
    omitted: 3,
  });
  // A pipeline read earlier is not a lane: only open projects are.
  await service.snapshot("example-org/elsewhere");
  const catalog = await service.catalog();
  expect(catalog.repositories).toHaveLength(16);
  expect(catalog.repositories.at(-1)).toBe("example-org/zebra");
  expect(catalog.repositories).not.toContain("example-org/elsewhere");
  expect(catalog.projects.find((p) => !p.repo)?.name).toBe("scratch");
  expect(catalog.pending).toBe(1);
  expect(catalog.omitted).toBe(3);
  service.close();
});

test("repository cache is bounded and unsupported names never reach gh", async () => {
  const { service, fixture } = setup();
  for (let index = 0; index < L.pipelines + 2; index++)
    await service.snapshot(`example-org/repo-${index}`);
  expect(service.current("example-org/repo-0").data).toBeNull();
  const count = fixture.calls.length;
  for (const value of [
    "--help",
    "https://github.com/example-org/widgets",
    "a/..",
    "a/r?host=evil",
    "a/r\nquery",
    "a/b/c",
  ]) {
    await expect(service.snapshot(value)).rejects.toThrow("Repository");
  }
  expect(fixture.calls.length).toBe(count);
  service.close();
});

test("a burst past the bound admits no pipeline while every held one is reading", async () => {
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = githubFixture();
  const repos = new Set<string>();
  const { service } = setup(async (argv, timeoutMs) => {
    const repo = argv.join(" ").match(/repos\/([^/\s]+\/[^/?\s]+)/u)?.[1];
    if (repo) repos.add(repo);
    await hold;
    return fixture.run(argv, timeoutMs);
  }, 0);
  const asked = Array.from(
    { length: L.pipelines + 2 },
    (_, index) => `example-org/repo-${index}`,
  );
  const first = await Promise.all(asked.map((repo) => service.snapshot(repo)));
  // The two past the bound wait their turn, asking again soon, unread.
  for (const snapshot of first.slice(-2)) {
    expect(snapshot.refreshing).toBe(true);
    expect(snapshot.retryAfterMs).toBe(L.waitMs);
    expect(snapshot.detail).toContain("waits its turn");
  }
  release();
  // Every admitted read has landed once nothing is refreshing.
  for (
    let index = 0;
    index < 200 && asked.some((repo) => service.current(repo).refreshing);
    index++
  )
    await new Promise((resolve) => setImmediate(resolve));
  expect(repos.size).toBe(L.pipelines);
  expect(repos.has(asked.at(-1)!)).toBe(false);
  expect(service.current(asked.at(-1)!).data).toBeNull();
  // Once reads finish, the waiting one takes a finished one's place.
  await service.snapshot(asked.at(-1)!);
  expect(service.current(asked[0]!).data).toBeNull();
  service.close();
});
