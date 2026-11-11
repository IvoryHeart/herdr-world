import { isLocalCoreAddress } from "../../../shared/coreAddress";
import { CoreFenceError, CoreOperationFence } from "../herdr-core/fence";
import type { CoreConnectionRuntime } from "../herdr-core/runtime";
import { favouriteToShare, seenToShare } from "../herdr-core/shared-state";
import type { ReadyRuntimeLease } from "../connections/manager";

/** The core manager calls these verbs need: only ever its own leases. */
export type CoreSharedConnections = {
  has(connectionId: string): boolean;
  readyRuntimeLease(
    connectionId: string,
  ): ReadyRuntimeLease<CoreConnectionRuntime> | null;
};

/** The slice of World's RPC context these verbs use. */
export type CoreSharedRequest = {
  id: string;
  method: string;
  params?: Record<string, unknown>;
  sendReply: (message: Record<string, unknown>, context: string) => boolean;
  sendError: (context: string, error: unknown) => void;
  services: { core?: { manager: CoreSharedConnections } };
};

type Target = { connectionId: string; generation: number; address: string };

function target(params: Record<string, unknown> | undefined): Target {
  const connectionId = params?.connection_id;
  const generation = params?.connection_generation;
  const address = params?.terminal;
  if (
    typeof connectionId !== "string" ||
    !connectionId ||
    connectionId.length > 256 ||
    typeof generation !== "number" ||
    !Number.isSafeInteger(generation) ||
    generation < 0 ||
    typeof address !== "string" ||
    // A local address only: never a name, never a linked machine's terminal.
    !isLocalCoreAddress(address)
  )
    throw new Error("invalid herdr-core terminal");
  return { connectionId, generation, address };
}

/**
 * Seen and favourite shared with Herdr's apps (`world.core.seen`,
 * `world.core.favourite`). Each writes one label on one live local agent
 * of the herdr-core connection and generation the browser observed, under
 * the runtime fence, and only as the label contract allows: seen only
 * rises, and only from the value (`seen`, null when missing) the browser's
 * look was decided on; favourite only changes. Best effort: a refusal or failure changes
 * nothing, and nothing is retried here.
 */
export async function handleCoreSharedRpc(
  rpc: CoreSharedRequest,
): Promise<void> {
  const { id, method, params, sendError, sendReply } = rpc;
  try {
    const where = target(params);
    let decide: Parameters<CoreConnectionRuntime["shareLabel"]>[1];
    if (method === "world.core.seen") {
      const turn = params?.turn;
      const seen = params?.seen;
      if (typeof turn !== "number" || !Number.isSafeInteger(turn) || turn < 0)
        throw new Error("invalid turn");
      if (
        seen !== null &&
        (typeof seen !== "number" || !Number.isSafeInteger(seen) || seen < 0)
      )
        throw new Error("invalid seen");
      decide = (record) => seenToShare(record, turn, seen);
    } else if (method === "world.core.favourite") {
      const favourite = params?.favourite;
      if (typeof favourite !== "boolean") throw new Error("invalid favourite");
      decide = (record) => favouriteToShare(record, favourite);
    } else throw new Error(`unknown method: ${method}`);
    const core = rpc.services.core?.manager;
    if (!core?.has(where.connectionId))
      throw new Error("not a herdr-core connection");
    const lease = core.readyRuntimeLease(where.connectionId);
    // The browser acts on what it saw: a newer generation is a new look.
    if (!lease || lease.generation !== where.generation)
      throw new CoreFenceError("admission", "lease");
    const fence = CoreOperationFence.admit(lease, where.address);
    const outcome = await lease.runtime.shareLabel(fence, decide);
    sendReply({ id, result: { written: outcome === "written" } }, method);
  } catch (error) {
    sendError("core-shared-error", error);
  }
}
