import { expect, test } from "bun:test";
import {
  diffHunks,
  matchMoves,
  normalize,
  type Plumbing,
  statementLines,
} from "./move-check";

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
    {
      from: "web/src/store.ts",
      fromLine: 10,
      to: "web/src/storeHelpers.ts",
      toLine: 5,
      lines: 3,
      first: "function helper(value: number) {",
    },
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

test("a block of three or more lines reordered within its file is not a move", () => {
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "src/handler.ts",
          "src/handler.ts",
          "@@ -1,3 +1,0 @@",
          "-authenticate();",
          "-authorize();",
          "-validate();",
          "@@ -7,0 +4,3 @@",
          "+authenticate();",
          "+authorize();",
          "+validate();",
        ),
      ),
    ),
  );
  expect(report.runs).toEqual([]);
  expect(report.lost).toHaveLength(3);
  expect(report.extra).toHaveLength(3);
});

test("blocks moved to another file out of their order are reported", () => {
  const body = (name: string) => [
    `function ${name}() {`,
    `  ${name}Step();`,
    `  return ${name};`,
  ];
  const report = matchMoves(
    diffHunks(
      diff(
        ...file(
          "big.ts",
          "big.ts",
          "@@ -1,6 +1,0 @@",
          ...[...body("first"), ...body("second")].map((line) => `-${line}`),
        ),
        ...file(
          "/dev/null",
          "small.ts",
          "@@ -0,0 +1,6 @@",
          ...[...body("second"), ...body("first")].map((line) => `+${line}`),
        ),
      ),
    ),
  );
  // One of the two blocks keeps its place; the other moved out of order.
  expect(report.runs).toHaveLength(1);
  expect(report.lost).toHaveLength(3);
  expect(report.extra).toHaveLength(3);
});

test("import statements and every member of a multi-line list are found in a file", () => {
  const source = [
    'import { a } from "./a";',
    "import {",
    "  type NotificationTarget,",
    "  helper,",
    '} from "./store";',
    'export { b } from "./b";',
    'export * from "./c";',
    "const value = 1;",
    "export function keep() {}",
  ].join("\n");
  expect([...statementLines(source)]).toEqual([1, 2, 3, 4, 5, 6, 7]);
});

test("a changed member of an unchanged multi-line import is plumbing, from the files", () => {
  // -U0 shows only the member lines; the "import {" stays as unseen context.
  const before = [
    "import {",
    "  type NotificationTarget,",
    '} from "./store";',
    "run();",
  ].join("\n");
  const after = [
    "import {",
    "  emptyServerSessionState,",
    '} from "./store";',
    "run();",
  ].join("\n");
  const versions = { "-": statementLines(before), "+": statementLines(after) };
  const plumbing: Plumbing = (_file, sign, line) => versions[sign].has(line);
  const hunks = diffHunks(
    diff(
      ...file(
        "web/src/store.ts",
        "web/src/store.ts",
        "@@ -2,1 +2,1 @@",
        "-  type NotificationTarget,",
        "+  emptyServerSessionState,",
      ),
    ),
    plumbing,
  );
  expect(matchMoves(hunks)).toEqual({ lost: [], extra: [], runs: [] });
  // Without the files, the same hunk is reported.
  const blind = matchMoves(
    diffHunks(
      diff(
        ...file(
          "web/src/store.ts",
          "web/src/store.ts",
          "@@ -2,1 +2,1 @@",
          "-  type NotificationTarget,",
          "+  emptyServerSessionState,",
        ),
      ),
    ),
  );
  expect(blind.lost).toHaveLength(1);
});

test("a dynamic import and its callback are code, not plumbing", () => {
  const source = [
    'void import("./worker").then(({ start }) => {',
    "  start(options);",
    "});",
    "const url = import.meta.url;",
    'import type { Options } from "./options";',
  ].join("\n");
  expect([...statementLines(source)]).toEqual([5]);
});

test("comments and module strings do not extend or end a declaration", () => {
  const source = [
    'import setup from "./setup"; // {',
    'setup.configure("safe");',
    'import other from "./{";',
    "other();",
    "import { // }",
    "  helper,",
    '} from "./helpers";',
    "helper();",
  ].join("\n");
  expect([...statementLines(source)]).toEqual([1, 3, 5, 6, 7]);
});

test("a line shared by plumbing and executable code remains code", () => {
  expect(statementLines('import setup from "./setup"; setup();').size).toBe(0);
  expect(statementLines("export { setup }; setup();").size).toBe(0);
});

test("side-effect imports remain executable inventory lines", () => {
  expect(statementLines('import "./register";').size).toBe(0);
  expect(normalize('import"./register";')).toBe('import"./register";');
});

test("invalid and non-JavaScript files cannot hide lines as plumbing", () => {
  expect(statementLines("import { broken;\nrun();").size).toBe(0);
  expect(statementLines('import { text } from "./x";', "notes.txt").size).toBe(
    0,
  );
});

test("TSX imports are parsed without swallowing a component", () => {
  expect([
    ...statementLines(
      'import { view } from "./view";\nconst app = <view />;',
      "view.tsx",
    ),
  ]).toEqual([1]);
});

test("full-file classification keeps bare dynamic imports and import.meta", () => {
  const source = [
    'import("./worker").then(({ start }) => {',
    "  start(options);",
    "});",
    "import.meta.resolve('./worker');",
  ];
  expect(statementLines(source.join("\n")).size).toBe(0);
  const hunks = diffHunks(
    diff(
      ...file(
        "/dev/null",
        "worker.ts",
        "@@ -0,0 +1,4 @@",
        ...source.map((line) => `+${line}`),
      ),
    ),
    () => false,
  );
  expect(hunks.flatMap((hunk) => hunk.lines).map((line) => line.text)).toEqual(
    source.map((line) => line.trim()),
  );
});
