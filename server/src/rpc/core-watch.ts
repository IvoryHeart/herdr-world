import type { BridgeRpcContext } from "./context";

/**
 * `world.core.watch {connection_id, generation, address, stream}` opens an
 * observe stream of one herdr-core terminal for this page; its frames arrive
 * as `core_terminal` pushes keyed by the page's own `stream`.
 * `world.core.unwatch {stream}` ends it. Watching alone never types,
 * resizes or takes focus.
 *
 * `world.core.input {stream, data, cols, rows, automatic?}` types into the
 * watched terminal: the first typed bytes open World's keyboard there (core
 * then takes World's size) and are sent once, in order. Automatic replies
 * never open it. `world.core.leave {stream}` leaves the keyboard, so the
 * size goes back to the Herdr app's pane; the watch goes on.
 */
export async function handleCoreWatchRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendError, sendReply, ws } = rpc;
  const watches = rpc.services.core?.watches;
  try {
    if (!watches) throw new Error("Watching core terminals is unavailable");
    if (method === "world.core.input") {
      sendReply({ id, result: await watches.input(ws, params) }, method);
      return;
    }
    if (method === "world.core.leave") {
      sendReply(
        { id, result: { left: watches.leave(ws, params?.stream) } },
        method,
      );
      return;
    }
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
