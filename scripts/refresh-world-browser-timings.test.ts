import { expect, test } from "bun:test";
import { junitCaseTimings } from "./refresh-world-browser-timings";

test("JUnit refresh preserves full nested names, decodes XML and takes the slower passing observation", () => {
  const xml = (seconds: string) =>
    `<testsuites><testsuite><testcase file="web/src/world/A.test.ts" classname="inner &gt; outer" name="a &amp; b" time="${seconds}"/><testcase file="web/src/world/A.test.ts" name="failed" time="90"><failure/></testcase><testcase file="web/src/world/A.test.ts" name="skipped" time="0"><skipped/></testcase></testsuite></testsuites>`;
  expect(junitCaseTimings([xml("12.5"), xml("10")])).toEqual({
    "web/src/world/A.test.ts": { "outer inner a & b": 12.5 },
  });
  for (const seconds of ["NaN", "-1", "Infinity"])
    expect(() => junitCaseTimings([xml(seconds)])).toThrow();
  expect(() =>
    junitCaseTimings([xml("1").replace("</testsuites>", "")]),
  ).toThrow();
  expect(() => junitCaseTimings([])).toThrow();
});
