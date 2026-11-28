import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import type { ValidationSelection } from "./validation-scope";
import {
  UNIT_PARALLEL,
  unitNeedsBuild,
  unitTestShards,
} from "./ci-unit-shards";
import {
  worldBrowserParallelSuites,
  worldBrowserShards,
} from "./world-browser-suites";

export function selectedCITests(
  selection: ValidationSelection,
  lane: string,
  shard?: string,
): string[] {
  assert(["unit", "world", "web"].includes(lane), "Unknown CI test lane");
  let files = selection[lane as "unit" | "world" | "web"];
  assert(
    Array.isArray(files) &&
      files.every(
        (path) =>
          typeof path === "string" &&
          /^(?:scripts|web|server|shared|quint|tools|verification)\/.+\.test\.[cm]?[jt]sx?$/.test(
            path,
          ) &&
          !path.split("/").includes(".."),
      ),
    "Invalid CI test selection",
  );
  if (lane === "unit" && shard) {
    assert(/^[1234]\/4$/.test(shard), "Invalid unit shard");
    files = unitTestShards(files)[Number(shard[0]) - 1]!;
  }
  if (lane === "web" && shard) {
    assert(/^[12]\/2$/.test(shard), "Invalid test shard");
    files = files.filter((_, index) => index % 2 === Number(shard[0]) - 1);
  }
  if (lane === "world" && shard) {
    const index = Number(shard) - 1;
    assert(
      Number.isInteger(index) && worldBrowserShards[index],
      "Invalid World shard",
    );
    files = files.filter((path) => worldBrowserShards[index]!.includes(path));
  }
  return files;
}

export function ciTestBatches(
  selection: ValidationSelection,
  lane: string,
  shard?: string,
) {
  const files = selectedCITests(selection, lane, shard);
  if (lane !== "world")
    return files.length
      ? [{ files, parallel: lane === "unit" ? UNIT_PARALLEL : 2 }]
      : [];
  const parallel = new Set(worldBrowserParallelSuites);
  return [
    { files: files.filter((file) => !parallel.has(file)), parallel: 1 },
    { files: files.filter((file) => parallel.has(file)), parallel: 2 },
  ].filter((batch) => batch.files.length);
}

if (import.meta.main) {
  const [lane, shard, ...options] = process.argv.slice(2);
  const selection = JSON.parse(
    process.env.HERDR_CI_SELECTION || "null",
  ) as ValidationSelection;
  assert(selection && lane, "Missing CI selection");
  if (options.includes("--plan")) {
    assert(
      lane === "unit" && process.env.GITHUB_OUTPUT,
      "Unit plan needs GITHUB_OUTPUT",
    );
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `build=${unitNeedsBuild(selectedCITests(selection, lane, shard))}\n`,
    );
    process.exit(0);
  }
  const unitRun = options
    .find((option) => option.startsWith("--unit-run="))
    ?.slice("--unit-run=".length);
  assert(
    !unitRun ||
      (lane === "unit" &&
        /^comparison-([1-9]|1[0-9]|20)-(serial|parallel)$/.test(unitRun)),
    "Invalid unit comparison run",
  );
  const runSuffix = unitRun ? `-${unitRun}` : "";
  const runs =
    lane === "world" ? Number(process.env.HERDR_CI_WORLD_RUNS || 1) : 1;
  assert(runs === 1 || runs === 3, "World browser runs must be 1 or 3");
  const batches = ciTestBatches(selection, lane, shard);
  if (!batches.length) {
    console.info(`${lane}: no affected suites`);
    mkdirSync(".agents/delivery", { recursive: true });
    writeFileSync(
      `.agents/delivery/flakes-${lane}-${shard?.replace("/", "-of-") || "all"}-empty-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
      JSON.stringify({ files: [], flaky: [] }),
    );
  }
  passes: for (let pass = 1; pass <= runs; pass++) {
    for (const batch of batches) {
      const { files } = batch;
      const parallel = unitRun?.endsWith("-serial") ? 1 : batch.parallel;
      mkdirSync(".agents/delivery", { recursive: true });
      const child = Bun.spawn(
        [
          process.execPath,
          lane === "world"
            ? "scripts/run-world-tests.ts"
            : "scripts/run-tests.ts",
          ...files,
          `--parallel=${parallel}`,
          `--max-concurrency=${lane === "world" ? 1 : 2}`,
          ...(lane === "unit"
            ? ["--timings=scripts/ci-unit-timings.json"]
            : []),
          `--retry-flaky=${lane === "unit" ? "unit" : "browser"}`,
          `--flake-report=.agents/delivery/flakes-${lane}-${shard?.replace("/", "-of-") || "all"}-${pass}-${parallel}-${process.env.GITHUB_RUN_ATTEMPT || "local"}${runSuffix}.json`,
          ...(lane !== "world"
            ? [
                "--reporter=junit",
                `--reporter-outfile=.agents/delivery/${lane === "web" ? "web-browser" : lane}-${shard?.replace("/", "-of-") || "all"}${runSuffix}.xml`,
              ]
            : []),
        ],
        {
          stdin: "inherit",
          stdout: "inherit",
          stderr: "inherit",
          env: {
            ...process.env,
            ...(lane === "world"
              ? {
                  HERDR_WORLD_TEST_LABEL: `${process.env.HERDR_WORLD_TEST_LABEL || "local"}${runs > 1 ? `-pass-${pass}` : ""}-${parallel === 1 ? "isolated" : "parallel"}`,
                }
              : {}),
          },
        },
      );
      const stop = () => child.kill("SIGTERM");
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
      try {
        process.exitCode = await child.exited;
      } finally {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
      if (process.exitCode !== 0) break passes;
    }
  }
}
