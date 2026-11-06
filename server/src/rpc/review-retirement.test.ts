import { expect, test } from "bun:test";
import { registeredVerb } from "../verbs/registry";
import { handleWorldRpc } from "./world";
import type { BridgeRpcContext } from "./context";

test("retired completion verbs are neither registered nor dispatched", async () => {
  for (const method of [
    "world.completion_seen.list",
    "world.completion_seen.mark",
  ]) {
    expect(registeredVerb("rpc", method)).toBeUndefined();
    const failures: string[] = [];
    await handleWorldRpc({
      method,
      services: {},
      sendError: (_context: string, error: unknown) =>
        failures.push(String(error)),
    } as unknown as BridgeRpcContext);
    expect(failures).toEqual([
      `Error: unknown bridge-global method: ${method}`,
    ]);
  }
});
