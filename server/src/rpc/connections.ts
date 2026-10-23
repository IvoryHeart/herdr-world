import { sanitizeConnectionError } from "../connections/manager";
import type { BridgeRpcContext } from "./context";

/** Connection profile methods (connections.*). */
export function handleConnectionsRpc(
  rpc: BridgeRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (!method.startsWith("connections.")) return false;
  return dispatchConnectionsRpc(rpc);
}

async function dispatchConnectionsRpc(
  rpc: BridgeRpcContext,
): Promise<false | void> {
  const { id, method, params, sendReply, ws } = rpc;
  const { connectionManager, connectionProfiles, markRpcError } = rpc.services;
  if (method === "connections.list") {
    sendReply(
      {
        id,
        result: {
          default_connection_id: connectionManager.defaultId(),
          connections: connectionProfiles.list(),
        },
      },
      "connections-list",
    );
    return;
  }
  if (method.startsWith("connections.")) {
    try {
      let result: unknown;
      if (method === "connections.create") {
        result = await connectionProfiles.create(params?.profile ?? params);
      } else if (method === "connections.update") {
        result = await connectionProfiles.update(
          params?.id,
          params?.profile ?? params,
        );
      } else if (method === "connections.remove") {
        result = await connectionProfiles.remove(params?.id);
      } else if (method === "connections.set_default") {
        result = await connectionProfiles.setDefault(params?.id);
      } else if (method === "connections.connect") {
        result = await connectionProfiles.connect(params?.id);
      } else if (method === "connections.disconnect") {
        result = await connectionProfiles.disconnect(params?.id);
      } else if (method === "connections.test") {
        result = await connectionProfiles.test(params?.profile ?? params);
      } else {
        throw new Error(`unknown bridge-global method: ${method}`);
      }
      sendReply({ id, result }, "connections-mutation");
    } catch (error) {
      const message = sanitizeConnectionError(error);
      markRpcError(ws, id, message);
      sendReply({ id, error: { message } }, "connections-mutation-error");
    }
    return;
  }
  return false;
}
