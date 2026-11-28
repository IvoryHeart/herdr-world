import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { webTestBatches } from "./ci-web-tests";

test("web batches bound uiScale without losing, duplicating or filtering another file's cases", () => {
  const file = "web/src/uiScale.test.ts";
  const other = "web/src/productionBoot.browser.test.ts";
  const batches = webTestBatches([file, other]);
  expect(batches[0]).toEqual({ files: [other] });
  const patterns = batches.slice(1).map((batch) => {
    expect(batch.files).toEqual([file]);
    return new RegExp(batch.pattern || "");
  });
  const names = [
    ...readFileSync(file, "utf8").matchAll(
      /^\s*\[(\d+), ([\d.]+), "(\w+)", (\d+), (\d+)\],$/gm,
    ),
  ].map(
    ([, width, dpr, fixture, height, scale]) =>
      `browser interactions preserve layout and input (width ${width}, DPR ${dpr}, ${fixture}, height ${height}, UI ${scale}%%)`,
  );
  expect(names).toHaveLength(41);
  for (const name of [
    ...names,
    "a future case",
    names[0]!.replace(", uiScale,", ", aFutureFixture,"),
  ])
    expect(patterns.filter((pattern) => pattern.test(name))).toHaveLength(1);
  for (const pattern of patterns)
    expect(names.some((name) => pattern.test(name))).toBe(true);
  expect(webTestBatches([other])).toEqual([{ files: [other] }]);
  expect(webTestBatches([])).toEqual([]);
});
