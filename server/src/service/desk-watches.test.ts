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
        { id: "declare", result: { ok: true } },
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
