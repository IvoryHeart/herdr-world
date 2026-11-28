import { expect, test } from "bun:test";
import { runVerificationPool } from "./verification-pool";

test("worker resources span multiple cases, retire before success, and fail closed on cleanup", async () => {
  let opened = 0;
  let retired = 0;
  const resources = new Map<number, number>();
  const result = await runVerificationPool(
    [0, 1, 2, 3],
    2,
    new AbortController().signal,
    async (item) => {
      resources.set(item, opened);
      return item;
    },
    async (work) => {
      opened++;
      try {
        await work();
      } finally {
        retired++;
      }
    },
  );
  expect(result).toEqual([0, 1, 2, 3]);
  expect(opened).toBe(2);
  expect(retired).toBe(2);
  expect(resources.size).toBe(4);
  await expect(
    runVerificationPool(
      [0],
      1,
      new AbortController().signal,
      async () => 1,
      async (work) => {
        await work();
        throw new Error("Synthetic retirement failure");
      },
    ),
  ).rejects.toThrow("Synthetic retirement failure");
});

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

test("failure stops admission while a worker resource is still retiring", async () => {
  const gate = Promise.withResolvers<void>();
  const retirement = Promise.withResolvers<void>();
  const started: number[] = [];
  let aborted = false;
  const pending = runVerificationPool(
    [0, 1, 2],
    2,
    new AbortController().signal,
    async (item, signal) => {
      started.push(item);
      if (item === 0) {
        await gate.promise;
        throw new Error("Synthetic command failure");
      }
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            retirement.resolve();
            resolve();
          },
          { once: true },
        ),
      );
      signal.throwIfAborted();
    },
    async (work) => {
      try {
        await work();
      } finally {
        await retirement.promise;
      }
    },
  );
  gate.resolve();
  await expect(pending).rejects.toThrow("Synthetic command failure");
  expect(aborted).toBe(true);
  expect(started).toEqual([0, 1]);
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

test("memory admission starts items in order only while their weights fit, and a lone item always starts", async () => {
  const gates = new Map<number, PromiseWithResolvers<void>>();
  const started: number[] = [];
  let used = 0;
  let peak = 0;
  const weights = [3, 2, 2, 5, 1];
  const pending = runVerificationPool(
    [0, 1, 2, 3, 4],
    4,
    new AbortController().signal,
    async (item) => {
      started.push(item);
      used += weights[item]!;
      peak = Math.max(peak, used);
      const gate = Promise.withResolvers<void>();
      gates.set(item, gate);
      await gate.promise;
      used -= weights[item]!;
      return item;
    },
    undefined,
    { weight: (item) => weights[item]!, budget: 5 },
  );
  const turn = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };
  await turn();
  // 3 + 2 fit; the next 2 would exceed 5 and waits, holding later items back.
  expect(started).toEqual([0, 1]);
  gates.get(0)!.resolve();
  await turn();
  expect(started).toEqual([0, 1, 2]);
  gates.get(1)!.resolve();
  gates.get(2)!.resolve();
  await turn();
  // Over budget alone (5 of 5), it still starts once nothing else runs.
  expect(started).toEqual([0, 1, 2, 3]);
  gates.get(3)!.resolve();
  await turn();
  gates.get(4)!.resolve();
  expect(await pending).toEqual([0, 1, 2, 3, 4]);
  expect(peak).toBeLessThanOrEqual(5);
});

test("a worker waiting for memory stops when the pool fails", async () => {
  const pending = runVerificationPool(
    [0, 1],
    2,
    new AbortController().signal,
    async (item) => {
      if (item === 0) throw new Error("Synthetic part failure");
      return item;
    },
    undefined,
    { weight: () => 4, budget: 5 },
  );
  await expect(pending).rejects.toThrow("Synthetic part failure");
});
