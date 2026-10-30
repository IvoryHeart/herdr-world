import { availableParallelism } from "node:os";
import { join } from "node:path";
import { acquireAllCheckSlots, acquireCheckSlot, heldEnv } from "./check-lock";
import { warmChrome } from "./chrome-warmup";
import {
  assertWebBrowserInventory,
  assertWorldBrowserInventory,
  browserWorkflowIgnorePattern,
  webBrowserSuites,
  includesBrowserSuites,
  includesTimedSuites,
  worldBrowserIgnorePattern,
} from "./world-browser-suites";
import { cleanupRunTemp, createRunTemp, sweepStaleRunTemps } from "./test-temp";

// Keep browser profiles and Bun WebView files inside one run-owned directory.
// A failed test can skip its own finally block when the runner exits early.
// `--web-browser` selects the Chrome-driven suites outside World, which CI runs
// as their own job; HERDR_TEST_EXCLUDE_WORLD_BROWSER=1 leaves out everything
// that job and the World shards run.
const webBrowser = process.argv[2] === "--web-browser";
const args = webBrowser
  ? [...webBrowserSuites, ...process.argv.slice(3)]
  : process.argv.slice(2);
const excludeWorld = process.env.HERDR_TEST_EXCLUDE_WORLD_BROWSER === "1";
const runWorldAfter = args.length === 0 && !excludeWorld;
if (excludeWorld || runWorldAfter) await assertWorldBrowserInventory();
if (excludeWorld || webBrowser) await assertWebBrowserInventory();
const configuredParallelism = process.env.HERDR_TEST_PARALLEL;
const parallelism = configuredParallelism
  ? Number(configuredParallelism)
  : Math.min(availableParallelism(), 8);
const configuredMaxConcurrency = process.env.HERDR_TEST_MAX_CONCURRENCY;
const maxConcurrency = configuredMaxConcurrency
  ? Number(configuredMaxConcurrency)
  : 2;

if (!Number.isSafeInteger(parallelism) || parallelism < 1) {
  throw new Error("HERDR_TEST_PARALLEL must be a positive integer");
}
if (!Number.isSafeInteger(maxConcurrency) || maxConcurrency < 1) {
  throw new Error("HERDR_TEST_MAX_CONCURRENCY must be a positive integer");
}

// Bun runs files sequentially unless --parallel is set. Respect an explicit CLI
// value, then the environment override, and otherwise use up to eight CPUs.
const testArgs = args.some((arg) => /^--parallel(?:=|$)/.test(arg))
  ? args
  : [`--parallel=${parallelism}`, ...args];
if (!testArgs.some((arg) => /^--max-concurrency(?:=|$)/.test(arg)))
  testArgs.push(`--max-concurrency=${maxConcurrency}`);
if (excludeWorld)
  testArgs.push(`--path-ignore-patterns=${browserWorkflowIgnorePattern}`);
else if (runWorldAfter)
  testArgs.push(`--path-ignore-patterns=${worldBrowserIgnorePattern}`);
console.info(
  `[test-runner] ${testArgs.filter((arg) => arg.startsWith("--")).join(" ")}`,
);
// The run's TMPDIR holds test and Chrome scratch files; it is removed, with
// any process still using it, however the run ends (see test-temp.ts).
sweepStaleRunTemps();
// Timed or uncertain selections take the whole machine; other Chrome runs
// take its browser slot. Nested runners inherit the held-slot marker.
const usesBrowser = !excludeWorld && includesBrowserSuites(args);
const usesTimed = !excludeWorld && includesTimedSuites(args);
const releaseSlot = usesTimed
  ? await acquireAllCheckSlots({ lane: "timed browser tests" })
  : usesBrowser
    ? await acquireCheckSlot("browser", { lane: "browser tests" })
    : () => {};
const directory = createRunTemp();
// Once per CI job: nested runners inherit the flag.
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const warm = process.env.CI === "true" && process.env.HERDR_CHROME_WARM !== "1";
if (warm && chrome) await warmChrome(chrome);

try {
  const commands = [[process.execPath, "test", ...testArgs]];
  if (runWorldAfter)
    commands.push([process.execPath, "scripts/run-world-tests.ts"]);
  for (const command of commands) {
    const child = Bun.spawn(command, {
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        TMPDIR: directory,
        TMP: directory,
        TEMP: directory,
        // Never the user's World data (see test-temp-preload.ts).
        HERDR_WORLD_DATA_DIR: join(directory, "herdr-world-data"),
        ...(warm ? { HERDR_CHROME_WARM: "1" } : {}),
        ...(usesBrowser ? heldEnv("browser") : {}),
      },
    });
    const interrupt = () => child.kill("SIGINT");
    const terminate = () => child.kill("SIGTERM");
    const hangup = () => child.kill("SIGHUP");
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", terminate);
    process.on("SIGHUP", hangup);
    try {
      process.exitCode = await child.exited;
    } finally {
      process.off("SIGINT", interrupt);
      process.off("SIGTERM", terminate);
      process.off("SIGHUP", hangup);
    }
    if (process.exitCode !== 0) break;
  }
} finally {
  cleanupRunTemp(directory);
  releaseSlot();
}
