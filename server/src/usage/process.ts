export type UsageProcess = {
  stdin: { end(): unknown };
  stdout: ReadableStream<Uint8Array>;
  stderr: ReadableStream<Uint8Array>;
  exited: Promise<number>;
  kill(signal?: "SIGKILL"): unknown;
};
export type SpawnUsageProcess = (argv: string[]) => UsageProcess;
const spawn: SpawnUsageProcess = (argv) =>
  Bun.spawn(argv, {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

/** Keep stdin open as the remote operation's lifetime channel. Kill and reap on
 * every unsuccessful exit, including cancellation and either output bound. */
export async function runUsageProcess(
  argv: string[],
  signal: AbortSignal,
  create = spawn,
) {
  signal.throwIfAborted();
  const child = create(argv);
  const readers = [child.stdout.getReader(), child.stderr.getReader()];
  let stopped = false,
    completed = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try {
      void Promise.resolve(child.stdin.end()).catch(() => {});
    } catch {
      /* The channel may already be closed. */
    }
    try {
      child.kill("SIGKILL");
    } catch {
      /* Still reap a concurrently exited child. */
    }
    for (const reader of readers) void reader.cancel().catch(() => {});
  };
  let rejectAbort!: (error: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    stop();
    rejectAbort(new Error("Usage process cancelled"));
  };
  signal.addEventListener("abort", abort, { once: true });
  const read = async (index: number, limit: number) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      signal.throwIfAborted();
      const next = await readers[index]!.read();
      if (next.done) return Buffer.concat(chunks, size).toString("utf8");
      size += next.value.byteLength;
      if (size > limit) {
        stop();
        throw new Error("Usage process output limit");
      }
      chunks.push(next.value);
    }
  };
  try {
    if (signal.aborted) abort();
    const work = Promise.all([
      child.exited.then((code) => {
        if (code !== 0) throw new Error("Usage process failed");
      }),
      read(0, 768 * 1024),
      read(1, 16 * 1024),
    ]);
    const [, stdout] = await Promise.race([work, aborted]);
    completed = true;
    return stdout;
  } finally {
    if (!completed) stop();
    // Reaping is part of this promise, never an unowned background cleanup.
    try {
      await child.exited;
    } finally {
      signal.removeEventListener("abort", abort);
      for (const reader of readers) {
        try {
          reader.releaseLock();
        } catch {}
      }
      try {
        void Promise.resolve(child.stdin.end()).catch(() => {});
      } catch {}
    }
  }
}
