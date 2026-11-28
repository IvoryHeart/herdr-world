import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { FlakeReport, TestCase } from "./test-retry";

export function testKey(test: TestCase): string {
  return createHash("sha256")
    .update(JSON.stringify([test.file, test.name]))
    .digest("hex");
}

function validTest(test: TestCase) {
  assert(
    test &&
      typeof test.file === "string" &&
      /^(scripts|server|web|shared|quint|tools|verification)\/.+\.test\.[cm]?[jt]sx?$/.test(
        test.file,
      ) &&
      !test.file.split("/").some((part) => part === ".." || !part),
    "Invalid test file",
  );
  assert(
    typeof test.name === "string" &&
      test.name.length > 0 &&
      test.name.length <= 4000,
    "Invalid test case",
  );
}

export function validateReport(value: FlakeReport): FlakeReport {
  assert(
    value &&
      Array.isArray(value.files) &&
      value.files.length <= 20000 &&
      Array.isArray(value.flaky) &&
      value.flaky.length <= 20000,
    "Invalid flake evidence",
  );
  for (const file of value.files) validTest({ file, name: "file" });
  assert(
    value.retried === undefined ||
      (Array.isArray(value.retried) && value.retried.length <= 20000),
    "Invalid retry evidence",
  );
  for (const test of [...value.flaky, ...(value.retried || [])]) {
    validTest(test);
    assert(value.files.includes(test.file), "Flake outside executed inventory");
  }
  return value;
}

export const markdown = (text: string) =>
  text.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]()<>!|]/g, "\\$&");

export function flakeSummary(reports: FlakeReport[]): string {
  const tests = new Map(
    reports
      .flatMap((report) => report.retried || report.flaky)
      .map((test) => [testKey(test), test]),
  );
  return [
    "### Flaky tests",
    "",
    ...(tests.size
      ? [
          "Tests that needed a retry (reporting never gates a merge):",
          "",
          "| File | Case |",
          "| --- | --- |",
          ...[...tests.values()].map(
            (test) => `| ${markdown(test.file)} | ${markdown(test.name)} |`,
          ),
        ]
      : ["No tests needed a retry."]),
    "",
  ].join("\n");
}
