import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { ConnectionManager } from "../connections/manager";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { LegacyConnectionRuntime } from "../connections/runtime";
import type { RpcServices } from "../rpc/context";
import { createRpcDispatcher } from "./rpc-dispatch";

test("forward dispatch requires a loopback browser and explicit current runtime owner", async () => {
  const manager = new ConnectionManager<LegacyConnectionRuntime>("alpha");
  const sent: any[] = [];
  const called: string[] = [];
  const local = { remoteAddress: "127.0.0.1" } as ServerWebSocket<unknown>;
  const remote = { remoteAddress: "192.0.2.1" } as ServerWebSocket<unknown>;
  for (const id of ["alpha", "beta"]) {
    const identity = { id, label: id, source: "test" };
    manager.register({
      identity,
      createRuntime: () =>
        ({
          identity,
          async startTransport() {},
          startBackground() {},
          async stop() {},
          herdr: {},
          terminalBridge: {},
          sshHost: () => "dev.example",
          handleForwardRpc: async () => {
            called.push(id);
          },
        }) as unknown as LegacyConnectionRuntime,
    });
    await manager.start(id);
  }
  const dispatch = createRpcDispatcher(
    {
      clients: new Set([local, remote]),
      connectionManager: manager,
      snapshotAdmission: { acknowledge: () => false },
      markRpcError() {},
      safeSend(_socket: unknown, payload: string) {
        sent.push(JSON.parse(payload));
        return true;
      },
    } as unknown as RpcServices,
    createLegacyRoutingLogger({ log() {} }),
  );
  const generation = manager.readyRuntimeLease("beta")!.generation;
  const call = (socket: typeof local, owner: Record<string, unknown>) =>
    dispatch(
      socket,
      JSON.stringify({
        id: "forward",
        method: "forward.list",
        params: {},
        ...owner,
      }),
    );
  try {
    await call(local, {});
    expect(sent.at(-1).error.message).toContain("explicit connection");
    await call(local, { connection_id: "beta" });
    expect(sent.at(-1).error.message).toContain("explicit connection");
    await call(remote, {
      connection_id: "beta",
      connection_generation: generation,
    });
    expect(sent.at(-1).error.message).toContain("loopback");
    await call(local, {
      connection_id: "beta",
      connection_generation: generation + 1,
    });
    expect(called).toEqual([]);
    await call(local, {
      connection_id: "beta",
      connection_generation: generation,
    });
    expect(called).toEqual(["beta"]);
  } finally {
    await manager.stopAll();
  }
});
