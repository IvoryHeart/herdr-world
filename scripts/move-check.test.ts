import { expect, test } from "bun:test";
import { diffLines, normalize, unmoved } from "./move-check";

const diff = (...lines: string[]) => lines.join("\n");

test("a pure move with new imports and exports passes", () => {
  const lines = diffLines(
    diff(
      "--- a/web/src/store.ts",
      "+++ b/web/src/store.ts",
      "-function helper(value: number) {",
      "-  return value * 2;",
      "-}",
      '+import { helper } from "./storeHelpers";',
      "--- /dev/null",
      "+++ b/web/src/storeHelpers.ts",
      "+import {",
      "+  type Value,",
      "+  scale,",
      '+} from "./values";',
      "+export function helper(value: number) {",
      "+  return value * 2;",
      "+}",
    ),
  );
  expect(unmoved(lines)).toEqual({ lost: [], extra: [] });
});

test("an edit hidden in a move is reported both ways", () => {
  const result = unmoved(
    diffLines(
      diff(
        "-  return value * 2;",
        "+  return value * 3;",
        "-function helper() {",
        "+function helper() {",
      ),
    ),
  );
  expect(result.lost).toEqual(["return value * 2;"]);
  expect(result.extra).toEqual(["return value * 3;"]);
});

test("duplicated lines are counted, not just matched", () => {
  const result = unmoved(diffLines(diff("-  i++;", "+  i++;", "+  i++;")));
  expect(result.extra).toEqual(["i++;"]);
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
