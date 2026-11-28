import {
  mkdtempSync,
  mkdirSync,
  closeSync,
  fstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";

/** A wrapper-owned real-time boundary; stopped clocks cannot stop it. */
export const FILE_TIMEOUT_MS = 120_000;
export const FILE_DEADLINES_ENV = "HERDR_TEST_FILE_DEADLINES";

/** File workers publish atomic markers; Bun parallel workers have no IPC channel. */
function fileMarker(file: string) {
  const directory = process.env[FILE_DEADLINES_ENV];
  if (!directory)
    throw new Error("File deadlines require scripts/run-tests.ts");
  const identity = createHash("sha256").update(file).digest("hex");
  return join(directory, `${identity}.json`);
}

export function fileDeadline(file: string) {
  const marker = fileMarker(file);
  writeFileSync(marker + ".tmp", JSON.stringify({ file, token: randomUUID() }));
  renameSync(marker + ".tmp", marker);
}

export function clearFileDeadline(file: string) {
  rmSync(fileMarker(file), { force: true });
}

/** Native file events wake the parent, outside all test clocks and workers. */
export function watchTestFiles(
  directory: string,
  expired: (file: string, limit: number) => void,
  observe: (changed: (filename: string | null) => void) => () => void = (
    changed,
  ) => {
    const observer = watch(directory, (_event, filename) => changed(filename));
    return () => observer.close();
  },
) {
  const limit = Number(
    process.env.HERDR_TEST_FILE_TIMEOUT_MS || FILE_TIMEOUT_MS,
  );
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FILE_TIMEOUT_MS)
    throw new Error(`HERDR_TEST_FILE_TIMEOUT_MS must be 1..${FILE_TIMEOUT_MS}`);
  mkdirSync(directory, { recursive: true });
  let closed = false;
  type Marker = { file: string; token: string; startedAt: number };
  const timers = new Map<
    string,
    { token: string; timer: ReturnType<typeof setTimeout> }
  >();
  const readMarker = (marker: string): Marker | undefined => {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(marker, "r");
      return {
        ...JSON.parse(readFileSync(descriptor, "utf8")),
        // Filesystem time cannot be frozen by Bun's Date/performance/hrtime mocks.
        // Read one inode so a concurrent rename cannot mix two generations.
        startedAt: fstatSync(descriptor).mtimeMs,
      };
    } catch {
      return undefined;
    } finally {
      if (descriptor !== undefined) closeSync(descriptor);
    }
  };
  const disarm = (marker: string) => {
    clearTimeout(timers.get(marker)?.timer);
    timers.delete(marker);
  };
  const arm = (marker: string, entry: Marker) => {
    if (timers.get(marker)?.token === entry.token) return;
    disarm(marker);
    timers.set(marker, {
      token: entry.token,
      timer: setTimeout(
        () => {
          disarm(marker);
          // Watch events can be coalesced or lost. The marker and its start token,
          // rather than a remembered event, decide whether this file is still live.
          const current = readMarker(marker);
          if (current?.token === entry.token) expired(current.file, limit);
          else if (current) arm(marker, current);
        },
        Math.max(0, entry.startedAt + limit - Date.now()),
      ),
    });
  };
  const stopObserving = observe((filename) => {
    if (closed || !filename?.endsWith(".json")) return;
    const marker = join(directory, filename);
    const entry = readMarker(marker);
    if (entry) arm(marker, entry);
    else disarm(marker);
  });
  return () => {
    closed = true;
    stopObserving();
    for (const { timer } of timers.values()) clearTimeout(timer);
    timers.clear();
  };
}

/** The normal child invocation and schedule, plus a parent-owned failure bound. */
export function spawnTestBatch(
  command: string[],
  options: Parameters<typeof Bun.spawn>[1],
) {
  const directory = mkdtempSync(
    join(options?.env?.TMPDIR || tmpdir(), "test-file-deadlines-"),
  );
  let timedOut = false;
  const close = watchTestFiles(directory, (file, limit) => {
    timedOut = true;
    console.error(
      `[test-file-timeout] ${file} exceeded ${limit} ms (real time)`,
    );
    signalBatch("SIGKILL");
  });
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(command, {
      ...options,
      // The wrapper owns all test/Chrome descendants, including a nested World
      // runner. A deadline or cancellation must not orphan them on local hosts.
      detached: process.platform !== "win32",
      env: {
        ...(options?.env || process.env),
        [FILE_DEADLINES_ENV]: directory,
      },
    });
  } catch (error) {
    close();
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  function signalBatch(signal: NodeJS.Signals) {
    if (process.platform === "win32") return child.kill(signal);
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  return {
    kill: signalBatch,
    exited: child.exited
      .then((code) => (timedOut ? 124 : code))
      .finally(() => {
        close();
        rmSync(directory, { recursive: true, force: true });
      }),
  };
}
