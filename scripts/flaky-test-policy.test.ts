import { expect, test } from "bun:test";
import { flakeSummary, testKey, validateReport } from "./flaky-test-policy";
const flaky = { file: "scripts/example.test.ts", name: "nested case | <safe>" };
const report = { files: [flaky.file], flaky: [flaky] };

test("reports validate retry scope and file/case identity without any history or frequency policy", () => {
  expect(validateReport(report)).toEqual(report);
  expect(validateReport({ ...report, retried: [flaky] }).retried).toEqual([
    flaky,
  ]);
  expect(() => validateReport({ files: [], flaky: [flaky] })).toThrow();
  expect(() =>
    validateReport({ files: [], flaky: [], retried: [flaky] }),
  ).toThrow();
  expect(() =>
    validateReport({ files: ["scripts/../private.test.ts"], flaky: [] }),
  ).toThrow();
  expect(() =>
    validateReport({ ...report, flaky: [{ ...flaky, name: "" }] }),
  ).toThrow();
  expect(testKey(flaky)).toBe(testKey({ ...flaky }));
  expect(testKey(flaky)).not.toBe(testKey({ ...flaky, name: "another case" }));
});

test("summaries deduplicate and escape both recovered and permanently failed retries", () => {
  const failed = { ...flaky, name: "still fails" };
  const summary = flakeSummary([
    { ...report, retried: [flaky, failed] },
    report,
  ]);
  expect(summary.split("| scripts/")).toHaveLength(3);
  expect(summary).toContain("nested case \\| \\<safe\\>");
  expect(summary).toContain("still fails");
  expect(flakeSummary([{ files: [], flaky: [] }])).toContain(
    "No tests needed a retry",
  );
});
