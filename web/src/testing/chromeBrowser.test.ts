import { expect, test } from "bun:test";
import {
  jobCpus,
  SHARED_CHROME_ENV,
  sharedChromeCount,
  sharedChromeEndpoints,
  testChromeFlags,
} from "./chromeBrowser";

test("the job's CPUs are its affinity, lowered by a cgroup CPU quota", () => {
  expect(jobCpus(() => "max 100000\n", 4)).toBe(4);
  expect(jobCpus(() => "200000 100000\n", 16)).toBe(2);
  expect(jobCpus(() => "150000 100000\n", 16)).toBe(2);
  expect(jobCpus(() => "800000 100000\n", 4)).toBe(4);
  expect(jobCpus(() => "10000 100000\n", 4)).toBe(1);
  expect(
    jobCpus(() => {
      throw new Error("no cgroup v2");
    }, 3),
  ).toBe(3);
});

test("test Chrome keeps raster threads within the job's CPUs", async () => {
  const flags = await testChromeFlags("chrome");
  const raster = flags.find((flag) => flag.startsWith("--num-raster-threads="));
  expect(Number(raster?.split("=")[1])).toBe(Math.min(4, jobCpus()));
});

test("a runner shares one Chrome per four job CPUs, at least one", () => {
  expect(sharedChromeCount(2)).toBe(1);
  expect(sharedChromeCount(4)).toBe(1);
  expect(sharedChromeCount(7)).toBe(1);
  expect(sharedChromeCount(20)).toBe(5);
  expect(
    sharedChromeEndpoints({ [SHARED_CHROME_ENV]: "ws://a/1 ws://b/2" }),
  ).toEqual(["ws://a/1", "ws://b/2"]);
  expect(sharedChromeEndpoints({})).toEqual([]);
});
