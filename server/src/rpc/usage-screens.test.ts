import { usageRpc } from "../features/usage/rpc";
import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { USAGE_ANALYTICS_GROUPS } from "../../../shared/usageAnalytics";
import { createRpcDispatcher } from "../service/rpc-dispatch";
import { createLegacyRoutingLogger } from "../connections/protocol";
import type { RpcServices } from "./context";
import { usageAnalyticsFixture } from "../usage/fixture";
import {
  UsageAnalyticsStore,
  type UsageReadState,
} from "../../../web/src/world/usage/usageStore";

/**
 * The screens' own request, as `UsageAnalyticsStore` sends it, through the
 * service's real RPC dispatcher: verb admission with the registered input
 * schema, then the real analytics query parser and service (over synthetic
 * sources). A grouping the screens read but the API schema refuses fails here
 * instead of leaving Usage empty in a real World.
 */
function serviceClient() {
  const ws = {} as ServerWebSocket<unknown>;
  const replies = new Map<string, { result?: unknown; error?: unknown }>();
  const services = {
    clients: new Set([ws]),
    snapshotAdmission: { acknowledge: () => false },
    featureRpc: new Map(
      Object.entries(usageRpc({ analytics: { get: usageAnalyticsFixture } })),
    ),
    safeSend: (_ws: unknown, payload: string) => {
      const reply = JSON.parse(payload);
      replies.set(reply.id, reply);
      return true;
    },
    markRpcError() {},
    connectionManager: {
      readyRuntimeLease() {
        throw new Error("usage never routes through a runtime");
      },
    },
  } as unknown as RpcServices;
  const dispatch = createRpcDispatcher(
    services,
    createLegacyRoutingLogger({ log() {} }),
  );
  let next = 0;
  return {
    async call(method: string, params?: Record<string, unknown>) {
      const id = `screen-${next++}`;
      await dispatch(ws, JSON.stringify({ id, method, params }));
      const reply = replies.get(id);
      if (!reply || reply.error)
        throw new Error(JSON.stringify(reply?.error ?? "no reply"));
      return reply.result;
    },
  };
}

async function settle(store: UsageAnalyticsStore) {
  const done = new Promise<UsageReadState>((resolve) => {
    const stop = store.subscribe(() => {
      const state = store.get();
      if (state.status === "ready" || state.status === "failed") {
        stop();
        resolve(state);
      }
    });
  });
  store.request();
  return done;
}

test("every grouping and window the screens read is admitted and answered by the real API", async () => {
  const client = serviceClient();
  for (const window of ["today", "7d"] as const)
    for (const group of USAGE_ANALYTICS_GROUPS) {
      const state = await settle(
        new UsageAnalyticsStore(client, group, window),
      );
      expect({ group, window, status: state.status }).toEqual({
        group,
        window,
        status: "ready",
      });
      if (state.status !== "ready") continue;
      expect(state.data.group_by).toBe(group);
      expect(state.data.window.kind).toBe(window);
    }
});

test("the observatory, Usage lens and agent card read runs, which the API admits", async () => {
  const state = await settle(
    new UsageAnalyticsStore(serviceClient(), "run", "7d"),
  );
  expect(state.status).toBe("ready");
  if (state.status === "ready")
    expect(state.data.rows.some((row) => row.run)).toBe(true);
});
