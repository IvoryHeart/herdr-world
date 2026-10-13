export class VerificationProcessError extends Error {
  constructor(
    readonly reason: "timeout" | "aborted" | "output-limit",
    message: string,
  ) {
    super(message);
  }
}

export type ProcessOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs: number;
  signal?: AbortSignal;
  maxOutputBytes?: number;
  graceMs?: number;
  onStart?(pid: number): void;
  onOutput?(text: string): void;
};

/** Own a Unix process group, including checker grandchildren and inherited pipes. */
export async function runVerificationProcess(
  command: string[],
  options: ProcessOptions,
) {
  if (process.platform === "win32")
    throw new Error(
      "Checker process supervision requires a POSIX runner; use the required CI check on Windows",
    );
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error("Invalid checker deadline");
  if (options.signal?.aborted)
    throw new VerificationProcessError(
      "aborted",
      "Verification command aborted before spawn",
    );
  const started = performance.now();
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let failure: unknown;
  let stopped: Promise<void> | undefined;
  let bytes = 0;
  const limit = options.maxOutputBytes ?? 8 * 1024 * 1024;
  const signalGroup = (signal: NodeJS.Signals | 0) => {
    try {
      process.kill(-child.pid, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
      throw error;
    }
  };
  const stop = () => {
    if (stopped) return stopped;
    if (!signalGroup("SIGTERM")) return Promise.resolve();
    stopped = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        try {
          signalGroup("SIGKILL");
          resolve();
        } catch (error) {
          reject(error);
        }
      }, options.graceMs ?? 250);
    });
    return stopped;
  };
  const fail = (error: unknown) => {
    failure ??= error;
    void stop().catch((cleanupError) => {
      failure = cleanupError;
    });
  };
  const abort = () =>
    fail(
      new VerificationProcessError("aborted", "Verification command aborted"),
    );
  const timer = setTimeout(
    () =>
      fail(
        new VerificationProcessError(
          "timeout",
          "Verification command timed out",
        ),
      ),
    options.timeoutMs,
  );
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  const read = async (stream: ReadableStream<Uint8Array>) => {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > limit) {
          fail(
            new VerificationProcessError(
              "output-limit",
              "Verification output limit exceeded",
            ),
          );
          continue;
        }
        chunks.push(value);
        try {
          options.onOutput?.(decoder.decode(value, { stream: true }));
        } catch (error) {
          fail(error);
        }
      }
    } catch (error) {
      fail(error);
    } finally {
      reader.releaseLock();
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  };
  try {
    try {
      options.onStart?.(child.pid);
    } catch (error) {
      fail(error);
    }
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      read(child.stdout),
      read(child.stderr),
    ]);
    // A normally exited parent can leave a quiet daemon behind. Clean the owned
    // group as well, never a shared server or process discovered by name.
    await stop();
    if (failure !== undefined) throw failure;
    return {
      code,
      stdout,
      stderr,
      elapsedMs: Math.round(performance.now() - started),
    };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
    await stop();
  }
}
