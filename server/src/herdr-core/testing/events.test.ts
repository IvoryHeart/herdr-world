import { expect, jest, test } from "bun:test";
import { notifyCoreFixtureChange, until } from "./events";

test("a core event during an asynchronous predicate is retained", async () => {
  let ready = false;
  const gate = Promise.withResolvers<void>();
  let reads = 0;
  const observed = until(async () => {
    if (++reads === 1) await gate.promise;
    return ready;
  });
  ready = true;
  notifyCoreFixtureChange();
  gate.resolve();
  await observed;
  expect(reads).toBeGreaterThan(0);
});

test("an absent core event reaches its failure bound and removes the listener", async () => {
  jest.useFakeTimers();
  try {
    let reads = 0;
    const observed = until(() => {
      reads++;
      return false;
    });
    await Promise.resolve();
    jest.advanceTimersByTime(3000);
    await expect(observed).rejects.toThrow("condition not reached");
    const before = reads;
    notifyCoreFixtureChange();
    expect(reads).toBe(before);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
