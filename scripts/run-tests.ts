import { retryTests } from "./test-retry";
import { fileURLToPath } from "node:url";
import { availableParallelism } from "node:os";
import {
  isolatedTestEnv,
  liveTestArgs,
  tripwireFailures,
} from "./test-isolation";
import { acquireCheckSlot, heldEnv } from "./check-lock";
import { warmChrome } from "./chrome-warmup";
import {
  assertWebBrowserInventory,
  assertWorldBrowserInventory,
  browserWorkflowIgnorePattern,
  webBrowserPages,
  webBrowserSuites,
  includesBrowserSuites,
  includesSharedChromeSuites,
  worldBrowserIgnorePattern,
} from "./world-browser-suites";
import { cleanupRunTemp, createRunTemp, sweepStaleRunTemps } from "./test-temp";
import {
  SHARED_CHROME_ENV,
  startSharedChrome,
} from "../web/src/testing/chromeBrowser";

// Keep browser profiles and Bun WebView files inside one run-owned directory.
// A failed test can skip its own finally block when the runner exits early.
// `--web-browser` selects the Chrome-driven suites outside World, which CI runs
// as their own job; HERDR_TEST_EXCLUDE_WORLD_BROWSER=1 leaves out everything
// that job and the World shards run.
const runnerArgs = process.argv.slice(2);
const retryKind = runnerArgs
  .find((arg) => arg.startsWith("--retry-flaky="))
  ?.split("=")[1];
const flakeReport = runnerArgs
  .find((arg) => arg.startsWith("--flake-report="))
  ?.slice("--flake-report=".length);
if (retryKind && (!["unit", "browser"].includes(retryKind) || !flakeReport))
  throw new Error("Retry requires unit/browser mode and a flake report");
const selection = liveTestArgs(
  runnerArgs.filter((arg) => !/^--(?:retry-flaky|flake-report)=/.test(arg)),
);
if (retryKind && selection.live) throw new Error("Live checks never retry");
const webBrowser = selection.args[0] === "--web-browser";
const args = webBrowser
  ? [...webBrowserSuites, ...selection.args.slice(1)]
  : selection.args;
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
  : webBrowser
    ? webBrowserPages()
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
// Chrome runs, and selections that may include one, take the machine's
// browser slot. Nested runners inherit the held-slot marker.
const usesBrowser = !excludeWorld && includesBrowserSuites(args);
const releaseSlot = usesBrowser
  ? await acquireCheckSlot("browser", { lane: "browser tests" })
  : () => {};
const directory = createRunTemp();
const env = isolatedTestEnv(directory, process.env, selection.live);
// Warm browser selections once; unit/live resource controls must not spend
// their own deadlines starting an unrelated browser. Nested runners inherit it.
const chrome =
  Bun.env.CHROME_BIN || Bun.which("google-chrome") || Bun.which("chromium");
const warm =
  usesBrowser &&
  process.env.CI === "true" &&
  process.env.HERDR_CHROME_WARM !== "1";
if (warm && chrome) await warmChrome(chrome, { env });
// One Chrome for the whole run: every browser case opens its own context in
// it (web/src/testing/chromeBrowser.ts). A nested runner inherits it.
const sharedChrome =
  usesBrowser &&
  chrome &&
  !env[SHARED_CHROME_ENV] &&
  includesSharedChromeSuites(args)
    ? await startSharedChrome(env).catch((error: Error) => {
        // Each test file then starts its own Chrome.
        console.warn(`[test-runner] shared Chrome: ${error.message}`);
        return undefined;
      })
    : undefined;
Object.assign(env, sharedChrome?.env);

try {
  const commands = [
    [
      process.execPath,
      "test",
      "--preload",
      fileURLToPath(new URL("./test-temp-preload.ts", import.meta.url)),
      ...testArgs,
    ],
  ];
  if (runWorldAfter)
    commands.push([process.execPath, "scripts/run-world-tests.ts"]);
  for (const command of commands) {
    const run = async (command: string[]) => {
      const child = Bun.spawn(command, {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: {
          ...env,
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
        const code = await child.exited;
        const failures = tripwireFailures(env);
        if (failures) {
          console.error(failures);
          return 1;
        }
        return code;
      } finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", terminate);
        process.off("SIGHUP", hangup);
      }
    };
    const junit = testArgs
      .find((arg) => arg.startsWith("--reporter-outfile="))
      ?.slice("--reporter-outfile=".length);
    process.exitCode =
      retryKind && command[1] === "test"
        ? await retryTests({
            kind: retryKind as "unit" | "browser",
            report: flakeReport!,
            junit:
              junit ||
              (() => {
                throw new Error("Retry requires JUnit output");
              })(),
            command,
            run,
            healthy: () => !tripwireFailures(env),
          })
        : await run(command);
    if (process.exitCode !== 0) break;
  }
} finally {
  await sharedChrome?.stop();
  cleanupRunTemp(directory);
  releaseSlot();
}
