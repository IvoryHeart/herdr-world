import { expect, test } from "bun:test";
import {
  addOccurrence,
  blockedFlakes,
  flakeSummary,
  issueBody,
  ledgerOf,
  recentRuns,
  validateReport,
  type Ledger,
} from "./flaky-test-policy";
const flaky = { file: "scripts/example.test.ts", name: "nested case" };
const at = "2026-11-20T12:00:00.000Z";
const occurrence = (run: number, date = at) => ({ run, at: date });
const report = { files: [flaky.file], flaky: [flaky] };
const issue = (ledger: Ledger, quarantined = false) => ({
  number: 1,
  body: issueBody(ledger, "example/repo"),
  labels: [{ name: quarantined ? "flaky-quarantined" : "flaky" }],
});

test("all short run histories deduplicate attempts and enforce exactly the fourth run", () => {
  // Enumerate repeated and reordered occurrences of four runs.
  for (let history = 0; history < 256; history++) {
    let ledger: Ledger = { test: flaky, occurrences: [] };
    for (let position = 0; position < 4; position++)
      ledger = addOccurrence(
        ledger,
        occurrence(((history >> (position * 2)) & 3) + 1),
      );
    const unique = new Set(ledger.occurrences.map((item) => item.run));
    expect(recentRuns(ledger, at)).toBe(unique.size);
    for (const run of [1, 2, 3, 4, 5]) {
      const expected = new Set([...unique, run]).size > 3;
      expect(
        blockedFlakes([issue(ledger)], [report], occurrence(run)).length > 0,
      ).toBe(expected);
      expect(
        blockedFlakes([issue(ledger, true)], [report], occurrence(run)),
      ).toEqual([]);
    }
  }
});

test("window boundary, persistent blocking on first-pass success, unrelated selection and closed fix", () => {
  const ledger = {
    test: flaky,
    occurrences: [1, 2, 3, 4].map((run) => occurrence(run)),
  };
  const week = "2026-11-27T12:00:00.000Z";
  expect(recentRuns(ledger, week)).toBe(4);
  expect(recentRuns(ledger, "2026-11-27T12:00:00.001Z")).toBe(0);
  expect(
    blockedFlakes(
      [issue(ledger)],
      [{ ...report, flaky: [] }],
      occurrence(5, "2026-12-20T12:00:00Z"),
    ),
  ).toHaveLength(1);
  expect(recentRuns(ledger, "2026-11-19T12:00:00.000Z")).toBe(0);
  expect(
    blockedFlakes([issue(ledger)], [{ ...report, flaky: [] }], occurrence(5)),
  ).toHaveLength(1);
  expect(
    blockedFlakes([issue(ledger)], [{ files: [], flaky: [] }], occurrence(5)),
  ).toEqual([]);
  expect(blockedFlakes([], [report], occurrence(5))).toEqual([]);
});

test("issue identity, run links and owner prose survive updates; malformed evidence fails closed", () => {
  const ledger = { test: flaky, occurrences: [occurrence(1)] };
  const body = `Owner note\n${issueBody(ledger, "example/repo")}\nOwner ending`;
  const updated = issueBody(
    addOccurrence(ledger, occurrence(2)),
    "example/repo",
    body,
  );
  expect(updated).toStartWith("Owner note\n");
  expect(updated).toEndWith("\nOwner ending");
  expect(updated).toContain("https://github.com/example/repo/actions/runs/2");
  expect(ledgerOf(updated)?.occurrences).toHaveLength(2);
  expect(ledgerOf("unmanaged issue")).toBeUndefined();
  expect(() => validateReport({ files: [], flaky: [flaky] })).toThrow();
  expect(() =>
    validateReport({ files: ["scripts/../private.test.ts"], flaky: [] }),
  ).toThrow();
  expect(flakeSummary([report, report]).split("| scripts/")).toHaveLength(2);
  expect(
    flakeSummary([
      {
        files: [flaky.file],
        flaky: [{ ...flaky, name: "case | with a pipe" }],
      },
    ]),
  ).toContain("case \\| with a pipe");
});
