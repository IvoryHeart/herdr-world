import { expect, test } from "bun:test";
import {
  PHASE,
  type Timed,
  cgroupCpuSeconds,
  junitTimes,
  timingsReport,
} from "./test-timings";

const report = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" time="9">
  <testsuite name="web/a.test.ts" file="web/a.test.ts" time="5.5">
    <testsuite name="group" file="web/a.test.ts" time="5.5">
      <testcase name="slow &apos;one&apos;" classname="group" time="5" file="web/a.test.ts" line="3" />
      <testcase name="fast" classname="group" time="2" file="web/a.test.ts" line="9">
      </testcase>
    </testsuite>
  </testsuite>
  <testsuite name="web/b.test.ts" file="web/b.test.ts" time="3">
    <testcase name="middle" classname="" time="3" file="./web/b.test.ts" line="1" />
  </testsuite>
</testsuites>`;

test("JUnit reports give the slowest files by suite time, and cases", () => {
  // web/a's cases ran concurrently: 5.5 s of suite, not 7 s of case sum.
  const { files, cases } = junitTimes([report]);
  expect(files).toEqual([
    { name: "web/a.test.ts", seconds: 5.5 },
    { name: "web/b.test.ts", seconds: 3 },
  ]);
  // A file run in parts adds up across reports.
  expect(junitTimes([report, report]).files[0]).toEqual({
    name: "web/a.test.ts",
    seconds: 11,
  });
  expect(cases.map((item) => [item.name, item.seconds])).toEqual([
    ["web/a.test.ts › slow 'one'", 5],
    ["web/b.test.ts › middle", 3],
    ["web/a.test.ts › fast", 2],
  ]);
});

test("only ten of each are kept", () => {
  const many = Array.from(
    { length: 12 },
    (_, index) =>
      `<testcase name="c${index}" time="${index}" file="f${index}.test.ts" />`,
  ).join("\n");
  const { files, cases } = junitTimes([many]);
  expect(files).toHaveLength(10);
  expect(cases[0]).toEqual({ name: "f11.test.ts › c11", seconds: 11 });
});

test("cgroup CPU is read from usage_usec", () => {
  expect(cgroupCpuSeconds("usage_usec 12500000\nuser_usec 10000000\n")).toBe(
    12.5,
  );
  expect(cgroupCpuSeconds("")).toBeUndefined();
});

test("phases are the runners' milestones", () => {
  expect(PHASE.test("[world-test-runner] local: 40 files")).toBe(true);
  expect(PHASE.test("[queue] world waiting for browser")).toBe(true);
  expect(PHASE.test("Ran 9 tests across 1 file. [88.01s]")).toBe(true);
  expect(PHASE.test("(pass) a case [3.2s]")).toBe(false);
});

test("the report flags lanes measured under load and names its sources", () => {
  const lane: Timed = {
    lane: "web",
    code: 0,
    wallSeconds: 61.2,
    cpuSeconds: 400,
    cpuSource: "cgroup",
    peakMiB: 2048,
    peakSource: "cgroup",
    loadBefore: 9.1,
    loadAfter: 4,
    phases: [{ at: 1.5, line: "[test-runner] --parallel=2 | x" }],
    files: [{ name: "web/a.test.ts", seconds: 7 }],
    cases: [{ name: "web/a.test.ts › a | b", seconds: 5 }],
  };
  const text = timingsReport([lane], 4, "2026-01-01T00:00:00Z");
  expect(text).toContain(
    "| web | passed | 61 | 400 | cgroup | 2048 | cgroup | 9.1 | 4.0 (repeat) |",
  );
  expect(text).toContain("| 5.0 | web/a.test.ts › a \\| b |");
  expect(text).toContain("| 1.5 | [test-runner] --parallel=2 \\| x |");
  expect(text).toContain("| 61.2 | lane finished |");
});
