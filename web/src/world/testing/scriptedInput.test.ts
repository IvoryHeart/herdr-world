import { expect, test } from "bun:test";
import {
  scriptedInput,
  SCRIPTED_INPUT_COUNT,
  nativeInputMode,
} from "./scriptedInput";

test("behaviour input is finite, ordered and gated by delivery rather than elapsed time", async () => {
  const first = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<void>();
  const seen: number[] = [];
  const running = scriptedInput(async (sequence) => {
    seen.push(sequence);
    if (sequence === 0) {
      entered.resolve();
      await first.promise;
    }
  });
  await entered.promise;
  expect(seen).toEqual([0]);
  first.resolve();
  await running;
  expect(seen).toEqual(
    Array.from({ length: SCRIPTED_INPUT_COUNT }, (_, i) => i),
  );
  expect(seen).toHaveLength(16);
});

test("a failed delivery stops the behaviour workload and remains a failure", async () => {
  const failure = new Error("synthetic delivery failure");
  const seen: number[] = [];
  await expect(
    scriptedInput(async (sequence) => {
      seen.push(sequence);
      if (sequence === 1) throw failure;
    }),
  ).rejects.toBe(failure);
  expect(seen).toEqual([0, 1]);
});

test("functional runs use finite input while native measurement retains the independent cadence", () => {
  expect(nativeInputMode({})).toBe("scripted");
  expect(
    nativeInputMode({ WORLD_LATENCY_TREND_FILE: "/synthetic/latency.jsonl" }),
  ).toBe("independent");
  expect(nativeInputMode({ WORLD_TRACE_PREFIX: "/synthetic/trace" })).toBe(
    "independent",
  );
});
