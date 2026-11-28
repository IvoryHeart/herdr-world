import { expect, test } from "bun:test";
import { unitSchedule } from "./ci-unit-schedule";

const job = {
  "runs-on": "ubuntu-latest",
  needs: "validation-scope",
  env: { HERDR_TEST_PARALLEL: "4" },
  strategy: { "fail-fast": false, matrix: { shard: [1, 2, 3, 4] } },
  steps: [
    { run: "bun install --frozen-lockfile" },
    { run: "bun scripts/ci-tests.ts unit ${{ matrix.shard }}/4" },
    { run: "bun scripts/ci-unit-comparison.ts run ${{ matrix.shard }}/4" },
  ],
};

test("packing static/web work after units preserves the proven unit schedule", () => {
  const combined = {
    ...job,
    strategy: {
      ...job.strategy,
      matrix: {
        include: job.strategy.matrix.shard.map((shard) => ({
          shard,
          group: "types",
          web: 1,
        })),
      },
    },
    steps: [
      ...job.steps,
      { run: "bun run check:static" },
      { run: "bun scripts/ci-tests.ts web 1/2" },
    ],
  };
  expect(unitSchedule(combined)).toBe(unitSchedule(job));
});

test("every unit execution input still selects twenty comparison pairs", () => {
  for (const changed of [
    { ...job, env: { HERDR_TEST_PARALLEL: "8" } },
    { ...job, strategy: { ...job.strategy, matrix: { shard: [1, 2, 3] } } },
    { ...job, strategy: { ...job.strategy, "max-parallel": 1 } },
    { ...job, "runs-on": "windows-latest" },
    {
      ...job,
      steps: job.steps.map((step, index) =>
        index === 1 ? { run: step.run + " --changed" } : step,
      ),
    },
    { ...job, steps: [{ run: "change unit environment" }, ...job.steps] },
  ]) {
    expect(unitSchedule(changed)).not.toBe(unitSchedule(job));
  }
});
