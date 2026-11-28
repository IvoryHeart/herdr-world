import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { localTestChrome } from "./test-chrome";
import { buildWorldBrowserBundle } from "../web/src/world/testing/browserBundles";
import { acquireCheckSlot, heldEnv } from "./check-lock";
import {
  assertWorldBrowserInventory,
  selectWorldBrowserShard,
  worldBrowserSuites,
  worldBrowserCasePlan,
} from "./world-browser-suites";
import timings from "./world-browser-timings.json";
import {
  executeWorldBrowserCases,
  worldCaseConcurrency,
  worldCaseTestArgs,
} from "./world-browser-cases";

// Named suites narrow the shard, or select whole files without --shard.
const allArgs = process.argv.slice(2);
const named = allArgs.filter((arg) => worldBrowserSuites.includes(arg));
const args = allArgs.filter((arg) => !named.includes(arg));
const shardArg = args.find((arg) => arg.startsWith("--shard="));
const shard = shardArg?.slice("--shard=".length);
if (
  args.some((arg) => arg.startsWith("--shard") && arg !== shardArg) ||
  (shardArg && !shard)
) {
  throw new Error(
    `Use --shard=i/${worldBrowserCasePlan.length} to select World browser suites`,
  );
}
const shardFiles = selectWorldBrowserShard(shard);
const files = named.length
  ? named.filter((file) => shardFiles.includes(file))
  : shardFiles;
const testArgs = args.filter((arg) => arg !== shardArg);
await assertWorldBrowserInventory();
const chrome =
  (await localTestChrome()) ||
  Bun.which("google-chrome") ||
  Bun.which("chromium") ||
  (process.platform === "darwin"
    ? Bun.which("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    : null);
if (!chrome || !Bun.which(chrome))
  throw new Error(
    "World browser tests require Chrome/Chromium or CHROME_BIN; no scenarios may be skipped in this runner",
  );

const directory = await mkdtemp(join(tmpdir(), "world-browser-run-"));
const label = shard
  ? `shard-${shard.replace("/", "-of-")}`
  : (Bun.env.HERDR_WORLD_TEST_LABEL ?? "local");
await mkdir(".agents/delivery", { recursive: true });
// World runs take the browser slot. A nested runner already holds its
// parent's slot and skips acquisition.
const release = await acquireCheckSlot("browser", { lane: `world ${label}` });
try {
  const began = performance.now();
  await buildWorldBrowserBundle("HostsFilter", directory);
  if (files.some((path) => path.includes("AnswerDeliveries.browser")))
    await buildWorldBrowserBundle("AnswerDeliveries", directory);
  if (files.some((path) => path.includes("ProductionContexts"))) {
    await buildWorldBrowserBundle("ProductionContexts", directory);
  }
  console.info(
    `[world-test-runner] ${label}: ${files.length} files; shared bundles built in ${Math.round(performance.now() - began)}ms`,
  );
  if (files.some((path) => path.includes("/town/TownCanvas")))
    await buildWorldBrowserBundle("town/TownCanvas", directory);
  if (files.some((path) => path.includes("/SharedViewCreation")))
    await buildWorldBrowserBundle("SharedViewCreation", directory);
  const run = async (
    paths: string[],
    suffix: string,
    selection: string[] = [],
  ) => {
    const child = Bun.spawn(
      [
        process.execPath,
        "scripts/run-tests.ts",
        ...paths,
        ...selection,
        ...(!testArgs.some((arg) => /^--parallel(?:=|$)/.test(arg))
          ? [
              `--parallel=${shard ? 1 : Bun.env.HERDR_TEST_PARALLEL || Math.min(availableParallelism(), 4)}`,
            ]
          : []),
        ...(!testArgs.some((arg) => /^--max-concurrency(?:=|$)/.test(arg))
          ? ["--max-concurrency=1"]
          : []),
        `--timings=.agents/delivery/world-${label}${suffix}.timings.json`,
        "--update-timings",
        "--reporter=junit",
        `--reporter-outfile=.agents/delivery/world-${label}${suffix}.xml`,
        ...testArgs.map((arg) =>
          arg.startsWith("--flake-report=")
            ? arg.replace(/\.json$/, `${suffix}.json`)
            : arg,
        ),
      ],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...process.env,
          CHROME_BIN: chrome,
          HERDR_WORLD_TEST_ASSETS: directory,
          HERDR_TEST_EXCLUDE_WORLD_BROWSER: "0",
          ...heldEnv("browser"),
        },
      },
    );
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    try {
      return await child.exited;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
    }
  };
  if (shard) {
    if (testArgs.some((arg) => /^(?:-t|--test-name-pattern)(?:=|$)/.test(arg)))
      throw new Error("A case shard cannot also narrow test names");
    const workers = worldBrowserCasePlan[Number(shard.split("/")[0]) - 1]!;
    const concurrency = worldCaseConcurrency(testArgs);
    console.info(
      `[world-test-runner] ${label}: ${workers.length} isolated workers, concurrency ${concurrency}; recorded loads ${workers.map((tasks) => Math.round(tasks.filter((task) => files.includes(task.file)).reduce((sum, task) => sum + task.seconds, 0))).join(" / ")} seconds`,
    );
    process.exitCode = await executeWorldBrowserCases(
      workers,
      files,
      (task, worker, index) =>
        run(
          [`./${task.file}`],
          `-worker-${worker + 1}-file-${index + 1}`,
          worldCaseTestArgs(task, timings.cases),
        ),
      concurrency,
    );
  } else {
    process.exitCode = await run(files, "");
  }
  console.info(
    `[world-test-runner] ${label}: completed in ${((performance.now() - began) / 1000).toFixed(1)} seconds`,
  );
} finally {
  release();
  await rm(directory, { recursive: true, force: true });
}
