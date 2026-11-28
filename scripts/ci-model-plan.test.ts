import { expect, test } from "bun:test";
import { verificationModels } from "../quint/models";
import {
  verificationJobs,
  verificationJob,
  verificationGroups,
  verificationGroup,
  modelPartSeconds,
  MODEL_GROUP_WORKERS,
  simulateModelGroup,
  modelGroupWaves,
  modelPartMemoryBytes,
  MODEL_GROUP_RESERVE_BYTES,
} from "./ci-model-plan";
import limits from "../tools/quint/model-resources.json";

test("every cache subset fits the shared memory envelope, including the hosted OOM group", () => {
  for (const indices of verificationGroups) {
    // Cache hits can remove any subset. Exhaust the actual admission plans.
    for (let mask = 0; mask < 2 ** indices.length; mask++) {
      const selected = indices.filter((_, bit) => mask & (1 << bit));
      const waves = modelGroupWaves(selected);
      expect(waves.flat().sort((a, b) => a - b)).toEqual(
        selected.toSorted((a, b) => a - b),
      );
      for (const wave of waves) {
        expect(wave.length).toBeLessThanOrEqual(MODEL_GROUP_WORKERS);
        expect(
          MODEL_GROUP_RESERVE_BYTES +
            wave.reduce((sum, index) => sum + modelPartMemoryBytes(index), 0),
        ).toBeLessThanOrEqual(limits.memoryMaxBytes);
      }
    }
  }
  // Two ~2 GiB parts already exceed the envelope after headroom; a fixed
  // two-worker pool would also be unsafe. These must run in separate waves.
  expect(modelGroupWaves([2, 7, 8])).toEqual([[7], [2], [8]]);
  expect(modelGroupWaves(verificationGroup(4)).length).toBeGreaterThan(1);
  expect(
    Math.max(
      ...verificationGroups.flatMap((group) =>
        modelGroupWaves(group).map((wave) => wave.length),
      ),
    ),
  ).toBe(4);
  expect(() => modelGroupWaves([1, 1])).toThrow("Duplicate model part");
  expect(() => modelGroupWaves([28])).toThrow("Invalid verification shard");
});

test("four memory-packed runners balance wave wall time and execute every immutable model part exactly once", () => {
  expect(verificationGroups).toHaveLength(4);
  expect(MODEL_GROUP_WORKERS).toBe(4);
  expect(verificationGroups.flat().sort((a, b) => a - b)).toEqual(
    verificationJobs.map((_, i) => i + 1),
  );
  const loads = verificationGroups.map(
    (indices, group) =>
      simulateModelGroup(indices).seconds + (group === 0 ? 18 : 0),
  );
  expect(Math.max(...loads)).toBeLessThanOrEqual(220);
  expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(30);
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
