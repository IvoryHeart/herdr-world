import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { selectedCITests } from "./ci-tests";
import { worldBrowserShards } from "./world-browser-suites";
import type { ValidationSelection } from "./validation-scope";

// Keep browser scheduling separate from the proven unit execution path.
const [shard] = process.argv.slice(2);
const selection = JSON.parse(
  process.env.HERDR_CI_SELECTION || "null",
) as ValidationSelection;
assert(selection && shard, "Missing World selection or shard");
const files = selectedCITests(selection, "world", shard);
if (!files.length) {
  mkdirSync(".agents/delivery", { recursive: true });
  writeFileSync(
    `.agents/delivery/flakes-world-${shard}-empty.json`,
    JSON.stringify({ files: [], flaky: [] }),
  );
  process.exit(0);
}
const runs = Number(process.env.HERDR_CI_WORLD_RUNS || 1);
assert(runs === 1 || runs === 3, "World browser runs must be 1 or 3");
for (let pass = 1; pass <= runs; pass++) {
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/run-world-tests.ts",
      ...files,
      `--shard=${shard}/${worldBrowserShards.length}`,
      "--parallel=2",
      "--max-concurrency=1",
      "--retry-flaky=browser",
      `--flake-report=.agents/delivery/flakes-world-${shard}-${pass}-${process.env.GITHUB_RUN_ATTEMPT || "local"}.json`,
    ],
    {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        HERDR_WORLD_TEST_LABEL: `shard-${shard}-of-${worldBrowserShards.length}-pass-${pass}`,
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
  if (process.exitCode !== 0) break;
}
