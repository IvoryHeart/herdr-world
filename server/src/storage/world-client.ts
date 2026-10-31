import { randomBytes } from "node:crypto";
import { Worker } from "node:worker_threads";
import {
  STORAGE_BOUNDS,
  StorageOutcomeUnknown,
  StorageWriteRejected,
  type StorageSnapshot,
  type StoragePorts,
  type StorageRequest,
  type WorkerReply,
  type WorkerRequest,
} from "./world-protocol";

/** Parent-side admission and group timer; the worker alone touches SQLite. */
export async function openWorldClient(
  path: string,
  legacy: string,
  ports: StoragePorts,
  createWorker?: (url: URL) => Worker,
  incarnation = randomBytes(16).toString("base64url"),
  legacyProfiles?: string,
  legacySettings?: string,
) {
  // Bun bundles import.meta.url relative to the executable's main entry, whose
  // sibling storage/ directory contains the separately embedded worker entry.
  const workerUrl = new URL(
    Bun.isStandaloneExecutable
      ? "./storage/world-worker.ts"
      : "./world-worker.ts",
    import.meta.url,
  );
  const worker = createWorker ? createWorker(workerUrl) : new Worker(workerUrl);
  let serial = 0;
  let accepting = true;
  let failure: Error | undefined;
  let timer: { cancel(): void } | undefined;
  let queuedBytes = 0;
  const queue: { ticket: number; request: StorageRequest; bytes: number }[] =
    [];
  const pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: Error): void; bytes: number }
  >();
  const ready = Promise.withResolvers<StorageSnapshot>();
  const exited = Promise.withResolvers<void>();
  const failed = Promise.withResolvers<Error>();
  let closed: Promise<void> | undefined;
  const idle = new Set<() => void>();
  const fail = (error: Error) => {
    if (failure) return;
    error =
      error instanceof StorageOutcomeUnknown
        ? error
        : new StorageOutcomeUnknown(error.message);
    failure = error;
    failed.resolve(error);
    accepting = false;
    timer?.cancel();
    timer = undefined;
    ready.reject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
    queue.length = 0;
    queuedBytes = 0;
    for (const resolve of idle) resolve();
    idle.clear();
  };
  const send = (message: WorkerRequest) => worker.postMessage(message);
  const flush = () => {
    timer?.cancel();
    timer = undefined;
    if (!queue.length || failure) return;
    const batch = [];
    let bytes = 0;
    while (
      queue.length &&
      batch.length < STORAGE_BOUNDS.operations &&
      bytes + queue[0]!.bytes <= STORAGE_BOUNDS.batchBytes
    ) {
      const entry = queue.shift()!;
      batch.push({ ticket: entry.ticket, request: entry.request });
      bytes += entry.bytes;
    }
    send({ type: "batch", requests: batch, at: ports.clock.now() });
    if (queue.length)
      timer = ports.scheduler.schedule(flush, STORAGE_BOUNDS.delayMs);
  };
  worker.on("message", (reply: WorkerReply) => {
    if (reply.type === "ready") ready.resolve(reply.snapshot);
    else if (reply.type === "fatal")
      fail(
        new Error(
          `World storage worker failed: ${reply.error}; unacknowledged outcomes are unknown; restart the service to recover committed state`,
        ),
      );
    else if (reply.type === "results") {
      for (const result of reply.results) {
        const request = pending.get(result.ticket);
        if (!request) continue;
        pending.delete(result.ticket);
        queuedBytes -= request.bytes;
        if (result.error)
          request.reject(new StorageWriteRejected(result.error));
        else request.resolve(result.result);
      }
      if (!pending.size) {
        for (const resolve of idle) resolve();
        idle.clear();
      }
    }
  });
  worker.on("error", (error) =>
    fail(error instanceof Error ? error : new Error(String(error))),
  );
  worker.on("exit", (code) => {
    if (!closed || pending.size || code !== 0)
      fail(
        new Error(
          `World storage worker exited (${code}); unacknowledged outcomes are unknown`,
        ),
      );
    exited.resolve();
  });
  send({
    type: "open",
    path,
    legacy,
    ...(legacyProfiles !== undefined ? { legacyProfiles } : {}),
    ...(legacySettings !== undefined ? { legacySettings } : {}),
    at: ports.clock.now(),
    incarnation,
  });
  let snapshot: StorageSnapshot;
  try {
    snapshot = await ready.promise;
  } catch (error) {
    await exited.promise;
    throw error;
  }
  return {
    snapshot,
    failed: failed.promise,
    request<T>(request: StorageRequest): Promise<T> {
      if (!accepting || failure)
        return Promise.reject(
          failure ?? new StorageWriteRejected("World storage is closing"),
        );
      const bytes = Buffer.byteLength(JSON.stringify(request));
      if (
        bytes > STORAGE_BOUNDS.requestBytes ||
        pending.size >= STORAGE_BOUNDS.queuedOperations ||
        queuedBytes + bytes > STORAGE_BOUNDS.queuedBytes
      )
        return Promise.reject(
          new StorageWriteRejected(
            "World storage admission limit reached; retry when pending operations complete",
          ),
        );
      const ticket = ++serial;
      const result = new Promise<T>((resolve, reject) =>
        pending.set(ticket, {
          resolve: (value) => resolve(value as T),
          reject,
          bytes,
        }),
      );
      queue.push({ ticket, request, bytes });
      queuedBytes += bytes;
      if (
        queue.length >= STORAGE_BOUNDS.operations ||
        queue.reduce((sum, entry) => sum + entry.bytes, 0) >=
          STORAGE_BOUNDS.batchBytes
      )
        flush();
      else timer ??= ports.scheduler.schedule(flush, STORAGE_BOUNDS.delayMs);
      return result;
    },
    close() {
      if (closed) return closed;
      accepting = false;
      // Set before sending close: an immediate worker exit is then expected.
      const completion = Promise.withResolvers<void>();
      closed = completion.promise;
      void (async () => {
        if (!failure) {
          const drained = pending.size
            ? new Promise<void>((resolve) => idle.add(resolve))
            : Promise.resolve();
          while (queue.length) flush();
          await drained;
          if (!failure) send({ type: "close" });
        }
        await exited.promise;
        completion.resolve();
      })().catch(completion.reject);
      return closed;
    },
  };
}
