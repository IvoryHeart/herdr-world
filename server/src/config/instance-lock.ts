import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { lockSync } from "proper-lockfile";
import { assertSafeDataPath } from "./data-paths";

/** How long a starting World waits for another one's startup check. */
const CLAIM_WAIT_MS = 5_000;
/** A claim this old was left by a startup that crashed mid-check. */
const CLAIM_STALE_MS = 10_000;
const claimWait = new Int32Array(new SharedArrayBuffer(4));

type Holder = { pid: number; port: number };

/** Folders held by live World services in this process. */
const heldRoots = new Set<string>();

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** The lock's holder, or null when there is none or it cannot be read. */
function readHolder(path: string): Holder | null {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  try {
    const holder = JSON.parse(text) as Partial<Holder>;
    if (Number.isInteger(holder.pid) && Number(holder.pid) > 0)
      return { pid: Number(holder.pid), port: Number(holder.port) };
  } catch {
    // Written only under the claim, so unreadable means a crashed startup.
  }
  return null;
}

/**
 * Starting Worlds take turns: the check, a dead holder's removal and the new
 * lock happen under one short claim, so two starts cannot both take over.
 */
function claimStartup(path: string, root: string, waitMs: number): () => void {
  const deadline = performance.now() + waitMs;
  for (;;) {
    try {
      return lockSync(path, {
        realpath: false,
        lockfilePath: `${path}.claim`,
        retries: 0,
        stale: CLAIM_STALE_MS,
        update: 1_000,
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ELOCKED") throw error;
      if (performance.now() >= deadline)
        throw new Error(
          `another World is starting with the data folder ${root}; give this instance its own folder with HERDR_WORLD_DATA_DIR`,
          { cause: error },
        );
      Atomics.wait(claimWait, 0, 0, 25);
    }
  }
}

/**
 * One listening World per data folder. Two would overwrite each other's
 * whole-file stores (ledger, Board, agent profiles), rotate each other's
 * session secret and both send Web Push. The lock names its holder and is
 * taken over when that process is gone. Services in one process share its ID,
 * so the folders they hold are also kept here. Returns the release.
 */
export function acquireInstanceLock(
  root: string,
  port: number,
  alive: (pid: number) => boolean = processAlive,
  waitMs = CLAIM_WAIT_MS,
): () => void {
  const path = join(root, "instance.lock");
  assertSafeDataPath(path);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const held = resolve(root);
  const releaseClaim = claimStartup(path, root, waitMs);
  try {
    const holder = readHolder(path);
    if (
      holder &&
      (holder.pid === process.pid ? heldRoots.has(held) : alive(holder.pid))
    )
      throw new Error(
        `the data folder ${root} is in use by World (pid ${holder.pid}, port ${holder.port}); give this instance its own folder with HERDR_WORLD_DATA_DIR`,
      );
    rmSync(path, { force: true });
    const fd = openSync(
      path,
      constants.O_CREAT |
        constants.O_EXCL |
        constants.O_WRONLY |
        (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    try {
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, port })}\n`);
    } finally {
      closeSync(fd);
    }
    heldRoots.add(held);
  } finally {
    releaseClaim();
  }
  // Only this live process could replace its own lock, so no claim is needed.
  let released = false;
  return () => {
    if (released) return;
    released = true;
    heldRoots.delete(held);
    if (readHolder(path)?.pid === process.pid) rmSync(path, { force: true });
  };
}
