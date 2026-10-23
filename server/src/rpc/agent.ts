import { dispatchAgentSessionLink } from "../connections/rpc-routing";
import type { ConnectionRpcContext } from "./context";

/** Agent sessions, conversations, quests and history on one connection. */
export async function handleAgentRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const { id, method, params, route, sendError, sendReply, ws, connection } =
    rpc;
  const { conversationWatchers } = rpc.services;
  const { herdr } = connection;
  const {
    readEntry: readAgentHistoryEntry,
    readHistory: readAgentMessageHistory,
    readSummary: readAgentSessionSummary,
    readTurn: readAgentTurn,
  } = connection.agentSessions;
  if (method === "agent.list") {
    try {
      const result =
        connection.remotePlatform === "windows"
          ? await herdr.call("agent.list", params ?? {})
          : await connection.agentSessions.listWithActivity(params ?? {});
      sendReply({ id, result }, "agent-list");
    } catch (e) {
      sendError("agent-list-error", e);
    }
    return;
  }
  if (
    method === "agent_conversation.watch" ||
    method === "agent_conversation.unwatch"
  ) {
    try {
      const paneId = typeof params?.pane_id === "string" ? params.pane_id : "";
      if (!paneId) throw new Error(`${method} requires pane_id`);
      const watcher = connection.agentSessions.conversationWatch;
      if (method === "agent_conversation.watch") {
        watcher.watch(ws, paneId);
        let watchers = conversationWatchers.get(ws);
        if (!watchers) {
          watchers = new Set();
          conversationWatchers.set(ws, watchers);
        }
        watchers.add(watcher);
      } else {
        watcher.unwatch(ws, paneId);
      }
      sendReply({ id, result: { ok: true } }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (
    method === "agent_conversation.get" ||
    method === "agent_conversation.latest" ||
    method === "agent_conversation.send" ||
    method === "agent_conversation.answer" ||
    method === "agent_conversation.dismiss"
  ) {
    try {
      const source = connection.agentSessions.conversation;
      const p = params ?? {};
      const paneId = typeof p.pane_id === "string" ? p.pane_id : "";
      if (method !== "agent_conversation.latest" && !paneId)
        throw new Error(`${method} requires pane_id`);
      const result =
        method === "agent_conversation.get"
          ? await source.read({ pane_id: paneId })
          : method === "agent_conversation.answer"
            ? await source.answer({
                pane_id: paneId,
                key: typeof p.key === "string" ? p.key : "",
                prompt_fingerprint:
                  typeof p.prompt_fingerprint === "string"
                    ? p.prompt_fingerprint
                    : "",
              })
            : method === "agent_conversation.dismiss"
              ? {
                  dismissed: source.dismiss({
                    pane_id: paneId,
                    delivery_id:
                      typeof p.delivery_id === "string" ? p.delivery_id : "",
                  }),
                }
              : method === "agent_conversation.send"
                ? await source.send({
                    pane_id: paneId,
                    text: typeof p.text === "string" ? p.text : "",
                    session_fingerprint:
                      typeof p.session_fingerprint === "string"
                        ? p.session_fingerprint
                        : "",
                    ...(Array.isArray(p.baseline)
                      ? {
                          baseline: p.baseline.filter(
                            (id): id is string => typeof id === "string",
                          ),
                        }
                      : {}),
                  })
                : paneId
                  ? await source.latest({ pane_id: paneId })
                  : {
                      conversations: await source.latestAll(
                        Array.isArray(p.pane_ids)
                          ? p.pane_ids.filter(
                              (id): id is string => typeof id === "string",
                            )
                          : undefined,
                      ),
                    };
      sendReply({ id, result }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "agent_quest.list") {
    try {
      const ids = Array.isArray(params?.pane_ids)
        ? params.pane_ids.filter((id): id is string => typeof id === "string")
        : undefined;
      const quests = await connection.agentSessions.conversation.quests(ids);
      sendReply({ id, result: { quests } }, method);
    } catch (e) {
      sendError(`${method}-error`, e);
    }
    return;
  }
  if (method === "agent_history.get") {
    try {
      const result = await readAgentMessageHistory(params ?? {});
      sendReply({ id, result }, "agent-history-get");
    } catch (e) {
      sendError("agent-history-get-error", e);
    }
    return;
  }
  if (method === "agent_history.entry") {
    try {
      const result = await readAgentHistoryEntry(params ?? {});
      sendReply({ id, result }, "agent-history-entry");
    } catch (e) {
      sendError("agent-history-entry-error", e);
    }
    return;
  }
  if (method === "agent_session.get") {
    try {
      const result = await readAgentSessionSummary(params ?? {});
      sendReply({ id, result }, "agent-session-get");
    } catch (e) {
      sendError("agent-session-get-error", e);
    }
    return;
  }
  if (method === "agent_turn.get") {
    try {
      const result = await readAgentTurn(params ?? {});
      sendReply({ id, result }, "agent-turn-get");
    } catch (e) {
      sendError("agent-turn-get-error", e);
    }
    return;
  }
  if (method === "agent_checkout.get") {
    try {
      const result = await connection.agentCheckout(params ?? {});
      sendReply({ id, result }, "agent-checkout-get");
    } catch (e) {
      sendError("agent-checkout-get-error", e);
    }
    return;
  }
  if (
    method === "agent_session.link_preview" ||
    method === "agent_session.link"
  ) {
    try {
      const result = await dispatchAgentSessionLink(
        route,
        method,
        params ?? {},
      );
      sendReply({ id, result }, method);
    } catch (e) {
      sendError("agent-session-link-error", e);
    }
    return;
  }
  return false;
}
