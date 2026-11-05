import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { RpcServices } from "./context";

test("usage is a registered World read with bounded windows and no default-runtime routing", async () => {
  const ws = {} as ServerWebSocket<unknown>,
    replies: any[] = [],
    windows: unknown[] = [];
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    worldUsage: {
      get: async (params: unknown) => {
        windows.push(params);
        return { version: 1, entities: [] };
      },
    },
    safeSend: (_ws: unknown, payload: string) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError() {},
    connectionManager: {
      readyRuntimeLease() {
        throw new Error("must not route through default");
      },
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  await dispatch(
    ws,
    JSON.stringify({
      id: "today",
      method: "world.usage.get",
      params: { window: "today" },
    }),
  );
  expect(windows).toEqual([{ window: "today" }]);
  expect(replies[0]).toMatchObject({
    id: "today",
    result: { version: 1, entities: [] },
  });
  await dispatch(
    ws,
    JSON.stringify({
      id: "bad",
      method: "world.usage.get",
      params: { window: "lifetime" },
    }),
  );
  expect(replies.at(-1)?.error.message).toContain("invalid parameters");
  expect(windows).toHaveLength(1);
  services.clients.delete(ws);
  await dispatch(
    ws,
    JSON.stringify({ id: "revoked", method: "world.usage.get", params: {} }),
  );
  expect(replies.at(-1)?.error.message).toContain("revoked");
  expect(windows).toHaveLength(1);
});
