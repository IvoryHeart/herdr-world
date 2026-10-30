import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openWorldLedger,
  type WorldLedgerStorage,
} from "../storage/world-storage";
import { createAttentionDispatcher } from "./attention-dispatch";
import { createWorldCliService } from "./world-cli-service";
import { createWorldCli } from "./world-cli";
import { BoardStore } from "./board-store";

const roots: string[] = [];
const storages: WorldLedgerStorage[] = [];
const dispatchers: { stop(): Promise<void> }[] = [];
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "world-attention-"));
  roots.push(root);
  let now = 1000;
  const clock = { now: () => now, monotonic: () => performance.now() };
  const storage = await openWorldLedger(
    { database: join(root, "world.sqlite"), ledger: join(root, "ledger.json") },
    {
      clock,
      scheduler: {
        schedule(callback, delay) {
          const timer = setTimeout(callback, delay);
          return { cancel: () => clearTimeout(timer) };
        },
      },
    },
  );
  storages.push(storage);
  const scheduled: { delay: number; cancelled: boolean; callback(): void }[] =
    [];
  const scheduler = {
    schedule(callback: () => void, delay: number) {
      const entry = { delay, cancelled: false, callback };
      scheduled.push(entry);
      return {
        cancel() {
          entry.cancelled = true;
        },
      };
    },
  };
  const record = () => storage.ledger.ask("q-attention")!;
  const entry = async () => (await storage.outbox.forRecord("q-attention"))[0]!;
  const add = () =>
    storage.ledger.update(
      (doc) =>
        doc.asks.push({
          id: "q-attention",
          at: 1000,
          actor: { label: "Fixture", verified: false },
          question: "Send?",
          options: [],
          owner_only: true,
        }),
      [
        {
          kind: "ask.created",
          recovery: "repeatable",
          record_id: "q-attention",
          target: { connection_id: "studio" },
        },
      ],
    );
  return {
    root,
    storage,
    clock,
    scheduler,
    scheduled,
    advance: (ms: number) => {
      now += ms;
    },
    record,
    entry,
    add,
  };
}
const base = (f: Awaited<ReturnType<typeof fixture>>) => ({
  outbox: () => f.storage.outbox,
  ledger: () => f.storage.ledger,
  clock: f.clock,
  scheduler: f.scheduler,
  incarnation: "synthetic-service",
  hasConnection: () => true,
  changed() {},
  log() {},
});
afterEach(async () => {
  for (const dispatcher of dispatchers.splice(0)) await dispatcher.stop();
  for (const storage of storages.splice(0)) await storage.close();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test("claim commits before Herdr; current generation on the original connection is recorded", async () => {
  const f = await fixture();
  await f.add();
  let calls = 0;
  const dispatcher = createAttentionDispatcher({
    ...base(f),
    lease: () => ({
      connectionId: "studio",
      generation: 4,
      isCurrent: () => true,
      async call(method, params) {
        calls++;
        expect(method).toBe("notification.show");
        expect(params.sound).toBe("request");
        expect(await f.entry()).toMatchObject({
          state: "dispatching",
          evidence: { fence: { connection_id: "studio", generation: 4 } },
        });
        return { shown: true, reason: "shown" };
      },
    }),
  });
  dispatchers.push(dispatcher);
  await dispatcher.wake();
  await dispatcher.wake();
  expect(calls).toBe(1);
  expect((await f.entry()).state).toBe("delivered");
  expect(f.scheduled).toEqual([]);
});

for (const reason of ["disabled", "no_foreground_client", "unknown-reason"])
  test(`definite ${reason} refusal sends once and becomes idle`, async () => {
    const f = await fixture();
    await f.add();
    let calls = 0;
    const dispatcher = createAttentionDispatcher({
      ...base(f),
      lease: () => ({
        connectionId: "studio",
        generation: 4,
        isCurrent: () => true,
        async call() {
          calls++;
          return { shown: false, reason };
        },
      }),
    });
    dispatchers.push(dispatcher);
    await dispatcher.wake();
    f.advance(24 * 60 * 60_000);
    await dispatcher.wake();
    expect(calls).toBe(1);
    expect((await f.entry()).state).toBe("refused");
    expect(f.record().delivery?.notification?.reason).toBe(reason);
    expect(f.scheduled).toEqual([]);
  });

test("busy retries follow persisted exponential deadlines and stop when the ask closes", async () => {
  const f = await fixture();
  await f.add();
  let calls = 0;
  const dispatcher = createAttentionDispatcher({
    ...base(f),
    lease: () => ({
      connectionId: "studio",
      generation: 4,
      isCurrent: () => true,
      async call() {
        calls++;
        return { shown: false, reason: "busy" };
      },
    }),
  });
  dispatchers.push(dispatcher);
  for (const delay of [
    30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000,
  ]) {
    await dispatcher.wake();
    expect((await f.entry()).due_at - f.clock.now()).toBe(delay);
    expect(f.scheduled.at(-1)!.delay).toBe(Math.min(60_000, delay));
    f.advance(delay - 1);
    const before = calls;
    await dispatcher.wake();
    expect(calls).toBe(before);
    f.advance(1);
  }
  await f.storage.ledger.update((doc) => {
    doc.asks[0]!.withdrawn = { at: f.clock.now() };
  });
  await dispatcher.wake();
  expect((await f.entry()).state).toBe("cancelled");
  expect(calls).toBe(8);
  expect(f.scheduled.filter((entry) => !entry.cancelled)).toEqual([]);
});

test("uncertain owner notifications retry only when due, with no implicit answer-send intent", async () => {
  const f = await fixture();
  await f.add();
  let calls = 0;
  const dispatcher = createAttentionDispatcher({
    ...base(f),
    lease: () => ({
      connectionId: "studio",
      generation: 4,
      isCurrent: () => true,
      async call() {
        calls++;
        if (calls === 1) throw new Error("reply lost");
        return { shown: true, reason: "shown" };
      },
    }),
  });
  dispatchers.push(dispatcher);
  await dispatcher.wake();
  expect((await f.entry()).state).toBe("uncertain");
  await dispatcher.wake();
  expect(calls).toBe(1);
  f.advance(30_000);
  await dispatcher.wake();
  expect(calls).toBe(2);
  await f.storage.ledger.update((doc) => {
    doc.asks[0]!.answer = { text: "Yes", at: f.clock.now(), by: "owner" };
  });
  expect(
    (await f.storage.outbox.forRecord("q-attention")).map((row) => row.kind),
  ).toEqual(["ask.created"]);
});

test("missing leases defer on the original connection; removed connections are final", async () => {
  const f = await fixture();
  await f.add();
  let ready = false;
  let exists = true;
  const ids: string[] = [];
  const dispatcher = createAttentionDispatcher({
    ...base(f),
    hasConnection: (id) => id === "studio" && exists,
    lease: (id) => {
      ids.push(id);
      return ready
        ? {
            connectionId: "studio",
            generation: 7,
            isCurrent: () => true,
            async call() {
              throw new Error("must not send after removal");
            },
          }
        : null;
    },
  });
  dispatchers.push(dispatcher);
  await dispatcher.wake();
  expect((await f.entry()).state).toBe("pending");
  exists = false;
  ready = true;
  f.advance(30_000);
  await dispatcher.wake();
  expect((await f.entry()).state).toBe("refused");
  expect(ids).toEqual(["studio", "studio"]);
});

test("service replies for this ask without waiting for an unrelated alert drain", async () => {
  const f = await fixture();
  await f.add();
  const entered = Promise.withResolvers<void>();
  const blocked = Promise.withResolvers<{ shown: boolean; reason: string }>();
  const service = createWorldCliService({
    ledger: () => f.storage.ledger,
    attention: () => f.storage.outbox,
    scheduler: f.scheduler,
    clock: f.clock,
    now: f.clock.now,
    board: () => new BoardStore(join(f.root, "board.json")),
    snapshots: () => null,
    townMoveQueues: new Map(),
    publishBoard() {},
    broadcast() {},
    connections: () => ({
      list: () => [{ id: "studio" }],
      defaultId: () => "studio",
      readyRuntimeLease: () => ({
        connectionId: "studio",
        generation: 4,
        isCurrent: () => true,
        runtime: {
          sshHost: () => null,
          herdr: {
            async call(_method: string, params: Record<string, unknown>) {
              if (String(params.body).includes("q-attention")) {
                entered.resolve();
                return blocked.promise;
              }
              return { shown: true, reason: "shown" };
            },
          },
        },
      }),
    }),
  });
  dispatchers.push(service);
  service.start();
  await entered.promise;
  let guarded = false;
  const guard = setTimeout(() => {
    guarded = true;
    blocked.resolve({ shown: false, reason: "busy" });
  }, 2000);
  try {
    const response = await service.http(
      new Request("http://world.example/api/world/cli", {
        method: "POST",
        body: JSON.stringify({
          command: "ask",
          params: { question: "Stored?" },
        }),
      }),
      { address: "127.0.0.1", port: 40000 },
      12345,
      () => true,
    );
    const reply = (await response.json()) as { result: { id: string } };
    expect(guarded).toBe(false);
    expect(reply).toMatchObject({
      ok: true,
      recorded: true,
      notified: { shown: true },
    });
    // Delivery-only evidence must refresh Reception even without another domain write.
    const query = (await service.rpc("world.asks.get", {})) as {
      revision: number;
    };
    expect(query.revision).toBeGreaterThan(f.storage.ledger.get().revision);
    await service.rpc("world.ask.answer", {
      id: reply.result.id,
      answer: "Durable",
    });
    expect(f.storage.ledger.ask(reply.result.id)?.answer?.text).toBe("Durable");
  } finally {
    clearTimeout(guard);
    blocked.resolve({ shown: true, reason: "shown" });
    await service.stop();
  }
});

test("concurrent SQLite asks cannot bypass their shared unverified allowance", async () => {
  const f = await fixture();
  const cli = createWorldCli({
    ledger: f.storage.ledger,
    board: new BoardStore(join(f.root, "board.json")),
    hosts: () => [],
    defaultConnectionId: () => null,
    snapshot: async () => {
      throw new Error("unused");
    },
    publishBoard() {},
    publishLedger() {},
  });
  const replies = await Promise.all(
    Array.from({ length: 21 }, () =>
      cli.handle({ command: "ask", params: { question: "Bounded?" } }, null),
    ),
  );
  expect(replies.filter((reply) => reply.ok)).toHaveLength(20);
  expect(replies.filter((reply) => !reply.ok)).toEqual([
    expect.objectContaining({ code: "refused" }),
  ]);
});

test("bounded deadline wakes re-arm before due time and use wall time after sleep", async () => {
  const f = await fixture();
  await f.add();
  let calls = 0;
  const dispatcher = createAttentionDispatcher({
    ...base(f),
    lease: () => ({
      connectionId: "studio",
      generation: 4,
      isCurrent: () => true,
      async call() {
        calls++;
        return { shown: false, reason: "busy" };
      },
    }),
  });
  dispatchers.push(dispatcher);
  await dispatcher.wake();
  f.advance(30_000);
  await dispatcher.wake();
  f.advance(60_000);
  await dispatcher.wake();
  expect((await f.entry()).due_at - f.clock.now()).toBe(120_000);
  expect(f.scheduled.at(-1)!.delay).toBe(60_000);
  f.advance(60_000);
  f.scheduled.at(-1)!.callback();
  await dispatcher.wake();
  expect(calls).toBe(3);
  expect(f.scheduled.at(-1)!.delay).toBe(60_000);
  f.advance(20 * 60_000);
  f.scheduled.at(-1)!.callback();
  await dispatcher.wake();
  expect(calls).toBe(4);
});
