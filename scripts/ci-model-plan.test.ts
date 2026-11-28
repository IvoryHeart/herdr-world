import { expect, test } from "bun:test";
import { verificationModels } from "../quint/models";
import {
  verificationJobs,
  verificationJob,
  verificationGroups,
  verificationGroup,
  modelPartSeconds,
  MODEL_GROUP_WORKERS,
} from "./ci-model-plan";

test("four time-packed runners execute every immutable model part exactly once", () => {
  expect(verificationGroups).toHaveLength(4);
  expect(MODEL_GROUP_WORKERS).toBe(4);
  expect(verificationGroups.flat().sort((a, b) => a - b)).toEqual(
    verificationJobs.map((_, i) => i + 1),
  );
  const loads = verificationGroups.map((indices) =>
    indices.reduce((sum, i) => sum + modelPartSeconds[i - 1]!, 0),
  );
  expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(15);
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
  ).toEqual(["replay", "controls-1", "controls-2"]);
  expect(
    verificationJobs.filter((job) => job.model === "observation-base"),
  ).toHaveLength(1);
  expect(new Set(verificationJobs.map((job) => job.id)).size).toBe(
    verificationJobs.length,
  );
  for (const index of [0, verificationJobs.length + 1, NaN])
    expect(() => verificationJob(index)).toThrow();
});
