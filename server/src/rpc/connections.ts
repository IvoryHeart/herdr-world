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
          core_connections: connectionProfiles.coreList(),
          hosts: connectionProfiles.hosts.list(),
        },
      },
      "connections-list",
    );
    return;
  }
  if (method.startsWith("connections.")) {
    try {
      let result: unknown;
      if (method === "connections.add_host") {
        result = await connectionProfiles.hosts.add(params?.host ?? params);
      } else if (
        method === "connections.discover_host" ||
        method === "connections.connect_host"
      ) {
        result = await connectionProfiles.hosts.connect(params?.host_id);
      } else if (method === "connections.disconnect_host") {
        result = await connectionProfiles.hosts.disconnect(params?.host_id);
      } else if (method === "connections.remove_host") {
        result = await connectionProfiles.hosts.remove(params?.host_id);
      } else if (method === "connections.host_integrations") {
        result = connectionProfiles.hosts.integrations();
      } else if (method === "connections.create") {
        result = await connectionProfiles.create(params?.profile ?? params);
      } else if (method === "connections.update") {
        result = await connectionProfiles.update(
          params?.id,
          params?.profile ?? params,
        );
      } else if (method === "connections.remove") {
        result = await connectionProfiles.remove(params?.id);
        // The IDE servers World started for it keep running, listed.
        rpc.services.ide?.connectionRemoved(params?.id);
      } else if (method === "connections.set_default") {
        result = await connectionProfiles.setDefault(params?.id);
      } else if (method === "connections.connect") {
        result = await connectionProfiles.connect(params?.id);
      } else if (method === "connections.disconnect") {
        result = await connectionProfiles.disconnect(params?.id);
      } else if (method === "connections.test") {
        result = await connectionProfiles.test(params?.profile ?? params);
      } else if (method === "connections.core_install") {
        // Confirmed in World's UI: probe, install (then connect) or status.
        const install = rpc.services.coreInstall;
        if (!install)
          throw new Error("herdr-core installation is not available");
        const action = params?.action;
        result =
          action === "probe"
            ? await install.probe(
                params?.host,
                params?.fake === "ok" || params?.fake === "error",
                params?.connection,
              )
            : action === "install"
              ? install.install(
                  params?.host,
                  params?.version,
                  params?.fake,
                  params?.connection,
                )
              : install.status(params?.host);
      } else if (method === "connections.core_fixture") {
        // Testing switch: an in-process herdr-core double, never a real core.
        const fixture = rpc.services.core?.fixture;
        if (!fixture) throw new Error("the core fixture is not available");
        const action = params?.action;
        result =
          action === "start"
            ? await fixture.start(params?.scenario)
            : action === "replace"
              ? fixture.replaceReviewer()
              : action === "lose-reply"
                ? fixture.loseReply()
                : action === "logout"
                  ? fixture.logout()
                  : action === "kill"
                    ? fixture.kill()
                    : action === "remove"
                      ? await fixture.remove()
                      : action === "pane"
                        ? fixture.pane()
                        : action === "turn"
                          ? fixture.turn()
                          : action === "unread" || action === "pin"
                            ? fixture.otherApp(action)
                            : fixture.status();
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
