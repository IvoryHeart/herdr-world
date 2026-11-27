import { expect, test } from "bun:test";
import { verificationModels } from "../quint/models";
import { verificationJobs, verificationJob } from "./ci-model-plan";

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
