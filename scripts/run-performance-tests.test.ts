import { expect, test } from "bun:test";
import { runPerformanceTests } from "./run-performance-tests";
import {
  worldBrowserSuites,
  worldPerformanceSuites,
  worldBrowserIgnorePattern,
} from "./world-browser-suites";

test("every native budget runs three times, each after quiet admission, outside behaviour shards", async () => {
  const events: string[] = [];
  const files: string[][] = [];
  expect(
    await runPerformanceTests({
      quiet: async () => {
        events.push("quiet");
        return { quiet: true };
      },
      run: async (selected, iteration) => {
        events.push(`sample-${iteration}`);
        files.push(selected);
        return 0;
      },
    }),
  ).toBe(0);
  expect(events).toEqual([
    "quiet",
    "sample-1",
    "quiet",
    "sample-2",
    "quiet",
    "sample-3",
  ]);
  expect(files).toEqual(
    Array.from({ length: 3 }, () => worldPerformanceSuites),
  );
  expect(worldPerformanceSuites).toContain(
    "web/src/world/town/TownFrameBudget.browser.test.ts",
  );
  for (const path of worldPerformanceSuites) {
    expect(worldBrowserSuites).not.toContain(path);
    expect(new Bun.Glob(worldBrowserIgnorePattern).match(path)).toBe(true);
  }
});

test("a busy setup refuses measurement, and a failed budget is never retried or averaged away", async () => {
  let runs = 0;
  await expect(
    runPerformanceTests({
      quiet: async () => ({ quiet: false }),
      run: async () => ++runs,
    }),
  ).rejects.toThrow("remained busy");
  expect(runs).toBe(0);
  expect(
    await runPerformanceTests({
      quiet: async () => ({ quiet: true }),
      run: async () => {
        runs++;
        return 7;
      },
    }),
  ).toBe(7);
  expect(runs).toBe(1);
});
