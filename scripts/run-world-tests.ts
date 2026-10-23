import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { buildWorldBrowserBundle } from "../web/src/world/testing/browserBundles";
import { guardDiskSpace } from "./disk-guard";
import {
  assertWorldBrowserInventory,
  selectWorldBrowserShard,
  worldBrowserSuites,
} from "./world-browser-suites";

// Suites named on the command line replace the shard selection.
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
    "Use --shard=i/6 or --shard=latency to select World browser suites",
  );
}
if (named.length && shard)
  throw new Error("Name World browser suites or a shard, not both");
const files = named.length ? named : selectWorldBrowserShard(shard);
const testArgs = args.filter((arg) => arg !== shardArg);
guardDiskSpace("the World browser suites");
await assertWorldBrowserInventory();
const chrome =
  Bun.env.CHROME_BIN ||
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
try {
  const began = performance.now();
  await buildWorldBrowserBundle("HostsFilter", directory);
  if (files.some((path) => path.includes("ProductionContexts"))) {
    await buildWorldBrowserBundle("ProductionContexts", directory);
  }
  console.info(
    `[world-test-runner] ${label}: ${files.length} files; shared bundles built in ${Math.round(performance.now() - began)}ms`,
  );
  const child = Bun.spawn(
    [
      process.execPath,
      "scripts/run-tests.ts",
      ...files,
      ...(!testArgs.some((arg) => /^--parallel(?:=|$)/.test(arg))
        ? [
            `--parallel=${shard ? 1 : Bun.env.HERDR_TEST_PARALLEL || Math.min(availableParallelism(), 4)}`,
          ]
        : []),
      ...(!testArgs.some((arg) => /^--max-concurrency(?:=|$)/.test(arg))
        ? ["--max-concurrency=1"]
        : []),
      `--timings=.agents/delivery/world-${label}.timings.json`,
      "--update-timings",
      "--reporter=junit",
      `--reporter-outfile=.agents/delivery/world-${label}.xml`,
      ...testArgs,
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
      },
    },
  );
  const interrupt = () => child.kill("SIGINT");
  const terminate = () => child.kill("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    process.exitCode = await child.exited;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}
