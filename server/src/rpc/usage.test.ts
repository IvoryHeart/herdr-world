import { usageRpc } from "../features/usage/rpc";
import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { RpcServices } from "./context";
import { usageAnalyticsFixture } from "../usage/fixture";

test("analytics RPC uses admitted World reads, validates filters and hides raw source failures", async () => {
  const ws = {} as ServerWebSocket<unknown>,
    replies: any[] = [];
  let failed = false;
  const reads = {
    analytics: {
      get: async (params: Record<string, unknown>) => {
        if (failed) throw new Error("PRIVATE_SOURCE_ERROR");
        return usageAnalyticsFixture(params);
      },
    },
  };
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    featureRpc: new Map(Object.entries(usageRpc(reads))),
    safeSend: (_ws: unknown, payload: string) => {
      replies.push(JSON.parse(payload));
      return true;
    },
    markRpcError() {},
    connectionManager: {
      readyRuntimeLease() {
        throw new Error("no fallback");
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
      id: "analytics",
      method: "world.usage.analytics",
      params: { group_by: "day" },
    }),
  );
  expect(replies.at(-1)).toMatchObject({
    id: "analytics",
    result: { version: 1, total: { total_tokens: { value: 1700 } } },
  });
  for (const params of [
    { group_by: "bad" },
    { window: "month" },
    { fixture: true },
    { pane_id: "p1" },
  ]) {
    await dispatch(
      ws,
      JSON.stringify({ id: "bad", method: "world.usage.analytics", params }),
    );
    expect(replies.at(-1)?.error).toBeDefined();
  }
  failed = true;
  await dispatch(
    ws,
    JSON.stringify({
      id: "failed",
      method: "world.usage.analytics",
      params: {},
    }),
  );
  expect(replies.at(-1)?.error.message).toContain("unavailable");
  expect(JSON.stringify(replies)).not.toContain("PRIVATE_SOURCE_ERROR");
  services.clients.delete(ws);
  await dispatch(
    ws,
    JSON.stringify({
      id: "revoked",
      method: "world.usage.analytics",
      params: {},
    }),
  );
  expect(replies.at(-1)?.error.message).toContain("revoked");
});

test("usage is a registered World read with bounded windows and no default-runtime routing", async () => {
  const ws = {} as ServerWebSocket<unknown>,
    replies: any[] = [],
    windows: unknown[] = [];
  const reads = {
    get: async (params: unknown) => {
      windows.push(params);
      return { version: 1, entities: [] };
    },
  };
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    featureRpc: new Map(Object.entries(usageRpc(reads))),
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
