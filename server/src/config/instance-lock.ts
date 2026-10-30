import {
  closeSync,
  constants,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { assertSafeDataPath, dataRoot } from "./data-paths";

/** A lock still unreadable after this long was left by a crashed startup. */
const UNREADABLE_STALE_MS = 10_000;

type Holder = { pid: number; port: number };

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readHolder(path: string): Holder | "unreadable" | null {
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
    // A concurrent startup may not have written its holder yet.
  }
  return "unreadable";
}

/**
 * One listening World per data folder. Two would overwrite each other's
 * whole-file stores (ledger, Board, agent profiles), rotate each other's
 * session secret and both send Web Push. The lock names its holder and is
 * taken over when that process is gone. Returns the release.
 */
export function acquireInstanceLock(
  root: string,
  port: number,
  alive: (pid: number) => boolean = processAlive,
): () => void {
  const path = join(root, "instance.lock");
  assertSafeDataPath(path);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 3; attempt++) {
    let fd: number;
    try {
      fd = openSync(
        path,
        constants.O_CREAT |
          constants.O_EXCL |
          constants.O_WRONLY |
          (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const holder = readHolder(path);
      if (holder === "unreadable") {
        if (Date.now() - statSync(path).mtimeMs < UNREADABLE_STALE_MS)
          throw new Error(
            `another World is starting with the data folder ${root}; give this instance its own folder with HERDR_WORLD_DATA_DIR`,
            { cause: error },
          );
      } else if (holder && holder.pid !== process.pid && alive(holder.pid)) {
        throw new Error(
          `the data folder ${root} is in use by World (pid ${holder.pid}, port ${holder.port}); give this instance its own folder with HERDR_WORLD_DATA_DIR`,
          { cause: error },
        );
      }
      rmSync(path, { force: true });
      continue;
    }
    try {
      writeFileSync(fd, `${JSON.stringify({ pid: process.pid, port })}\n`);
    } finally {
      closeSync(fd);
    }
    return () => {
      const holder = readHolder(path);
      if (holder !== "unreadable" && holder?.pid === process.pid)
        rmSync(path, { force: true });
    };
  }
  throw new Error(`could not take the instance lock ${path}`);
}

/**
 * Claim the data folder for this listener until it exits, or stop: a second
 * World on one folder would overwrite the first one's files.
 */
export function claimDataFolder(port: number, root = dataRoot()): void {
  let release: () => void;
  try {
    release = acquireInstanceLock(root, port);
  } catch (cause) {
    console.error(`[bridge] FATAL: ${(cause as Error).message}`);
    process.exit(1);
  }
  process.on("exit", release);
}
