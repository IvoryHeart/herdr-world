import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * Temporary directories for test runs. Every run gets its own directory,
 * exported as TMPDIR so tests, test Chrome profiles (`--user-data-dir`) and
 * Chrome's own scratch directories (com.google.Chrome.*,
 * .org.chromium.Chromium.*) land inside it. On exit, including failures and
 * SIGINT, SIGTERM or SIGHUP, the run kills any process still using the
 * directory (an orphaned Chrome) and deletes it. A run killed outright cannot
 * clean up, so each directory names its owner and later runs sweep the ones
 * whose owner has died. Directories outside these runs, such as a desktop
 * Chrome's, are never touched.
 */

export const RUN_TEMP_PREFIX = "hwt-";
const OWNER = ".herdr-world-owner";
// Directories from before owner notes existed are swept once this old.
const UNOWNED_STALE_MS = 24 * 60 * 60 * 1000;

export function createRunTemp(base = tmpdir()): string {
  const directory = mkdtempSync(join(base, RUN_TEMP_PREFIX));
  writeFileSync(
    join(directory, OWNER),
    JSON.stringify({ pid: process.pid, since: new Date().toISOString() }),
  );
  return directory;
}

export function isRunTemp(path: string | undefined): boolean {
  return !!path && basename(path).startsWith(RUN_TEMP_PREFIX);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** PIDs of this user's processes whose command line mentions the path. */
export function processesUsing(path: string): number[] {
  const listing = Bun.spawnSync(["ps", "-x", "-o", "pid=,args="], {
    stdout: "pipe",
    stderr: "ignore",
  });
  if (listing.exitCode !== 0) return [];
  return listing.stdout
    .toString()
    .split("\n")
    .map((line) => /^\s*(\d+)\s+(.*)$/.exec(line))
    .filter((match): match is RegExpExecArray => !!match)
    .filter(([, , args]) => args.includes(path))
    .map(([, pid]) => Number(pid))
    .filter((pid) => pid !== process.pid);
}

export function cleanupRunTemp(directory: string) {
  for (const pid of processesUsing(directory)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  rmSync(directory, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100,
  });
}

/** Remove run directories whose owning process is gone. */
export function sweepStaleRunTemps(
  base = tmpdir(),
  now = Date.now(),
): string[] {
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  const swept: string[] = [];
  for (const name of names) {
    if (!name.startsWith(RUN_TEMP_PREFIX)) continue;
    const directory = join(base, name);
    let stale: boolean;
    try {
      const owner = JSON.parse(readFileSync(join(directory, OWNER), "utf8"));
      stale = !alive(Number(owner.pid));
    } catch {
      try {
        stale =
          now - statSync(directory).mtimeMs > UNOWNED_STALE_MS &&
          processesUsing(directory).length === 0;
      } catch {
        continue;
      }
    }
    if (!stale) continue;
    cleanupRunTemp(directory);
    swept.push(directory);
  }
  return swept;
}

/**
 * Give this process a run directory as TMPDIR unless it already runs in one.
 * Returns the directory and its cleanup, or null when nothing was created.
 */
export function adoptRunTemp(): {
  directory: string;
  cleanup: () => void;
} | null {
  if (isRunTemp(process.env.TMPDIR)) return null;
  sweepStaleRunTemps();
  const directory = createRunTemp();
  for (const name of ["TMPDIR", "TMP", "TEMP"]) process.env[name] = directory;
  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    cleanupRunTemp(directory);
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(signal, () => {
      cleanup();
      process.exit(
        128 + (signal === "SIGINT" ? 2 : signal === "SIGTERM" ? 15 : 1),
      );
    });
  return { directory, cleanup };
}
