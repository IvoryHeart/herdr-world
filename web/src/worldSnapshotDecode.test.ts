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
  posted: unknown[] = [];
  constructor(readonly sourceUrl: string) {
    DecoderWorker.instances.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
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

test("decoded hosts wait for browser admission before posting another payload", async () => {
  const job = request();
  const source = await (await fetch(job.worker.sourceUrl)).text();
  job.controller.abort();
  const messages: any[] = [];
  const first = Promise.withResolvers<void>();
  const second = Promise.withResolvers<void>();
  const scope: {
    onmessage: ((event: { data: unknown }) => Promise<void>) | null;
    postMessage(message: any): void;
  } = {
    onmessage: null,
    postMessage(message) {
      messages.push(message);
      if (message.index === 0) first.resolve();
      if (message.index === 1) second.resolve();
    },
  };
  new Function("self", source)(scope);
  const connections = [
    {
      connection_id: "alpha",
      generation: 7,
      snapshot: { panes: [{ pane_id: "shared" }] },
    },
    {
      connection_id: "beta",
      generation: 9,
      stale: true,
      snapshot: { panes: [{ pane_id: "shared" }] },
    },
  ];
  const running = scope.onmessage!({
    data: [JSON.stringify({ revision: 3, connections })],
  });
  void running.catch(() => {});
  await first.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    messages
      .filter((message) => "index" in message)
      .map((message) => message.index),
  ).toEqual([0]);
  await scope.onmessage!({ data: { admitted: 99 } });
  expect(messages.some((message) => message.complete)).toBe(false);
  await scope.onmessage!({ data: { admitted: 0 } });
  await second.promise;
  expect(messages.some((message) => message.complete)).toBe(false);
  await scope.onmessage!({ data: { admitted: 1 } });
  await running;
  expect(
    messages
      .filter((message) => "index" in message)
      .map((message) => message.connection),
  ).toEqual(connections);
  expect(messages[messages.length - 1]).toEqual({ complete: true });
});

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

test("retiring a decode cancels queued admission feedback without resuming the worker", async () => {
  const job = request();
  job.worker.receive({ header: { revision: 1 }, total: 1 });
  job.worker.receive({ index: 0, connection: { connection_id: "alpha" } });
  job.controller.abort();
  await expect(job.pending).rejects.toThrow("retired");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    job.worker.posted.filter((message) => !Array.isArray(message)),
  ).toEqual([]);
  expect(job.worker.terminated).toBe(true);
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
