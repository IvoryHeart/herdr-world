/**
 * A hard limit per test file. A file whose tests, hooks or module load run
 * past it (a wait on a timer nothing advances, a socket nobody answers) stops
 * its test process with a line naming the file, so Bun reports that file as
 * failed (`worker crashed: exit code 124`) instead of the job running until
 * its own timeout. Each test still has Bun's per-test timeout; this bounds
 * what that does not cover: module load, hooks and tests with long limits.
 *
 * The limit is generous (about three times the slowest recorded file) and
 * never extended per file: a file that needs more is split.
 */
import { readFileSync } from "node:fs";
import { CHROME } from "./affected";

/** @internal Unit files: the slowest recorded on CI takes about 55 s. */
export const UNIT_FILE_LIMIT_MS = 180_000;
/** @internal Chrome-driven files: the slowest recorded World file takes about 140 s. */
export const BROWSER_FILE_LIMIT_MS = 300_000;
/** @internal `--live` checks talk to real runtimes. */
export const LIVE_FILE_LIMIT_MS = 600_000;
/** @internal */
export const FILE_LIMIT_ENV = "HERDR_TEST_FILE_TIMEOUT_MS";
export const FILE_TIMEOUT_EXIT = 124;

/** @internal */
export function fileLimitMs(
  file: string,
  env: NodeJS.ProcessEnv,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): number {
  const configured = env[FILE_LIMIT_ENV];
  if (configured) {
    const limit = Number(configured);
    if (!Number.isSafeInteger(limit) || limit < 1)
      throw new Error(`${FILE_LIMIT_ENV} must be a positive integer`);
    return limit;
  }
  if (/\.live\.test\.tsx?$/.test(file)) return LIVE_FILE_LIMIT_MS;
  let source = "";
  try {
    source = read(file);
  } catch {}
  return /^\/\/ @world-browser-suite\b/m.test(source) || CHROME.test(source)
    ? BROWSER_FILE_LIMIT_MS
    : UNIT_FILE_LIMIT_MS;
}

type Timers = {
  setTimeout: (run: () => void, ms: number) => { unref?: () => void };
  clearTimeout: (timer: never) => void;
};

/**
 * Arm the watchdog for one test process. `current()` names the file now
 * running (Bun.main, which Bun sets per file). The timers are the real ones,
 * captured before any test installs a fake clock. @internal
 */
export function fileWatchdog(options: {
  current: () => string;
  limitFor: (file: string) => number;
  timers: Timers;
  stop: (message: string) => void;
}) {
  let timer: ReturnType<Timers["setTimeout"]> | undefined;
  const arm = (label: (file: string) => string) => {
    if (timer) options.timers.clearTimeout(timer as never);
    const file = options.current();
    const limit = options.limitFor(file);
    timer = options.timers.setTimeout(() => {
      options.stop(
        `[test-file-timeout] ${label(options.current())} ran over its ${Math.round(limit / 1000)} s file limit; stopping its test process`,
      );
    }, limit);
    timer.unref?.();
  };
  return {
    /** A file's tests start (its module has loaded). */
    start: () => arm((file) => file),
    /** A file finished: the next file's module load counts from now. */
    finish: () => arm((file) => `${file} (or the file loading after it)`),
  };
}
