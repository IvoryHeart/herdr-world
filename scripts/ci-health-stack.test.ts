import { expect, test } from "bun:test";
import { runCost } from "./ci-health-stack";
import type { Job, Run } from "./ci-health-github";

test("runner cost sums overlapping execution while result latency includes queues", () => {
  const run = {
    created_at: "2026-11-19T12:00:00Z",
    updated_at: "2026-11-19T12:10:00Z",
  } as Run;
  const job = {
    conclusion: "success",
    started_at: "2026-11-19T12:03:00Z",
    completed_at: "2026-11-19T12:05:00Z",
  } as Job;
  expect(runCost(run, [job, job, { conclusion: "skipped" } as Job])).toEqual({
    jobs: 2,
    runnerMinutes: 4,
    resultMinutes: 10,
  });
  expect(() => runCost(run, [{ ...job, completed_at: null }])).toThrow(
    "Incomplete job timing",
  );
});
