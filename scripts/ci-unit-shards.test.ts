import { expect, test } from "bun:test";
import { ciTestBatches } from "./ci-tests";
import type { ValidationSelection } from "./validation-scope";
import { selectedCITests } from "./ci-tests";
import {
  unitBuildSuites,
  unitNeedsBuild,
  unitTestShards,
} from "./ci-unit-shards";
import { junitFileTimings } from "./ci-unit-timings";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("CI runs four non-browser files at a time without changing case concurrency", () => {
  const selection = {
    unit: ["scripts/example.test.ts"],
  } as ValidationSelection;
  expect(ciTestBatches(selection, "unit")).toEqual([
    { files: selection.unit, parallel: 4, label: "unit" },
  ]);
});

test("longest-file packing is deterministic, disjoint and exhaustive, including new files", () => {
  const files = ["a", "b", "c", "d", "e", "f"].map(
    (name) => `scripts/${name}.test.ts`,
  );
  const times = Object.fromEntries(
    files.map((file, index) => [file, [30, 20, 10, 9, 8, 7][index]!]),
  );
  const shards = unitTestShards(files, times);
  expect(shards).toEqual([
    [files[0]],
    [files[1]],
    [files[2], files[5]],
    [files[3], files[4]],
  ]);
  expect(unitTestShards([...files].reverse(), times)).toEqual(shards);
  const withNew = unitTestShards(
    [...files, "scripts/new.test.ts"],
    times,
  ).flat();
  expect(withNew.sort()).toEqual([...files, "scripts/new.test.ts"].sort());
  expect(unitTestShards([], {})).toEqual([[], [], [], []]);
  expect(() => unitTestShards([files[0]!, files[0]!], times)).toThrow(
    "Duplicate",
  );
  for (const seconds of [NaN, Infinity, -1])
    expect(() => unitTestShards([files[0]!], { [files[0]!]: seconds })).toThrow(
      "Invalid unit timing",
    );
});

test("all build consumers stay together; a scoped selection without them needs no build", () => {
  const files = [
    ...unitBuildSuites,
    "scripts/ordinary.test.ts",
    "scripts/new.test.ts",
  ];
  const shards = unitTestShards(files, {});
  expect(shards[0]).toEqual(expect.arrayContaining(unitBuildSuites));
  expect(shards.map(unitNeedsBuild)).toEqual([true, false, false, false]);
  expect(shards.flat().sort()).toEqual(files.sort());
  expect(
    unitTestShards(["scripts/new.test.ts"], {}).map(unitNeedsBuild),
  ).toEqual([false, false, false, false]);
  const selection = { unit: files } as ValidationSelection;
  const assigned = [1, 2, 3, 4].flatMap((index) =>
    selectedCITests(selection, "unit", `${index}/4`),
  );
  expect(assigned.sort()).toEqual([...selection.unit].sort());
  for (const invalid of ["0/4", "5/4", "1/3", "1/2", "2", "1/4junk"])
    expect(() => selectedCITests(selection, "unit", invalid)).toThrow();
});

test("timings come from file suites including setup, and reject partial or invalid evidence", () => {
  const xml = `<testsuites tests="1" failures="0"><testsuite name="outer" file="scripts/example.test.ts" time="2.75"><testcase file="scripts/example.test.ts" name="case" time="0.1" /></testsuite></testsuites>`;
  expect(junitFileTimings(xml)).toEqual({ "scripts/example.test.ts": 2.75 });
  const nested = xml
    .replace(
      "<testcase ",
      '<testsuite file="scripts/example.test.ts" time="1"><testcase ',
    )
    .replace(
      "</testsuite></testsuites>",
      "</testsuite></testsuite></testsuites>",
    );
  expect(junitFileTimings(nested)).toEqual({ "scripts/example.test.ts": 2.75 });
  expect(() => junitFileTimings(xml.replace("</testsuites>", ""))).toThrow(
    "complete",
  );
  for (const value of ["NaN", "-1", "Infinity"])
    expect(() =>
      junitFileTimings(xml.replace('time="2.75"', `time="${value}"`)),
    ).toThrow("Invalid JUnit time");
  expect(() => junitFileTimings(xml.replace('time="2.75"', ""))).toThrow(
    "Invalid JUnit time",
  );
  expect(() =>
    junitFileTimings(xml.replaceAll("scripts/example", "../example")),
  ).toThrow("Invalid JUnit timing file");
});

test("the workflow plan requests a build only for its selected build consumers and starts no tests", () => {
  const root = mkdtempSync(join(tmpdir(), "unit-plan-"));
  try {
    for (const files of [[...unitBuildSuites], ["scripts/new.test.ts"], []]) {
      const output = join(root, "outputs");
      const child = Bun.spawnSync(
        [
          process.execPath,
          join(import.meta.dir, "ci-tests.ts"),
          "unit",
          "1/4",
          "--plan",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            HERDR_CI_SELECTION: JSON.stringify({ unit: files }),
            GITHUB_OUTPUT: output,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(child.exitCode, child.stderr.toString()).toBe(0);
      expect(readFileSync(output, "utf8").trimEnd().split("\n").at(-1)).toBe(
        `build=${files.some((file) => unitBuildSuites.includes(file))}`,
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
