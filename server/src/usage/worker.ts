import { Worker } from "node:worker_threads";

export type CreateUsageWorker = (program: string) => Worker;
const createWorker: CreateUsageWorker = (program) =>
  new Worker(new URL(`data:text/javascript,${encodeURIComponent(program)}`));

/** The worker owns filesystem promises and decompression. Termination and its
 * exit receipt precede settlement, even when an underlying read never resolves. */
export async function runUsageWorker(
  program: string,
  signal: AbortSignal,
  create = createWorker,
): Promise<unknown> {
  signal.throwIfAborted();
  const worker = create(program);
  let rejectResult!: (error: Error) => void;
  const result = new Promise<unknown>((resolve, reject) => {
    rejectResult = reject;
    worker.once("message", resolve);
    worker.once("error", () => reject(new Error("Usage worker failed")));
    worker.once("exit", () => reject(new Error("Usage worker exited")));
  });
  const abort = () => rejectResult(new Error("Usage worker cancelled"));
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) abort();
    return await result;
  } finally {
    await worker.terminate();
    signal.removeEventListener("abort", abort);
    worker.removeAllListeners();
  }
}
