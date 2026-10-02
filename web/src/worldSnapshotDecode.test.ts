import { afterEach, expect, test } from "bun:test";
import { decodeWorldSnapshot } from "./worldSnapshotDecode";

const originalWorker = globalThis.Worker;
const controllers: AbortController[] = [];
afterEach(() => {
  controllers.forEach((controller) => controller.abort());
  controllers.length = 0;
  globalThis.Worker = originalWorker;
});

class DecoderWorker {
  static instances: DecoderWorker[] = [];
  onmessage: ((message: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  terminated = false;
  constructor() {
    DecoderWorker.instances.push(this);
  }
  postMessage() {}
  terminate() {
    this.terminated = true;
  }
  receive(data: unknown) {
    this.onmessage?.({ data });
  }
}
function request() {
  globalThis.Worker = DecoderWorker as unknown as typeof Worker;
  const controller = new AbortController();
  controllers.push(controller);
  const pending = decodeWorldSnapshot(
    [" ".repeat(1024 * 1024)],
    controller.signal,
  );
  void pending.catch(() => {});
  return {
    controller,
    pending,
    worker: DecoderWorker.instances[DecoderWorker.instances.length - 1]!,
  };
}

test("bounded decode capacity is released on retirement and old completion cannot publish", async () => {
  const a = request(),
    b = request(),
    overflow = request();
  await expect(overflow.pending).rejects.toThrow("capacity");
  a.controller.abort();
  await expect(a.pending).rejects.toThrow("retired");
  expect(a.worker.terminated).toBe(true);
  const next = request();
  a.worker.receive({ header: { revision: 1 }, total: 0 });
  a.worker.receive({ complete: true });
  next.worker.receive({ header: { revision: 2 }, total: 1 });
  next.worker.receive({ index: 0, connection: { connection_id: "beta" } });
  next.worker.receive({ complete: true });
  expect(await next.pending).toEqual({
    revision: 2,
    connections: [{ connection_id: "beta" }],
  });
  expect(next.worker.terminated).toBe(true);
  b.controller.abort();
});

test("malformed ordering and worker errors reject only their own isolated job", async () => {
  const a = request(),
    b = request();
  a.worker.receive({ header: { revision: 1 }, total: 2 });
  a.worker.receive({ index: 1, connection: {} });
  await expect(a.pending).rejects.toThrow("invalid");
  b.worker.receive({ header: { revision: 2 }, total: 0 });
  b.worker.receive({ complete: true });
  expect(await b.pending).toEqual({ revision: 2, connections: [] });
  const failed = request();
  failed.worker.onerror?.();
  await expect(failed.pending).rejects.toThrow("decoder failed");
});

test.each([null, { header: 42, total: 0 }, { header: [], total: 0 }])(
  "malformed worker messages release their own capacity: %j",
  async (message) => {
    const job = request();
    job.worker.receive(message);
    await expect(job.pending).rejects.toThrow("invalid");
    expect(job.worker.terminated).toBe(true);
  },
);
