import { dlopen, FFIType } from "bun:ffi";
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

/**
 * A machine-wide queue for heavy local checks, shared by every worktree and
 * clone on this machine. Each class of work has a number of slots, and a slot
 * is an flock(2) on a file:
 *
 *   browser       1   World browser suites and Chrome-driven tests
 *   verification  1   behavioral verification
 *   light         2   static checks and unit tests
 *
 * The local gate's quiet lane (contention-sensitive Chrome tests outside
 * World) needs the whole machine, so it takes every slot of every class
 * (acquireAllCheckSlots), in one fixed order: it waits for the running
 * heavy lanes to finish, and nothing heavy starts beside it. An
 * exclusive admission lock prevents later ordinary arrivals overtaking them.
 *
 * The kernel releases a lock when its holder exits, however it exits, so a
 * dead process never leaves a stale lock behind; the holder note beside each
 * slot only says who is waiting on whom. Locks are not inherited by child
 * processes (files open close-on-exec), so an orphaned Chrome cannot keep a
 * slot. A lane holds one slot, or all of them in the fixed order, and never
 * waits while holding a slot another waiter needs out of order; children of
 * a holder skip their own acquisition (HERDR_WORLD_CHECK_LOCK). So two gates
 * cannot deadlock waiting for each other. CI runs on its own runner and skips the
 * queue.
 */

export type CheckClass = "browser" | "verification" | "light";

export const CHECK_SLOTS: Record<CheckClass, number> = {
  browser: 1,
  verification: 1,
  light: 2,
};

/** Set for children of a slot holder, which run inside that slot. */
export const HELD_ENV = "HERDR_WORLD_CHECK_LOCK";

const LOCK_EX = 2;
const LOCK_SH = 1;
const LOCK_NB = 4;

type Flock = (fd: number, operation: number) => number;

let flock: Flock | null | undefined;
function loadFlock(): Flock | null {
  if (flock !== undefined) return flock;
  try {
    const library = dlopen(
      process.platform === "darwin" ? "libc.dylib" : "libc.so.6",
      { flock: { args: [FFIType.i32, FFIType.i32], returns: FFIType.i32 } },
    );
    flock = (fd, operation) => library.symbols.flock(fd, operation);
  } catch {
    flock = null;
  }
  return flock;
}

export function defaultLockDir(): string {
  const runtime = process.env.XDG_RUNTIME_DIR;
  return runtime
    ? join(runtime, "herdr-world-checks")
    : join(tmpdir(), `herdr-world-checks-${process.getuid?.() ?? "user"}`);
}

export interface Holder {
  pid: number;
  worktree: string;
  lane: string;
  since: string;
}

export interface AcquireOptions {
  /** What the holder note calls this work. */
  lane: string;
  /** The worktree or checkout running it; defaults to the current one. */
  worktree?: string;
  dir?: string;
  slots?: number;
  pollMs?: number;
  log?: (message: string) => void;
  env?: Record<string, string | undefined>;
}

export type Release = () => void;

function readHolder(path: string): Holder | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Holder;
  } catch {
    return null;
  }
}

function describe(holders: (Holder | null)[]): string {
  const known = holders.filter((holder): holder is Holder => !!holder);
  if (!known.length) return "another check";
  return known
    .map(
      (holder) =>
        `${holder.worktree} ${holder.lane} (pid ${holder.pid}, since ${holder.since})`,
    )
    .join("; ");
}

/**
 * Wait for a slot of `name` and hold it until the returned release is called
 * or the process exits. Returns a no-op release in CI, for children of a
 * holder, and where flock is unavailable.
 */
export async function acquireCheckSlot(
  name: CheckClass,
  options: AcquireOptions,
): Promise<Release> {
  return acquire([name], options);
}

/** Wait for every slot of every class, for a lane that needs the whole machine. */
export async function acquireAllCheckSlots(
  options: AcquireOptions,
): Promise<Release> {
  return acquire(Object.keys(CHECK_SLOTS) as CheckClass[], options, true);
}

async function acquire(
  names: CheckClass[],
  options: AcquireOptions,
  all = false,
): Promise<Release> {
  const env = options.env ?? process.env;
  const log = options.log ?? ((message: string) => console.info(message));
  if (env.CI === "true" || env[HELD_ENV]) return () => {};
  const lock = loadFlock();
  if (!lock) {
    log("[queue] machine-wide check queue unavailable here; running unqueued");
    return () => {};
  }
  const dir = options.dir ?? defaultLockDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const holder: Holder = {
    pid: process.pid,
    worktree: options.worktree ?? basename(process.cwd()),
    lane: options.lane,
    since: "",
  };
  const take = (path: string): Release | undefined => {
    const fd = openSync(`${path}.lock`, "a");
    if (lock(fd, LOCK_EX | LOCK_NB) !== 0) {
      closeSync(fd);
      return undefined;
    }
    holder.since = new Date().toISOString();
    writeFileSync(`${path}.json`, `${JSON.stringify(holder)}\n`);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      closeSync(fd); // closing the only descriptor drops the lock
    };
  };
  let lastReport = "";
  const wait = async (paths: string[]) => {
    const report = `[queue] ${options.lane} waiting for ${describe(
      paths.map((path) => readHolder(`${path}.json`)),
    )}`;
    if (report !== lastReport) {
      log(report);
      lastReport = report;
    }
    await Bun.sleep(options.pollMs ?? 1000);
  };
  const slotPaths = (name: CheckClass) =>
    Array.from(
      {
        length:
          name === names[0] && !all && options.slots
            ? options.slots
            : CHECK_SLOTS[name],
      },
      (_, slot) => join(dir, `${name}.${slot}`),
    );
  if (!all) {
    const paths = slotPaths(names[0]!);
    for (;;) {
      // Hold admission only while trying a slot, never while waiting for one.
      const intent = join(dir, "all.intent");
      const admission = openSync(`${intent}.lock`, "a");
      const admitted = lock(admission, LOCK_SH | LOCK_NB) === 0;
      try {
        if (admitted)
          for (const path of paths) {
            const release = take(path);
            if (release) return release;
          }
      } finally {
        closeSync(admission);
      }
      await wait(admitted ? paths : [intent]);
    }
  }
  // Reserve admission before waiting for any slot. Existing work can finish,
  // but later ordinary requests cannot keep stealing newly freed slots.
  const held: Release[] = [];
  const intent = join(dir, "all.intent");
  try {
    let release = take(intent);
    while (!release) {
      await wait([intent]);
      release = take(intent);
    }
    held.push(release);
    // One fixed order also prevents cycles between whole-machine waiters.
    for (const name of names)
      for (const path of slotPaths(name)) {
        let release = take(path);
        while (!release) {
          await wait([path]);
          release = take(path);
        }
        held.push(release);
      }
  } catch (error) {
    for (const release of held.reverse()) release();
    throw error;
  }
  return () => {
    for (const release of held.reverse()) release();
  };
}

/** Environment for children that run inside the caller's slot. */
export function heldEnv(name: CheckClass): Record<string, string> {
  return { [HELD_ENV]: name };
}
