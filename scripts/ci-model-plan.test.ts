import { expect, test } from "bun:test";
import { verificationModels } from "../quint/models";
import {
  verificationJobs,
  verificationJob,
  verificationGroups,
  verificationGroup,
  modelPartSeconds,
  modelPartPeakMiB,
  MODEL_GROUP_MEMORY_MIB,
  MODEL_GROUP_WORKERS,
  simulateModelGroup,
} from "./ci-model-plan";

test("four runners packed by peak memory and time execute every immutable model part exactly once", () => {
  expect(verificationGroups).toHaveLength(4);
  expect(MODEL_GROUP_WORKERS).toBe(4);
  expect(MODEL_GROUP_MEMORY_MIB).toBe(4096);
  expect(modelPartPeakMiB).toHaveLength(verificationJobs.length);
  expect(verificationGroups.flat().sort((a, b) => a - b)).toEqual(
    verificationJobs.map((_, i) => i + 1),
  );
  const pools = verificationGroups.map(simulateModelGroup);
  const longestPart = Math.max(...modelPartSeconds);
  for (const pool of pools) {
    // Concurrent parts never hold more than the group's cgroup memory...
    expect(pool.maxMiB).toBeLessThanOrEqual(MODEL_GROUP_MEMORY_MIB);
    // ...and every runner still finishes close to the single longest part.
    expect(pool.seconds).toBeLessThanOrEqual(longestPart + 15);
  }
  // No two of the four parts that peak near 2 GiB share a runner.
  const heavy = modelPartPeakMiB.flatMap((peak, i) =>
    peak >= 1700 ? [i + 1] : [],
  );
  expect(heavy).toHaveLength(4);
  expect(
    verificationGroups.map(
      (group) => group.filter((i) => heavy.includes(i)).length,
    ),
  ).toEqual([1, 1, 1, 1]);
  for (const group of verificationGroups)
    expect(group.map((i) => modelPartSeconds[i - 1])).toEqual(
      group.map((i) => modelPartSeconds[i - 1]).sort((a, b) => b! - a!),
    );
  for (const index of [0, 5, 1.5, NaN])
    expect(() => verificationGroup(index)).toThrow();
});

test("every model owns a job; heavy models retain all disjoint parts", () => {
  expect([...new Set(verificationJobs.map((job) => job.model))].sort()).toEqual(
    [...verificationModels].sort(),
  );
  expect(
    verificationJobs
      .filter((job) => job.model === "ide-lifecycle")
      .map((job) => job.part),
  ).toEqual(["replay", "checks-1", "checks-2", "checks-3"]);
  expect(
    verificationJobs
      .filter((job) => job.model === "herdr-core-runtime")
      .map((job) => job.part),
  ).toEqual(["replay", "controls-1", "controls-2", "controls-3"]);
  expect(
    verificationJobs.filter((job) => job.model === "observation-base"),
  ).toHaveLength(1);
  expect(new Set(verificationJobs.map((job) => job.id)).size).toBe(
    verificationJobs.length,
  );
  for (const index of [0, verificationJobs.length + 1, NaN])
    expect(() => verificationJob(index)).toThrow();
});
