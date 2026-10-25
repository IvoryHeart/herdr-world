import {
  conversationRpc,
  CONVERSATION_RPC_METHODS,
} from "../agent/conversation-rpc";
import { dispatchAgentSessionLink } from "../connections/rpc-routing";
import type { ConnectionRpcContext } from "./context";

/** Agent sessions, conversations, quests and history on one connection. */
export function handleAgentRpc(
  rpc: ConnectionRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "agent.list" ||
      method === "agent_conversation.watch" ||
      method === "agent_conversation.unwatch" ||
      CONVERSATION_RPC_METHODS.has(method) ||
      method === "agent_history.get" ||
      method === "agent_history.entry" ||
      method === "agent_session.get" ||
      method === "agent_turn.get" ||
      method === "agent_checkout.get" ||
      method === "agent_worktree.get" ||
      method === "agent_session.link_preview" ||
      method === "agent_session.link"
    )
  )
    return false;
  return dispatchAgentRpc(rpc);
}

async function dispatchAgentRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const { id, method, params, route, sendError, sendReply, ws, connection } =
    rpc;
  const { conversationWatchers } = rpc.services;
  const { herdr } = connection;
  const {
    readEntry: readAgentHistoryEntry,
    readHistoryRequest: readAgentMessageHistory,
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
  if (CONVERSATION_RPC_METHODS.has(method)) {
    try {
      const result = await conversationRpc(
        method,
        params ?? {},
        connection.agentSessions.conversation,
      );
      sendReply({ id, result }, method);
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
  if (method === "agent_worktree.get") {
    try {
      const result = await connection.agentWorktree.get(params?.subject, {
        refresh: params?.refresh === true,
      });
      sendReply({ id, result }, "agent-worktree-get");
    } catch (error) {
      sendError("agent-worktree-get-error", error);
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
