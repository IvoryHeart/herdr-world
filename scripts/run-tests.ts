import { mkdtempSync, rmSync } from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";

// Keep browser profiles and Bun WebView files inside one run-owned directory.
// A failed test can skip its own finally block when the runner exits early.
const args = process.argv.slice(2);
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
console.info(
  `[test-runner] ${testArgs.filter((arg) => arg.startsWith("--")).join(" ")}`,
);
const directory = mkdtempSync(join(tmpdir(), "hwt-"));

try {
  const child = Bun.spawn([process.execPath, "test", ...testArgs], {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      TMPDIR: directory,
      TMP: directory,
      TEMP: directory,
    },
  });
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
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}
