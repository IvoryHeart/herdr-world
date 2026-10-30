import {
  validCompletionSeenIdentity,
  type WorldCompletionSeenRegistry,
} from "../world/completion-seen";

/** The part of BridgeRpcContext these methods use. */
type CompletionSeenRpc = {
  id: string;
  method: string;
  params: unknown;
  sendReply: (message: Record<string, unknown>, context: string) => boolean;
  sendError: (context: string, error: unknown) => void;
  services: {
    worldCompletionSeen: WorldCompletionSeenRegistry;
    publishCompletionSeenChanged: (revision: number) => void;
    connectionManager: {
      readyRuntimeLease(
        connectionId: string,
      ): { generation: number; isCurrent(): boolean } | null | undefined;
    };
  };
};

/**
 * Town's checked completions, shared by every browser; presentation state
 * only. Browsers only mark: the service ends a check when its host reads show
 * the agent busy again (see WorldCompletionSeenRegistry).
 */
export async function handleCompletionSeenRpc(
  rpc: CompletionSeenRpc,
): Promise<void> {
  const { id, method, params, sendReply, sendError } = rpc;
  const {
    worldCompletionSeen,
    publishCompletionSeenChanged,
    connectionManager,
  } = rpc.services;
  try {
    if (method === "world.completion_seen.mark") {
      if (!validCompletionSeenIdentity(params))
        throw new Error("invalid completion seen identity");
      // Marks belong to the runtime generation that ran the work.
      const lease = connectionManager.readyRuntimeLease(params.connection_id);
      if (
        !lease ||
        lease.generation !== params.connection_generation ||
        !lease.isCurrent()
      )
        throw new Error("completion seen target is unavailable");
      const result = worldCompletionSeen.mark(params);
      if (result.changed) publishCompletionSeenChanged(result.revision);
    } else if (method !== "world.completion_seen.list")
      throw new Error(`unknown completion seen method: ${method}`);
    sendReply(
      { id, result: worldCompletionSeen.list() },
      "world-completion-seen",
    );
  } catch (error) {
    sendError("world-completion-seen-error", error);
  }
}
