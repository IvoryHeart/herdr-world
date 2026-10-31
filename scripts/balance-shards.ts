import assert from "node:assert/strict";

/** Longest measured cases first, assigned to the least-loaded shard. */
export function balanceShards<T extends string>(
  items: readonly T[],
  seconds: Record<T, number>,
  count: number,
): T[][] {
  assert(Number.isInteger(count) && count > 0, "Invalid shard count");
  assert(new Set(items).size === items.length, "Duplicate shard input");
  for (const item of items)
    assert(
      Number.isFinite(seconds[item]) && seconds[item] > 0,
      `Missing measured duration: ${item}`,
    );
  const shards: T[][] = Array.from({ length: count }, () => []);
  const loads = Array<number>(count).fill(0);
  for (const item of [...items].sort((a, b) => seconds[b] - seconds[a])) {
    const index = loads.indexOf(Math.min(...loads));
    shards[index]!.push(item);
    loads[index]! += seconds[item];
  }
  return shards;
}
