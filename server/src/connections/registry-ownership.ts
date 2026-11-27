import { Database } from "bun:sqlite";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { timing } from "../../../shared/timings";
import { assertSafeDataPath } from "../config/data-paths";

type Purpose = "edit" | "service";
type Claim = { purpose: Purpose; done: Promise<void> };
const claims = new Map<string, Claim>();

/**
 * A stable sidecar inode supplies OS-backed, process-scoped ownership. Never
 * rename/unlink it or steal it based on age: a paused owner still owns its
 * snapshot. SQLite releases the lock even after an ungraceful process exit.
 * The JSON format and its atomic publication remain unchanged.
 */
export async function acquireRegistryOwnership(
  registryPath: string,
  purpose: Purpose,
): Promise<() => void> {
  const path = join(
    realpathSync(dirname(registryPath)),
    `${basename(registryPath)}.ownership.sqlite`,
  );
  // Same-process edits must yield rather than block the event loop that will
  // release their predecessor. A live service is never an offline predecessor.
  for (;;) {
    const previous = claims.get(path);
    if (!previous) break;
    if (previous.purpose === "service") throw busy();
    await previous.done;
  }
  let complete!: () => void;
  const claim: Claim = {
    purpose,
    done: new Promise<void>((resolve) => {
      complete = resolve;
    }),
  };
  claims.set(path, claim);
  let db: Database | undefined;
  const release = () => {
    if (claims.get(path) !== claim) return;
    try {
      db?.close();
    } finally {
      claims.delete(path);
      complete();
    }
  };
  try {
    assertSafeDataPath(path);
    const fd = openSync(
      path,
      constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    let identity;
    try {
      identity = fstatSync(fd);
      if (
        !identity.isFile() ||
        identity.nlink !== 1 ||
        (process.platform !== "win32" && (identity.mode & 0o077) !== 0)
      )
        throw new Error(
          "connection registry ownership file must be a private regular file",
        );
    } finally {
      closeSync(fd);
    }
    db = new Database(path);
    // A bounded native wait serializes independent CLI processes. No expiring
    // lease, PID reuse inference or stale-owner deletion can authorize a write.
    db.exec(
      `PRAGMA busy_timeout=${timing("registryBusyWaitMs")}; BEGIN EXCLUSIVE`,
    );
    const current = lstatSync(path);
    if (current.dev !== identity.dev || current.ino !== identity.ino)
      throw new Error(
        "connection registry ownership file changed during acquisition",
      );
    return release;
  } catch (error) {
    release();
    if ((error as { code?: string }).code === "SQLITE_BUSY") throw busy();
    throw new Error(
      "could not establish connection registry ownership; no edit was saved",
      { cause: error },
    );
  }
}

function busy(): Error {
  return new Error(
    "connection registry is busy with another edit or World startup/service; no edit was saved. Retry after the edit finishes, or stop that World before editing offline",
  );
}
