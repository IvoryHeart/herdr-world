import { expect, test } from "bun:test";
import { createCodexDiscoveryCache } from "./codex-discovery-cache";

test("unavailability backs off for 60 seconds; successful reads are never retained", async () => {
  let now = 0;
  let calls = 0;
  const cache = createCodexDiscoveryCache(
    { connectionId: "example", generation: 1 },
    () => now,
  );
  const fetch = async () => {
    calls++;
    return calls === 1 ? null : [];
  };
  expect(await cache.read("/work/a", "pane", fetch)).toBeNull();
  expect(await cache.read("/work/b", "changed", fetch)).toBeNull();
  expect(calls).toBe(1);
  now = 60_000;
  expect(await cache.read("/work/a", "pane", fetch)).toEqual([]);
  await cache.read("/work/a", "pane", fetch);
  expect(calls).toBe(3);
});

test("only identical in-flight evidence shares a read; generations and connections stay isolated", async () => {
  const first = createCodexDiscoveryCache({
    connectionId: "one",
    generation: 1,
  });
  const next = createCodexDiscoveryCache({
    connectionId: "one",
    generation: 2,
  });
  const other = createCodexDiscoveryCache({
    connectionId: "two",
    generation: 1,
  });
  const finish: Array<(value: null) => void> = [];
  const fetch = () => new Promise<null>((resolve) => finish.push(resolve));
  const a = first.read("/work/a", "pane", fetch);
  expect(first.read("/work/a", "pane", fetch)).toBe(a);
  const changed = first.read("/work/a", "changed", fetch);
  const b = next.read("/work/a", "pane", fetch);
  const c = other.read("/work/a", "pane", fetch);
  await Promise.resolve();
  expect(finish).toHaveLength(4);
  first.clear();
  for (const resolve of finish) resolve(null);
  await Promise.all([a, changed, b, c]);
  expect(await first.read("/work/a", "pane", async () => [])).toEqual([]);
  expect(await next.read("/work/a", "pane", async () => [])).toBeNull();
});
