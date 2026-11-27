import { expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertUnitComparison,
  unitComparisonRequired,
  UNIT_COMPARISON_RUNS,
} from "./ci-unit-comparison";

function junit(cases: Array<{ name: string; status?: "fail" | "skip" }>) {
  return `<testsuites tests="${cases.length}" failures="${cases.filter((item) => item.status === "fail").length}">${cases.map(({ name, status }) => `<testsuite file="scripts/example.test.ts" time="1"><testcase name="${name}" file="scripts/example.test.ts">${status === "fail" ? "<failure/>" : status === "skip" ? "<skipped/>" : ""}</testcase></testsuite>`).join("")}</testsuites>`;
}

test("comparison preserves the multiset of cases and skips, and rejects any new first-pass failure", () => {
  const baseline = junit([
    { name: "a" },
    { name: "b", status: "fail" },
    { name: "c", status: "skip" },
  ]);
  expect(assertUnitComparison(baseline, baseline)).toBe(3);
  expect(
    assertUnitComparison(
      baseline,
      junit([{ name: "c", status: "skip" }, { name: "a" }, { name: "b" }]),
    ),
  ).toBe(3);
  expect(() =>
    assertUnitComparison(
      baseline,
      junit([
        { name: "a", status: "fail" },
        { name: "b" },
        { name: "c", status: "skip" },
      ]),
    ),
  ).toThrow("New parallel unit failure");
  for (const changed of [
    [{ name: "a" }, { name: "b" }],
    [
      { name: "a" },
      { name: "b" },
      { name: "renamed", status: "skip" as const },
    ],
    [
      { name: "a" },
      { name: "b" },
      { name: "c", status: "skip" as const },
      { name: "extra" },
    ],
  ])
    expect(() => assertUnitComparison(baseline, junit(changed))).toThrow(
      "inventory",
    );
  expect(() =>
    assertUnitComparison(
      baseline,
      junit([
        { name: "a", status: "skip" },
        { name: "b" },
        { name: "c", status: "skip" },
      ]),
    ),
  ).toThrow("skips");
  expect(() =>
    assertUnitComparison(
      junit([{ name: "same" }, { name: "same", status: "fail" }]),
      junit([
        { name: "same", status: "fail" },
        { name: "same", status: "fail" },
      ]),
    ),
  ).toThrow("New parallel unit failure");
});

test("a truncated report, loader error, mismatched totals or empty inventory cannot prove comparison", () => {
  const good = junit([{ name: "case" }]);
  for (const bad of [
    good.replace("</testsuites>", ""),
    good.replace('tests="1"', 'tests="2"'),
    good.replace('failures="0"', 'failures="1"'),
    good.replace("<testsuites ", '<testsuites errors="1" '),
    junit([]),
  ])
    expect(() => assertUnitComparison(good, bad)).toThrow();
});

test("scheduler inputs require twenty comparisons; ordinary test and product changes do not", () => {
  expect(UNIT_COMPARISON_RUNS).toBe(20);
  for (const path of [
    ".github/workflows/ci.yml",
    "scripts/ci-tests.ts",
    "scripts/run-tests.ts",
    "scripts/ci-unit-shards.ts",
    "scripts/ci-unit-timings.json",
    "scripts/ci-unit-timings.ts",
    "scripts/ci-unit-comparison.ts",
  ])
    expect(unitComparisonRequired(["README.md", path])).toBe(true);
  expect(
    unitComparisonRequired([
      "scripts/ci-unit-comparison.test.ts",
      "server/src/example.ts",
      "README.md",
    ]),
  ).toBe(false);
  expect(unitComparisonRequired([".github/workflows/ci.yml"], false)).toBe(
    false,
  );
  expect(
    unitComparisonRequired(
      [".github/workflows/ci.yml", "scripts/ci-unit-shards.ts"],
      false,
    ),
  ).toBe(true);
});

test("comparison selection uses the immutable event diff and fails closed when that diff is unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "unit-comparison-scope-"));
  const git = (...args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: root,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString().trim();
  };
  const commit = () => {
    git("add", ".");
    git(
      "-c",
      "user.name=Fixture",
      "-c",
      "user.email=fixture@example.test",
      "commit",
      "-qm",
      "fixture",
    );
  };
  try {
    git("init", "-q", "-b", "fixture");
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    const workflow = (shards: string, staticCommand: string) =>
      `jobs:\n  unit-tests:\n    strategy:\n      matrix:\n        shard: ${shards}\n  static:\n    steps:\n      - run: ${staticCommand}\n`;
    const workflowPath = join(root, ".github/workflows/ci.yml");
    writeFileSync(workflowPath, workflow("[1, 2]", "original"));
    writeFileSync(join(root, "README.md"), "initial");
    commit();
    const base = git("rev-parse", "HEAD");
    git("update-ref", "refs/remotes/origin/main", base);
    const output = join(root, "outputs");
    const run = (event: string, revision = base) => {
      writeFileSync(output, "");
      return Bun.spawnSync(
        [
          process.execPath,
          join(import.meta.dir, "ci-unit-comparison.ts"),
          "required",
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: event,
            UNIT_COMPARISON_BASE: revision,
            GITHUB_OUTPUT: output,
          },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
    };
    writeFileSync(join(root, "README.md"), "ordinary docs");
    commit();
    expect(run("pull_request").exitCode).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("required=false\n");
    writeFileSync(workflowPath, workflow("[1, 2]", "changed static command"));
    commit();
    expect(run("pull_request").exitCode).toBe(0);
    expect(readFileSync(output, "utf8")).toBe("required=false\n");
    writeFileSync(
      workflowPath,
      workflow("[1, 2, 3, 4]", "changed static command"),
    );
    commit();
    for (const event of ["pull_request", "merge_group", "workflow_dispatch"]) {
      expect(run(event).exitCode).toBe(0);
      expect(readFileSync(output, "utf8")).toBe("required=true\n");
    }
    expect(run("pull_request", "a".repeat(40)).exitCode).not.toBe(0);
    expect(readFileSync(output, "utf8")).toBe("");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the real comparison command completes all twenty pairs and retains separate first-pass and retry evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "unit-comparison-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const name of [
      "ci-tests.ts",
      "run-tests.ts",
      "ci-unit-comparison.ts",
      "ci-unit-timings.json",
    ])
      symlinkSync(join(import.meta.dir, name), join(root, "scripts", name));
    for (const name of ["web", "server"])
      symlinkSync(join(import.meta.dir, "..", name), join(root, name));
    writeFileSync(
      join(root, "scripts/example.test.ts"),
      'import {expect,test} from "bun:test"; test("kept", () => expect(1).toBe(1));',
    );
    const child = Bun.spawn(
      [process.execPath, "scripts/ci-unit-comparison.ts", "run", "1/4"],
      {
        cwd: root,
        env: {
          ...process.env,
          HERDR_CI_SELECTION: JSON.stringify({
            unit: ["scripts/example.test.ts"],
          }),
          HERDR_TEST_EXCLUDE_WORLD_BROWSER: "1",
          GITHUB_STEP_SUMMARY: join(root, "summary.md"),
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(code, stderr + stdout).toBe(0);
    const directory = join(root, ".agents/delivery");
    const result = JSON.parse(
      readFileSync(join(directory, "unit-comparison/unit-1-of-4.json"), "utf8"),
    );
    expect(result.files).toEqual(["scripts/example.test.ts"]);
    expect(result.results).toHaveLength(20);
    expect(
      result.results.every((item: { cases: number }) => item.cases === 1),
    ).toBe(true);
    for (const mode of ["serial", "parallel"]) {
      expect(
        readFileSync(
          join(
            directory,
            `unit-comparison/unit-1-of-4-comparison-20-${mode}.log`,
          ),
          "utf8",
        ),
      ).toContain(`--parallel=${mode === "serial" ? 1 : 4}`);
      expect(
        readFileSync(
          join(directory, `unit-1-of-4-comparison-20-${mode}.xml`),
          "utf8",
        ),
      ).toContain('name="kept"');
      expect(
        JSON.parse(
          readFileSync(
            join(
              directory,
              `flakes-unit-1-of-4-1-${mode === "serial" ? 1 : 4}-${process.env.GITHUB_RUN_ATTEMPT || "local"}-comparison-20-${mode}.json`,
            ),
            "utf8",
          ),
        ),
      ).toEqual({ files: ["scripts/example.test.ts"], flaky: [], retried: [] });
    }
    expect(readFileSync(join(root, "summary.md"), "utf8")).toContain(
      "20 paired passes",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}, 30000);
