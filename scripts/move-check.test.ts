import { expect, test } from "bun:test";
import { diffHunks, matchMoves, normalize } from "./move-check";

const diff = (...lines: string[]) => lines.join("\n");
const file = (from: string, to: string, ...body: string[]) => [
  `diff --git a/${from} b/${to}`,
  `--- ${from === "/dev/null" ? from : `a/${from}`}`,
  `+++ b/${to}`,
  ...body,
];

test("a split into a new file with new imports and exports is a move", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "web/src/store.ts",
          "web/src/store.ts",
          "@@ -1,0 +1,1 @@",
          '+import { helper } from "./storeHelpers";',
          "@@ -10,4 +11,0 @@",
          "-function helper(value: number) {",
          "-  const doubled = value * 2;",
          "-  return doubled;",
          "-}",
        ),
        ...file(
          "/dev/null",
          "web/src/storeHelpers.ts",
          "@@ -0,0 +1,8 @@",
          "+import {",
          "+  type Value,",
          "+  scale,",
          '+} from "./values";',
          "+export function helper(value: number) {",
          "+  const doubled = value * 2;",
          "+  return doubled;",
          "+}",
        ),
      ),
    ),
  );
  expect(report.lost).toEqual([]);
  expect(report.extra).toEqual([]);
  expect(report.runs).toEqual([
    { from: "web/src/store.ts", to: "web/src/storeHelpers.ts", lines: 3 },
  ]);
});

test("reordering statements is not a move", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "web/src/a.ts",
          "web/src/a.ts",
          "@@ -1,2 +1,0 @@",
          "-authorize();",
          "-write();",
          "@@ -5,0 +3,2 @@",
          "+write();",
          "+authorize();",
        ),
      ),
    ),
  );
  expect(report.lost.length + report.extra.length).toBeGreaterThan(0);
});

test("statements swapped between files are not a move", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "a.ts",
          "a.ts",
          "@@ -1,1 +1,1 @@",
          "-  check(a);",
          "+  check(b);",
        ),
        ...file(
          "b.ts",
          "b.ts",
          "@@ -1,1 +1,1 @@",
          "-  check(b);",
          "+  check(a);",
        ),
      ),
    ),
  );
  // Single lines are below a run, so each swap is reported.
  expect(report.lost).toHaveLength(2);
  expect(report.extra).toHaveLength(2);
});

test("an import-header hunk does not hide a later edit", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "web/src/a.ts",
          "web/src/a.ts",
          "@@ -1,1 +1,1 @@",
          "-import {",
          "+import type {",
          "@@ -40,1 +40,1 @@",
          "-  return false;",
          "+  return true;",
        ),
      ),
    ),
  );
  expect(report.lost).toEqual([
    { file: "web/src/a.ts", line: "return false;" },
  ]);
  expect(report.extra).toEqual([
    { file: "web/src/a.ts", line: "return true;" },
  ]);
});

test("an edit inside moved code is reported, and each added line counts once", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "a.ts",
          "a.ts",
          "@@ -1,4 +1,0 @@",
          "-one();",
          "-two();",
          "-three();",
          "-four();",
        ),
        ...file(
          "/dev/null",
          "b.ts",
          "@@ -0,0 +1,5 @@",
          "+one();",
          "+two();",
          "+three();",
          "+FOUR();",
          "+one();",
        ),
      ),
    ),
  );
  expect(report.lost).toEqual([{ file: "a.ts", line: "four();" }]);
  expect(report.extra).toEqual([
    { file: "b.ts", line: "FOUR();" },
    { file: "b.ts", line: "one();" },
  ]);
});

test("plumbing and blank lines are ignored", () => {
  for (const line of [
    "",
    "  ",
    'import x from "y";',
    "export { a, b };",
    '} from "./z";',
    "};",
  ])
    expect(normalize(line)).toBeUndefined();
  expect(normalize("export const a = 1;")).toBe("const a = 1;");
});
