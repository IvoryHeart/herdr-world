import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  watch,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** A wrapper-owned real-time boundary; stopped clocks cannot stop it. */
export const FILE_TIMEOUT_MS = 120_000;
export const FILE_DEADLINES_ENV = "HERDR_TEST_FILE_DEADLINES";

/** File workers publish atomic markers; Bun parallel workers have no IPC channel. */
export function fileDeadline(file: string) {
  const directory = process.env[FILE_DEADLINES_ENV];
  if (!directory)
    throw new Error("File deadlines require scripts/run-tests.ts");
  const marker = join(directory, `${crypto.randomUUID()}.json`);
  writeFileSync(marker + ".tmp", JSON.stringify({ file }));
  renameSync(marker + ".tmp", marker);
  return () => rmSync(marker, { force: true });
}

/** Native file events wake the parent, outside all test clocks and workers. */
export function watchTestFiles(
  directory: string,
  expired: (file: string, limit: number) => void,
) {
  const limit = Number(
    process.env.HERDR_TEST_FILE_TIMEOUT_MS || FILE_TIMEOUT_MS,
  );
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FILE_TIMEOUT_MS)
    throw new Error(`HERDR_TEST_FILE_TIMEOUT_MS must be 1..${FILE_TIMEOUT_MS}`);
  mkdirSync(directory, { recursive: true });
  let closed = false;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const observer = watch(directory, (_event, filename) => {
    if (closed || !filename?.endsWith(".json")) return;
    const marker = join(directory, filename);
    try {
      const { file } = JSON.parse(readFileSync(marker, "utf8"));
      if (!timers.has(marker))
        timers.set(
          marker,
          setTimeout(() => expired(file, limit), limit),
        );
    } catch {
      clearTimeout(timers.get(marker));
      timers.delete(marker);
    }
  });
  return () => {
    closed = true;
    observer.close();
    for (const timer of timers.values()) clearTimeout(timer);
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
    child.kill("SIGKILL");
  });
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn(command, {
      ...options,
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
  return {
    kill: (signal: NodeJS.Signals) => child.kill(signal),
    exited: child.exited
      .then((code) => (timedOut ? 124 : code))
      .finally(() => {
        close();
        rmSync(directory, { recursive: true, force: true });
      }),
  };
}
