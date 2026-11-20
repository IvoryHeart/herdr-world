import { expect, test } from "bun:test";
import { SHIPYARD_LIMITS as L } from "../../../shared/shipyard";
import { ShipyardService } from "./service";
import { githubFixture } from "./testing/fixture";
import type { RunProcess } from "../sources/github";

function setup(run?: RunProcess, waitMs?: number) {
  const fixture = githubFixture();
  let now = 100_000,
    enabled = true,
    generation = 0;
  const service = new ShipyardService({
    run: run ?? fixture.run,
    now: () => now,
    source: () => ({
      enabled,
      generation,
      repositories: ["Example-Org/Widgets"],
    }),
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

test("single flight bounds concurrency, and disabled generations fence late replies", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = githubFixture();
  let calls = 0;
  const { service, disable, enable } = setup(async (argv, timeout) => {
    calls++;
    await gate;
    return fixture.run(argv, timeout);
  }, 0);
  const pending = await service.snapshot("example-org/widgets");
  expect(pending.refreshing).toBe(true);
  await service.snapshot("example-org/widgets", true);
  const other = await service.snapshot("example-org/other");
  expect(other.refreshing).toBe(false);
  expect(other.retryAfterMs).toBeGreaterThan(0);
  expect(calls).toBe(1);
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

test("repository cache is bounded and unsupported names never reach gh", async () => {
  const { service, fixture } = setup();
  for (let index = 0; index < L.repositories + 2; index++)
    await service.snapshot(`example-org/repo-${index}`);
  expect(service.current("example-org/repo-0").data).toBeNull();
  expect(service.catalog().repositories.length).toBeLessThanOrEqual(
    L.repositories,
  );
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
