import type { BridgeRpcContext } from "./context";

/**
 * `world.core.watch {connection_id, generation, address, stream}` opens an
 * observe stream of one herdr-core terminal for this page; its frames arrive
 * as `core_terminal` pushes keyed by the page's own `stream`.
 * `world.core.unwatch {stream}` ends it. The observe stream itself never
 * types, resizes or takes focus.
 *
 * `world.core.hold {stream, cols, rows}` keeps World's seat (a resumed
 * interactive viewer) at the page's fitted grid while the view is open: core
 * sizes the terminal to it only while no Herdr app pane has the terminal. A
 * new size swaps the seat; it never sends RESIZE. The seat leaves with the
 * watch. `world.core.input {stream, data, cols, rows, automatic?}` types on
 * the seat (core's typing rule then makes it the size leader); keys are sent
 * once, in order. Automatic replies go only on a seat a person typed into.
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
    if (method === "world.core.hold") {
      sendReply({ id, result: { held: watches.hold(ws, params) } }, method);
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
