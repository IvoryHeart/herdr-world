import { MemoryError, type MemoryAction } from "../../../../shared/memory";
import type { MemoryService } from "../../memory/service";
import type { FeatureKernel, FeatureRpcHandler } from "../contract";

/** Global method, with the owning connection identity in params, never default routing. */
export async function handleMemoryRpc(
  rpc: Parameters<FeatureRpcHandler>[0],
  worldMemory: MemoryService,
  clients: FeatureKernel["clients"],
) {
  try {
    if (!worldMemory)
      throw new MemoryError("unavailable", "Memory service is unavailable");
    const result = await worldMemory.call(
      rpc.method.slice("world.memory.".length) as MemoryAction,
      rpc.params ?? {},
      () => {
        if (!clients.has(rpc.ws))
          throw new MemoryError("refused", "Memory caller disconnected");
      },
    );
    rpc.sendReply({ id: rpc.id, result }, rpc.method);
  } catch (error) {
    const memory =
      error instanceof MemoryError
        ? error
        : new MemoryError("unavailable", "Memory service is unavailable");
    rpc.sendReply(
      {
        id: rpc.id,
        error: {
          code: memory.code,
          message: `${memory.code}: ${memory.message}`,
        },
      },
      "memory-error",
    );
  }
}
