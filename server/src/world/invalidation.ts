import type { ConnectionStatus } from "../connections/types";

/** Lifecycle evidence must belong to exactly the invalidated owner/generation. */
export function serializeWorldInvalidation(
  connectionId: string,
  generation: number,
  revision: number,
  manager?: {
    has(id: string): boolean;
    status(id: string): Pick<ConnectionStatus, "id" | "generation" | "state">;
  },
) {
  const status = manager?.has(connectionId)
    ? manager.status(connectionId)
    : undefined;
  return JSON.stringify({
    control: {
      type: "world_invalidated",
      connection_id: connectionId,
      connection_generation: generation,
      revision,
      ...(status?.id === connectionId && status.generation === generation
        ? { connection_state: status.state }
        : {}),
    },
  });
}
