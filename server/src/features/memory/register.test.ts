import { expect, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { MEMORY_ACTIONS, MemoryError } from "../../../../shared/memory";
import { serverFeatures } from "../catalog";
import { composeFeatures } from "../compose";
import type { FeatureKernel, FeatureRpcHandler } from "../contract";
import { memoryKey } from "./register";

test("discovered memory handlers share the typed CLI service and preserve replies and caller fences", async () => {
  expect(serverFeatures.map((feature) => String(feature.id))).toContain(
    "memory",
  );
  const ws = {} as ServerWebSocket<unknown>;
  const clients = new Set([ws]);
  const composed = composeFeatures({ clients } as unknown as FeatureKernel);
  const memory = composed.get(memoryKey);
  expect(
    composeFeatures({ clients } as unknown as FeatureKernel).get(memoryKey),
  ).not.toBe(memory);
  const replies: unknown[] = [];
  memory.call = async (action, params, recheck) => {
    recheck?.();
    if (params.fail) throw new Error("private host failure");
    if (params.conflict) throw new MemoryError("conflict", "Memory changed");
    return { action, params };
  };
  const call = (action: string, params: Record<string, unknown> = {}) => {
    const method = `world.memory.${action}`;
    return composed.rpc.get(method)!({
      ws,
      id: action,
      method,
      params,
      sendReply: (reply, context) => {
        replies.push([reply, context]);
      },
    } as Parameters<FeatureRpcHandler>[0]);
  };
  for (const action of MEMORY_ACTIONS) {
    await call(action);
    expect(replies.at(-1)).toEqual([
      { id: action, result: { action, params: {} } },
      `world.memory.${action}`,
    ]);
  }
  for (const [params, code, message] of [
    [{ conflict: true }, "conflict", "Memory changed"],
    [{ fail: true }, "unavailable", "Memory service is unavailable"],
    [{}, "refused", "Memory caller disconnected"],
  ] as const) {
    if (code === "refused") clients.delete(ws);
    await call("read", params);
    expect(replies.at(-1)).toEqual([
      { id: "read", error: { code, message: `${code}: ${message}` } },
      "memory-error",
    ]);
  }
});
