import assert from "node:assert/strict";
import { unitSchedule, unitRunnerSchedule } from "./ci-unit-schedule";
import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { selectedCITests } from "./ci-tests";
import { parseJUnit } from "./test-retry";
import type { ValidationSelection } from "./validation-scope";

/** @internal */
export const UNIT_COMPARISON_RUNS = 20;

/** Scheduling/configuration changes must prove the parallel lane before merge. @internal */
export function unitComparisonRequired(
  paths: readonly string[],
  unitJobChanged = true,
): boolean {
  return paths.some(
    (path) =>
      (path === ".github/workflows/ci.yml" && unitJobChanged) ||
      ["scripts/ci-tests.ts", "scripts/run-tests.ts"].includes(path) ||
      /^scripts\/ci-unit-(?:shards\.ts|timings\.(?:ts|json)|comparison\.ts)$/.test(
        path,
      ),
  );
}

/** Compare first-attempt evidence, even when the normal retry later recovers it. @internal */
export function assertUnitComparison(
  serialXML: string,
  parallelXML: string,
): number {
  const complete = (xml: string) => {
    const cases = parseJUnit(xml);
    const totals = /<testsuites\b([^>]*)>/.exec(xml)?.[1] || "";
    const count = (name: string) =>
      Number(new RegExp(`\\b${name}="(\\d+)"`).exec(totals)?.[1] ?? NaN);
    assert(
      cases.length > 0 &&
        count("tests") === cases.length &&
        (!/\berrors=/.test(totals) || count("errors") === 0) &&
        count("failures") ===
          cases.filter((item) => item.status === "fail").length,
      "Incomplete unit comparison inventory or process errors",
    );
    return cases;
  };
  const serial = complete(serialXML);
  const parallel = complete(parallelXML);
  const inventory = (cases: typeof serial) =>
    cases.map(({ file, name }) => JSON.stringify([file, name])).sort();
  assert.deepEqual(
    inventory(parallel),
    inventory(serial),
    "Parallel unit case inventory changed",
  );
  const statuses = (cases: typeof serial, status: "skip" | "fail") => {
    const counts = new Map<string, number>();
    for (const item of cases.filter((item) => item.status === status)) {
      const key = JSON.stringify([item.file, item.name]);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  assert.deepEqual(
    statuses(parallel, "skip"),
    statuses(serial, "skip"),
    "Parallel unit skips changed",
  );
  const baselineFailures = statuses(serial, "fail");
  for (const [key, count] of statuses(parallel, "fail"))
    assert(
      count <= (baselineFailures.get(key) ?? 0),
      `New parallel unit failure: ${key}`,
    );
  return serial.length;
}

async function compare(shard: string) {
  const selection = JSON.parse(
    process.env.HERDR_CI_SELECTION || "null",
  ) as ValidationSelection;
  assert(selection, "Missing CI selection");
  const files = selectedCITests(selection, "unit", shard);
  assert(files.length, "Unit comparison needs selected suites");
  const directory = ".agents/delivery/unit-comparison";
  mkdirSync(directory, { recursive: true });
  const prefix = `unit-${shard.replace("/", "-of-")}`;
  const results: Array<{
    pass: number;
    serial: number;
    parallel: number;
    cases: number;
  }> = [];
  for (let pass = 1; pass <= UNIT_COMPARISON_RUNS; pass++) {
    const times = { serial: 0, parallel: 0 };
    for (const mode of pass % 2
      ? (["serial", "parallel"] as const)
      : (["parallel", "serial"] as const)) {
      const label = `comparison-${pass}-${mode}`;
      const log = `${directory}/${prefix}-${label}.log`;
      const started = performance.now();
      const output = openSync(log, "w");
      const child = (() => {
        try {
          return Bun.spawn(
            [
              process.execPath,
              "scripts/ci-tests.ts",
              "unit",
              shard,
              `--unit-run=${label}`,
            ],
            {
              stdin: "inherit",
              stdout: output,
              stderr: output,
            },
          );
        } finally {
          closeSync(output);
        }
      })();
      const stop = () => child.kill("SIGTERM");
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      let code: number;
      try {
        code = await child.exited;
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
      times[mode] = Math.round(performance.now() - started) / 1000;
      if (code !== 0) {
        console.error(
          readFileSync(log, "utf8").split("\n").slice(-50).join("\n"),
        );
        throw new Error(`${prefix} ${label} failed (${code}); retained ${log}`);
      }
    }
    const xml = (mode: string) =>
      readFileSync(
        `.agents/delivery/${prefix}-comparison-${pass}-${mode}.xml`,
        "utf8",
      );
    const cases = assertUnitComparison(xml("serial"), xml("parallel"));
    results.push({ pass, ...times, cases });
    writeFileSync(
      `${directory}/${prefix}.json`,
      JSON.stringify({ files, results }, null, 2),
    );
    console.info(
      `${prefix}: comparison ${pass}/${UNIT_COMPARISON_RUNS}, ${cases} cases, serial ${times.serial}s, parallel ${times.parallel}s`,
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### Unit serial/parallel comparison (${shard})\n\n${UNIT_COMPARISON_RUNS} paired passes; ${files.length} files and ${results[0]!.cases} cases per pass. No new parallel failures, missing cases or extra skips. First-attempt JUnit, retry evidence and command logs are retained.\n`,
    );
}

if (import.meta.main) {
  const [command, shard] = process.argv.slice(2);
  if (command === "required") {
    assert(process.env.GITHUB_OUTPUT, "Missing GITHUB_OUTPUT");
    let required = false;
    if (
      ["pull_request", "merge_group", "workflow_dispatch"].includes(
        process.env.GITHUB_EVENT_NAME || "",
      )
    ) {
      const base =
        process.env.GITHUB_EVENT_NAME === "workflow_dispatch"
          ? Bun.spawnSync(["git", "rev-parse", "origin/main"])
              .stdout.toString()
              .trim()
          : process.env.UNIT_COMPARISON_BASE;
      assert(
        base && /^[a-f0-9]{40}$/.test(base),
        "Missing immutable unit comparison base",
      );
      const diff = Bun.spawnSync(["git", "diff", "--name-only", base, "HEAD"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      assert(diff.exitCode === 0, "Cannot determine unit comparison inputs");
      let paths = diff.stdout.toString().trim().split("\n");
      // Scope-policy repairs do not alter the comparison execution. Keep the
      // twenty-pair requirement whenever its executor/assertions change.
      const source = (revision: string, path: string) => {
        const result = Bun.spawnSync(["git", "show", `${revision}:${path}`]);
        assert(result.exitCode === 0, "Cannot read unit comparison source");
        return result.stdout.toString();
      };
      if (paths.includes("scripts/ci-unit-comparison.ts")) {
        const execution = (text: string) => {
          const start = text.indexOf("export const UNIT_COMPARISON_RUNS");
          const end = text.indexOf("if (import.meta.main)");
          assert(
            start >= 0 && end > start,
            "Missing unit comparison execution",
          );
          return text.slice(start, end);
        };
        if (
          execution(source(base, "scripts/ci-unit-comparison.ts")) ===
          execution(source("HEAD", "scripts/ci-unit-comparison.ts"))
        )
          paths = paths.filter(
            (path) => path !== "scripts/ci-unit-comparison.ts",
          );
      }
      // The watchdog preserves the exact child command and arguments. Its
      // separate regression suite exercises all file phases with stopped clocks.
      if (
        paths.includes("scripts/run-tests.ts") &&
        unitRunnerSchedule(source(base, "scripts/run-tests.ts")) ===
          unitRunnerSchedule(source("HEAD", "scripts/run-tests.ts"))
      )
        paths = paths.filter((path) => path !== "scripts/run-tests.ts");
      const unitJob = (revision: string) => {
        const file = Bun.spawnSync(
          ["git", "show", `${revision}:.github/workflows/ci.yml`],
          { stdout: "pipe", stderr: "pipe" },
        );
        assert(file.exitCode === 0, "Cannot read CI unit job for comparison");
        const workflow = Bun.YAML.parse(file.stdout.toString()) as {
          jobs?: Record<string, unknown>;
        };
        const job = workflow?.jobs?.["unit-tests"];
        assert(job && typeof job === "object", "Missing CI unit job");
        return unitSchedule(job as Record<string, unknown>);
      };
      required = unitComparisonRequired(
        paths,
        !paths.includes(".github/workflows/ci.yml") ||
          unitJob(base) !== unitJob("HEAD"),
      );
    }
    appendFileSync(process.env.GITHUB_OUTPUT, `required=${required}\n`);
  } else {
    assert(command === "run" && shard, "Use required or run <shard>");
    await compare(shard);
  }
}
