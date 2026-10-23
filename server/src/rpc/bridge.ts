import type { BridgeRpcContext } from "./context";

/** Bridge-global methods: ping, status, assistant and pausing other clients. */
export function handleBridgeRpc(
  rpc: BridgeRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "bridge.ping" ||
      method === "bridge.status" ||
      method.startsWith("bridge.assistant.") ||
      method === "bridge.pause_others"
    )
  )
    return false;
  return dispatchBridgeRpc(rpc);
}

async function dispatchBridgeRpc(rpc: BridgeRpcContext): Promise<false | void> {
  const { id, method, params, sendError, sendReply, ws } = rpc;
  const {
    clients,
    connectionManager,
    connectionProfiles,
    getAssistantService,
    safeSend,
  } = rpc.services;
  if (method === "bridge.ping") {
    sendReply({ id, result: { ok: true } }, "bridge-ping");
    return;
  }
  if (method === "bridge.status") {
    sendReply(
      {
        id,
        result: {
          clients: clients.size,
          terminals:
            connectionManager
              .defaultReadyRuntime()
              ?.terminalBridge.statusTerminals() ?? [],
          default_connection_id: connectionManager.defaultId(),
          connections: connectionProfiles.list(),
        },
      },
      "bridge-status",
    );
    return;
  }
  if (method.startsWith("bridge.assistant.")) {
    try {
      // Browser admissions must carry the selected catalogue scope. Internal
      // scheduled turns may use the service's own verified fixed scope.
      if (
        [
          "bridge.assistant.send",
          "bridge.assistant.task.create",
          "bridge.assistant.task.update",
        ].includes(method) &&
        !Array.isArray(params?.scope)
      )
        throw new Error("Invalid workspace scope");
      const result =
        method === "bridge.assistant.context"
          ? await (await getAssistantService()).workspaceCatalog()
          : method === "bridge.assistant.mentions"
            ? await (await getAssistantService()).mentionCatalog(params ?? {})
            : method === "bridge.assistant.task.get"
              ? await (await getAssistantService()).taskDetail(params ?? {})
              : await (await getAssistantService()).handle(
                  method,
                  params ?? {},
                );
      sendReply({ id, result }, "assistant-rpc");
    } catch (error) {
      sendError("assistant-rpc-error", error);
    }
    return;
  }
  if (method === "bridge.pause_others") {
    const targets = Array.from(clients).filter((client) => client !== ws);
    let pausedClients = 0;
    for (const client of targets) {
      const ok = safeSend(
        client,
        JSON.stringify({
          control: {
            type: "pause_connection",
            reason:
              "Another Herdr World client paused this connection. Resume when you want this browser to sync again.",
          },
        }),
        "pause-other-client",
      );
      if (ok) pausedClients += 1;
    }
    sendReply(
      {
        id,
        result: {
          ok: true,
          paused_clients: pausedClients,
          clients: clients.size,
        },
      },
      "bridge-pause-others",
    );
    return;
  }
  return false;
}
