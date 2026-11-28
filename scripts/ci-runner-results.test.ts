import { expect, test } from "bun:test";
import {
  aggregateRunnerResults,
  type RunnerResults,
} from "./ci-runner-results";

function passing(web = true): RunnerResults[] {
  return [1, 2, 3, 4].map((shard) => ({
    shard,
    unit: "success",
    static: shard > 1 ? "success" : "skipped",
    security: shard === 4 ? "success" : "skipped",
    web: web && shard < 3 ? "success" : "skipped",
  }));
}

test("combined runners report independent unit, static, security and web verdicts", () => {
  const results = passing();
  results[1]!.web = "failure";
  expect(aggregateRunnerResults(results, true)).toEqual({
    unit: "success",
    static: "success",
    security: "success",
    web: "failure",
  });
  results[1]!.web = "success";
  results[2]!.unit = "failure";
  expect(aggregateRunnerResults(results, true)).toEqual({
    unit: "failure",
    static: "success",
    security: "success",
    web: "success",
  });
  expect(aggregateRunnerResults(passing(false), false).web).toBe("skipped");
});

test("missing, duplicate, foreign or malformed runner evidence cannot pass", () => {
  const results = passing();
  for (const invalid of [
    results.slice(1),
    [...results, results[0]!],
    [{ ...results[0]!, shard: 5 }, ...results.slice(1)],
  ])
    expect(() => aggregateRunnerResults(invalid, true)).toThrow();
  for (const lane of ["unit", "static", "security", "web"] as const) {
    const shard = lane === "security" ? 3 : 1;
    for (const outcome of ["skipped", "cancelled", "failure"])
      expect(
        aggregateRunnerResults(
          results.map((row, index) =>
            index === shard ? { ...row, [lane]: outcome } : row,
          ),
          true,
        )[lane],
      ).toBe("failure");
    expect(() =>
      aggregateRunnerResults(
        results.map((row, index) =>
          index === shard ? { ...row, [lane]: "unknown" } : row,
        ),
        true,
      ),
    ).toThrow();
  }
  expect(() =>
    aggregateRunnerResults(
      results.map((row, index) =>
        index === 0 ? { ...row, static: "success" } : row,
      ),
      true,
    ),
  ).toThrow();
});
