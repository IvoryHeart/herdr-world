import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type { FlakeReport, TestCase } from "./test-retry";

/** @internal */
export type Occurrence = { run: number; at: string };
/** @internal */
export type FlakyIssue = {
  number: number;
  body: string;
  labels: Array<{ name: string }>;
};
/** @internal */
export type Ledger = { test: TestCase; occurrences: Occurrence[] };
export const FLAKY = "flaky";
const QUARANTINE = "flaky-quarantined";
const WEEK = 7 * 24 * 60 * 60 * 1000;
const marker = /<!-- flaky-test-v1: ([A-Za-z0-9_-]+) -->/;
const START = "<!-- flaky-history:start -->";
const END = "<!-- flaky-history:end -->";

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
  for (const test of value.flaky) {
    validTest(test);
    assert(value.files.includes(test.file), "Flake outside executed inventory");
  }
  return value;
}

export function ledgerOf(body: string): Ledger | undefined {
  const encoded = marker.exec(body)?.[1];
  if (!encoded) return undefined;
  const ledger = JSON.parse(
    Buffer.from(encoded, "base64url").toString(),
  ) as Ledger;
  validTest(ledger.test);
  assert(Array.isArray(ledger.occurrences), "Invalid flake history");
  for (const occurrence of ledger.occurrences)
    assert(
      Number.isSafeInteger(occurrence.run) &&
        occurrence.run > 0 &&
        Number.isFinite(Date.parse(occurrence.at)),
      "Invalid flake occurrence",
    );
  return ledger;
}

export function addOccurrence(ledger: Ledger, occurrence: Occurrence): Ledger {
  return {
    test: ledger.test,
    occurrences: ledger.occurrences.some((item) => item.run === occurrence.run)
      ? ledger.occurrences
      : [...ledger.occurrences, occurrence],
  };
}

/** @internal */
export function recentRuns(ledger: Ledger, now: string): number {
  const end = Date.parse(now);
  assert(Number.isFinite(end), "Invalid history time");
  return new Set(
    ledger.occurrences
      .filter(
        (item) =>
          Date.parse(item.at) >= end - WEEK && Date.parse(item.at) <= end,
      )
      .map((item) => item.run),
  ).size;
}

/** A breached open cause stays blocked until explicit fix/quarantine, even after the window ages. */
function maximumWindowRuns(ledger: Ledger, now: string): number {
  const times = [
    ...new Map(
      ledger.occurrences.map((item) => [item.run, Date.parse(item.at)]),
    ).values(),
  ]
    .filter((time) => time <= Date.parse(now))
    .sort((a, b) => a - b);
  let first = 0,
    maximum = 0;
  for (let last = 0; last < times.length; last++) {
    while (times[last]! - times[first]! > WEEK) first++;
    maximum = Math.max(maximum, last - first + 1);
  }
  return maximum;
}

export function blockedFlakes(
  issues: FlakyIssue[],
  reports: FlakeReport[],
  occurrence: Occurrence,
  now = occurrence.at,
): Array<{ issue: number; test: TestCase; runs: number }> {
  const files = new Set(reports.flatMap((report) => report.files));
  const flaky = new Set(reports.flatMap((report) => report.flaky).map(testKey));
  return issues.flatMap((issue) => {
    const ledger = ledgerOf(issue.body);
    if (
      !ledger ||
      !files.has(ledger.test.file) ||
      issue.labels.some((label) => label.name === QUARANTINE)
    )
      return [];
    const runs = maximumWindowRuns(
      flaky.has(testKey(ledger.test))
        ? addOccurrence(ledger, occurrence)
        : ledger,
      now,
    );
    return runs > 3 ? [{ issue: issue.number, test: ledger.test, runs }] : [];
  });
}

export const markdown = (text: string) =>
  text.replace(/[\r\n]/g, " ").replace(/[\\`*_{}[\]()<>!|]/g, "\\$&");

export function issueBody(
  ledger: Ledger,
  repo: string,
  previous?: string,
): string {
  const history = [
    START,
    `<!-- flaky-test-v1: ${Buffer.from(JSON.stringify(ledger)).toString("base64url")} -->`,
    "### Recorded flaky runs",
    "",
    ...ledger.occurrences.map(
      (item) =>
        `- ${item.at}: https://github.com/${repo}/actions/runs/${item.run}`,
    ),
    END,
  ].join("\n");
  if (previous) {
    const start = previous.indexOf(START),
      end = previous.indexOf(END);
    assert(start >= 0 && end > start, "Missing managed flaky history");
    return (
      previous.slice(0, start) + history + previous.slice(end + END.length)
    );
  }
  return [
    `Test: ${markdown(ledger.test.file)} — ${markdown(ledger.test.name)}`,
    "",
    "This test failed initially and passed its one in-job retry. Fix the cause, then close this issue. More than three distinct flaky runs in seven days blocks Delivery checks for runs selecting this file, even if the test passes first time. The owner can explicitly exempt this limit with the flaky-quarantined label; a second test failure still fails CI.",
    "",
    history,
  ].join("\n");
}

export function flakeSummary(reports: FlakeReport[]): string {
  const tests = new Map(
    reports
      .flatMap((report) => report.flaky)
      .map((test) => [testKey(test), test]),
  );
  return [
    "### Flaky tests",
    "",
    ...(tests.size
      ? [
          "Passed only on retry:",
          "",
          "| File | Case |",
          "| --- | --- |",
          ...[...tests.values()].map(
            (test) => `| ${markdown(test.file)} | ${markdown(test.name)} |`,
          ),
        ]
      : ["No tests passed only on retry."]),
    "",
  ].join("\n");
}
