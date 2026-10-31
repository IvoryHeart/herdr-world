import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { RpcServices } from "../rpc/context";
import { DeskWatches } from "../world/desk-watches";
import { createRpcDispatcher } from "./rpc-dispatch";
import { createBrowserClients } from "./clients";
import { silentLogger } from "../utils/logger";

test("Desk declarations dispatch without runtime selection and socket cleanup releases the last watch", async () => {
  type Socket = ServerWebSocket<unknown>;
  const one = {} as Socket,
    two = {} as Socket;
  const frames = new Map<Socket, any[]>([
    [one, []],
    [two, []],
  ]);
  const jobs = new Set<() => void>();
  let reads = 0;
  const watches = new DeskWatches<Socket>({
    scheduler: {
      schedule(callback) {
        jobs.add(callback);
        return { cancel: () => jobs.delete(callback) };
      },
    },
    lease: () => ({
      isCurrent: () => true,
      async read() {
        reads++;
        return { result: { text: "synthetic screen" } };
      },
    }),
    send(socket, control) {
      frames.get(socket)!.push({ control });
      return true;
    },
  });
  const services = {
    deskWatches: watches,
    snapshotAdmission: { acknowledge: () => false },
    markRpcError() {},
    safeSend(socket: Socket, payload: string) {
      frames.get(socket)!.push(JSON.parse(payload));
      return true;
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  const clients = createBrowserClients({
    logger: silentLogger,
    clock: { now: () => 0, monotonic: () => 0 },
    forEachRuntime() {},
    closed: (socket) => watches.release(socket),
  });
  services.clients = clients.clients;
  const target = {
    connection_id: "alpha",
    connection_generation: 1,
    pane_id: "pane",
    session: null,
  };
  const tick = async () => {
    for (const job of [...jobs]) if (jobs.delete(job)) await job();
  };
  try {
    for (const socket of [one, two]) {
      clients.clients.add(socket);
      await dispatch(
        socket,
        JSON.stringify({
          id: "declare",
          method: "world.desk.observe",
          params: { screens: [target], receipts: [] },
        }),
      );
      expect(frames.get(socket)).toEqual([
        {
          id: "declare",
          result: { ok: true },
          command_evidence: { stage: "accepted" },
        },
      ]);
    }
    await tick();
    expect(reads).toBe(1);
    for (const socket of [one, two])
      expect(frames.get(socket)!.at(-1)).toMatchObject({
        control: { type: "world_desk_reads", ...target },
      });
    clients.webSocketCleanup.cleanup(one);
    await tick();
    expect(reads).toBe(2);
    clients.webSocketCleanup.cleanup(two);
    await tick();
    expect(reads).toBe(2);
    expect(jobs.size).toBe(0);
  } finally {
    watches.stop();
  }
});

test("cached send failures cannot leave holders or queued reads after socket churn", async () => {
  for (const shutdown of [false, true]) {
    type Socket = ServerWebSocket<unknown>;
    const jobs = new Set<() => void>(),
      reads: string[] = [];
    const started = Promise.withResolvers<void>();
    const pending = Promise.withResolvers<void>();
    const watches = new DeskWatches<Socket>({
      scheduler: {
        schedule(callback) {
          jobs.add(callback);
          return { cancel: () => jobs.delete(callback) };
        },
      },
      lease: () => ({
        isCurrent: () => true,
        async read(_kind, target) {
          reads.push(target.pane_id);
          if (target.pane_id === "blocked") {
            started.resolve();
            await pending.promise;
          }
          return { result: { text: "synthetic screen" } };
        },
      }),
      send: (socket, control) =>
        clients.safeSend(
          socket,
          JSON.stringify({ control }),
          "world-desk-reads",
        ),
    });
    const clients = createBrowserClients({
      logger: silentLogger,
      clock: { now: () => 0, monotonic: () => 0 },
      forEachRuntime() {},
      closed: (socket) => watches.release(socket),
    });
    const socket = (drops = false) =>
      ({
        getBufferedAmount: () => 0,
        send: () => (drops ? 0 : 1),
        close() {},
      }) as unknown as Socket;
    const target = {
      connection_id: "alpha",
      connection_generation: 1,
      pane_id: "cached",
      session: null,
    };
    const tick = async () => {
      await Promise.all(
        [...jobs].map(async (job) => {
          if (jobs.delete(job)) await job();
        }),
      );
    };
    // Inspect resource ownership as well as reads: an orphan that has not fired
    // yet must fail this regression, including queued and retained active work.
    const resources = watches as unknown as {
      watches: Map<string, unknown>;
      declarations: Map<Socket, unknown>;
      queues: { lanes: Map<string, { jobs: Map<string, unknown> }> };
    };
    const live = socket();
    clients.clients.add(live);
    watches.declare(live, {
      screens: [
        target,
        { ...target, pane_id: "blocked" },
        { ...target, pane_id: "queued" },
      ],
      receipts: [],
    });
    const reading = tick();
    try {
      await started.promise;
      expect(reads).toEqual(["cached", "blocked"]);
      expect(
        [...resources.queues.lanes.values()].flatMap((lane) => [...lane.jobs]),
      ).toHaveLength(1);
      for (let index = 0; index < 100; index++) {
        const dropped = socket(true);
        clients.clients.add(dropped);
        watches.declare(dropped, {
          screens: [target, { ...target, pane_id: `extra-${index}` }],
          receipts: [],
        });
      }
      expect(clients.clients.size).toBe(1);
      if (shutdown) watches.stop();
      clients.webSocketCleanup.cleanup(live);
      clients.webSocketCleanup.cleanup(live);
      expect(jobs.size).toBe(0);
      expect(resources.declarations.size).toBe(0);
      expect(
        [...resources.queues.lanes.values()].flatMap((lane) => [...lane.jobs]),
      ).toHaveLength(0);
      pending.resolve();
      await reading;
      await tick();
      expect(reads).toEqual(["cached", "blocked"]);
      expect(clients.clients.size).toBe(0);
      expect(resources.watches.size).toBe(0);
      expect(resources.queues.lanes.size).toBe(0);
      watches.stop();
      expect(jobs.size).toBe(0);
    } finally {
      pending.resolve();
      await reading;
      watches.stop();
    }
  }
});

test("shutdown retires watch holders independently of declaration bookkeeping", async () => {
  const jobs = new Set<() => void>();
  const watches = new DeskWatches<string>({
    scheduler: {
      schedule(callback) {
        jobs.add(callback);
        return { cancel: () => jobs.delete(callback) };
      },
    },
    lease: () => ({
      isCurrent: () => true,
      async read() {
        return { result: {} };
      },
    }),
    send: () => true,
  });
  watches.declare("socket", {
    screens: [
      {
        connection_id: "alpha",
        connection_generation: 1,
        pane_id: "pane",
        session: null,
      },
    ],
    receipts: [],
  });
  const resources = watches as unknown as {
    declarations: Map<unknown, unknown>;
    watches: Map<string, unknown>;
  };
  resources.declarations.clear();
  watches.stop();
  expect(jobs.size).toBe(0);
  expect(resources.watches.size).toBe(0);
});
