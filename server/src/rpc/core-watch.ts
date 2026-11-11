import type { BridgeRpcContext } from "./context";

/**
 * `world.core.watch {connection_id, generation, address, stream}` opens an
 * observe stream of one herdr-core terminal for this page; its frames arrive
 * as `core_terminal` pushes keyed by the page's own `stream`.
 * `world.core.unwatch {stream}` ends it. Neither can type, resize or focus.
 */
export async function handleCoreWatchRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendError, sendReply, ws } = rpc;
  const watches = rpc.services.core?.watches;
  try {
    if (!watches) throw new Error("Watching core terminals is unavailable");
    if (method === "world.core.unwatch") {
      sendReply(
        { id, result: { closed: watches.close(ws, params?.stream) } },
        method,
      );
      return;
    }
    sendReply({ id, result: await watches.open(ws, params) }, method);
  } catch (error) {
    sendError(`${method}-error`, error);
  }
}
