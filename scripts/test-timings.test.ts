import { expect, test } from "bun:test";
import { junitTimes } from "./test-timings";

test("timing report reads failed and successful cases without discarding slow failures", () => {
  expect(
    junitTimes(
      `<testsuite><testcase name="slow" file="a.ts" time="12.5"><failure>bad</failure></testcase><testcase classname="b.ts" time="0.2" name="fast" /></testsuite>`,
    ),
  ).toEqual([
    { file: "a.ts", name: "slow", seconds: 12.5 },
    { file: "b.ts", name: "fast", seconds: 0.2 },
  ]);
});
