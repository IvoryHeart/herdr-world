import { expect, test } from "bun:test";
import { jobCpus, testChromeFlags } from "./chromeBrowser";

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
