import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { createRpcDispatcher } from "./rpc-dispatch";
import { withFeatures } from "../testing/features";
import type { FeatureRpcHandler } from "../features/contract";
import type { RpcServices } from "../rpc/context";
import { createLegacyRoutingLogger } from "../connections/protocol";

test("admission refuses unregistered feature handlers before routing; presence keeps its reply", async () => {
  const ws = {} as ServerWebSocket<unknown>;
  const clients = new Set([ws]);
  const replies: any[] = [];
  const services = withFeatures({
    clients,
    snapshotAdmission: { acknowledge: () => false },
    connectionManager: {},
    markRpcError() {},
    safeSend: (_ws: unknown, line: string) => {
      replies.push(JSON.parse(line));
      return true;
    },
  } as unknown as RpcServices);
  const handlers = new Map<string, FeatureRpcHandler>(services.featureRpc);
  let called = 0;
  handlers.set("world.unregistered", () => {
    called++;
  });
  services.featureRpc = handlers;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  const call = (method: string) =>
    dispatch(ws, JSON.stringify({ id: "test", method, params: {} }));
  await call("world.unregistered");
  expect(called).toBe(0);
  expect(replies.at(-1).error.message).toContain("unregistered");
  await call("world.presence.seen");
  const first = replies.at(-1);
  expect(typeof first.result.now).toBe("number");
  await call("world.presence.seen");
  expect(replies.at(-1).result.previous).toBeGreaterThanOrEqual(
    first.result.now,
  );
  expect(replies.at(-1).command_evidence).toEqual({ stage: "accepted" });
  clients.delete(ws);
  const previous = replies.at(-1).result.now;
  await call("world.presence.seen");
  expect(replies.at(-1).error.message).toContain("revoked");
  clients.add(ws);
  await call("world.presence.seen");
  expect(replies.at(-1).result.previous).toBeGreaterThanOrEqual(previous);
});
