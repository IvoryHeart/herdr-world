import { expect, test } from "bun:test";
import { runVerificationPool } from "./verification-pool";

test("bounded workers overlap cases, retain result order and execute every case once", async () => {
  const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
  let active = 0;
  let peak = 0;
  const started: number[] = [];
  const pending = runVerificationPool(
    [0, 1, 2, 3],
    2,
    new AbortController().signal,
    async (item) => {
      active++;
      peak = Math.max(peak, active);
      started.push(item);
      if (item < 2) await gates[item]!.promise;
      active--;
      return item * 2;
    },
  );
  await Promise.resolve();
  expect(started).toEqual([0, 1]);
  gates[1]!.resolve();
  gates[0]!.resolve();
  expect(await pending).toEqual([0, 2, 4, 6]);
  expect(peak).toBe(2);
  expect(new Set(started).size).toBe(4);
});
test("a worker failure cancels and drains peers without starting queued cases", async () => {
  const fail = Promise.withResolvers<void>();
  const started: number[] = [];
  let drained = false;
  const pending = runVerificationPool(
    [0, 1, 2],
    2,
    new AbortController().signal,
    async (item, signal) => {
      started.push(item);
      if (item === 0) {
        await fail.promise;
        throw new Error("Synthetic model failure");
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      drained = true;
      signal.throwIfAborted();
    },
  );
  fail.resolve();
  await expect(pending).rejects.toThrow("Synthetic model failure");
  expect(started).toEqual([0, 1]);
  expect(drained).toBe(true);
});
test("external cancellation cannot complete a partial verification pool", async () => {
  const control = new AbortController();
  let drained = 0;
  const pending = runVerificationPool(
    [0, 1, 2],
    2,
    control.signal,
    async (_, signal) => {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      drained++;
      signal.throwIfAborted();
    },
  );
  control.abort(new Error("Synthetic cancellation"));
  await expect(pending).rejects.toThrow("Synthetic cancellation");
  expect(drained).toBe(2);
  await expect(
    runVerificationPool([0], 0, control.signal, async () => 0),
  ).rejects.toThrow("Invalid verification worker count");
});
