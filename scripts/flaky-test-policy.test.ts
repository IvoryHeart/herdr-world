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

test("all short retry histories deduplicate reporting without frequency gating", () => {
  for (let history = 0; history < 256; history++) {
    const reports = Array.from({ length: 4 }, (_, position) => {
      const index = (history >> (position * 2)) & 3;
      return {
        files: [flaky.file],
        flaky: [{ ...flaky, name: `case-${index}` }],
      };
    });
    const unique = new Set(reports.map((item) => item.flaky[0]!.name));
    const summary = flakeSummary(reports);
    expect(summary.split("| scripts/").length - 1).toBe(unique.size);
    expect(flakeSummary([...reports, ...reports])).toBe(summary);
    expect(
      flakeSummary([...reports].reverse())
        .split("\n")
        .filter((line) => line.startsWith("| scripts/"))
        .sort(),
    ).toEqual(
      summary
        .split("\n")
        .filter((line) => line.startsWith("| scripts/"))
        .sort(),
    );
    expect(summary).toContain("reporting never gates a merge");
  }
});

test("report identity cannot confuse files, delimiter-bearing names or unexecuted cases", () => {
  expect(testKey({ file: "scripts/a.test.ts", name: "b|c" })).not.toBe(
    testKey({ file: "scripts/a.test.ts", name: "b" }),
  );
  expect(testKey({ file: "scripts/a.test.ts", name: "same" })).not.toBe(
    testKey({ file: "scripts/b.test.ts", name: "same" }),
  );
  expect(() =>
    validateReport({
      files: [flaky.file],
      flaky: [{ ...flaky, file: "scripts/other.test.ts" }],
    }),
  ).toThrow("outside executed inventory");
});
