import type { ServerWebSocket } from "bun";
import {
  type FloatShellOwner,
  FloatShellRefusal,
  type FloatShellService,
  MAX_FLOAT_INPUT_BYTES,
} from "../herdr-core/float-shell";
import type { BridgeRpcContext } from "./context";

type Socket = ServerWebSocket<unknown>;

/**
 * The owner standing for a browser socket: its float views close with it
 * (`FloatShellService.releaseFor`). Pushes are control messages through the
 * service's ordinary socket send, so a dead socket is cleaned up as for any
 * other message.
 */
export function floatShellOwner(
  service: FloatShellService,
  ws: Socket,
  send: (ws: Socket, payload: string, context: string) => boolean,
): FloatShellOwner {
  return service.ownerFor(ws, () => ({
    send: (push) => send(ws, JSON.stringify({ control: push }), "world-float"),
    buffered: () => ws.getBufferedAmount(),
  }));
}

function decodeInput(data: unknown): Uint8Array {
  if (typeof data !== "string") throw new FloatShellRefusal("No input");
  const bytes = new Uint8Array(Buffer.from(data, "base64"));
  if (bytes.byteLength > MAX_FLOAT_INPUT_BYTES)
    throw new FloatShellRefusal("Too much input at once");
  return bytes;
}

/** world.float.*: World's float shell on herdr-core connections. */
export async function handleFloatRpc(rpc: BridgeRpcContext): Promise<void> {
  const { id, method, params, sendReply, sendError, ws } = rpc;
  const p = (params ?? {}) as Record<string, unknown>;
  try {
    const service = rpc.services.core?.floats;
    if (!service) throw new FloatShellRefusal("Float shells are not available");
    const owner = floatShellOwner(service, ws, rpc.services.safeSend);
    const stream = String(p.stream ?? "");
    if (method === "world.float.open") {
      const opened = await service.open(owner, {
        connectionId: String(p.connection_id),
        generation: Number(p.connection_generation),
        terminal: String(p.terminal_id),
        ...(typeof p.room === "string" ? { room: p.room } : {}),
        size: { cols: Number(p.cols), rows: Number(p.rows) },
      });
      // A browser that left while it opened never gets a view.
      if (!rpc.services.clients.has(ws)) {
        service.hide(owner, opened.stream);
        return;
      }
      sendReply({ id, result: opened }, method);
      service.start(owner, opened.stream);
      return;
    }
    if (method === "world.float.input")
      service.input(owner, stream, decodeInput(p.data));
    else if (method === "world.float.resize")
      service.resize(owner, stream, {
        cols: Number(p.cols),
        rows: Number(p.rows),
      });
    else if (method === "world.float.hide") service.hide(owner, stream);
    else if (method === "world.float.stop") await service.stop(owner, stream);
    else throw new Error(`unknown float shell operation: ${method}`);
    sendReply({ id, result: { ok: true } }, method);
  } catch (error) {
    sendError(`${method}-error`, error);
  }
}
