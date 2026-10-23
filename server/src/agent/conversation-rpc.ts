import type { ConversationSource } from "./conversation";

/** The agent_conversation.* methods, answered by `conversationRpc`. */
export const CONVERSATION_RPC_METHODS: ReadonlySet<string> = new Set([
  "agent_conversation.get",
  "agent_conversation.latest",
  "agent_conversation.steps",
  "agent_conversation.send",
  "agent_conversation.answer",
  "agent_conversation.dismiss",
]);

/**
 * Answer one agent_conversation.* request from a connection's conversation
 * source. Parameters arrive untyped from the browser, so each is checked.
 */
export async function conversationRpc(
  method: string,
  p: Record<string, unknown>,
  source: ConversationSource,
): Promise<unknown> {
  const paneId = typeof p.pane_id === "string" ? p.pane_id : "";
  if (method !== "agent_conversation.latest" && !paneId)
    throw new Error(`${method} requires pane_id`);
  if (method === "agent_conversation.steps")
    return {
      steps: await source.steps({
        pane_id: paneId,
        // Bounded: History's window shows at most a few hundred calls.
        call_ids: (Array.isArray(p.call_ids) ? p.call_ids : [])
          .filter((callId): callId is string => typeof callId === "string")
          .slice(0, 500),
      }),
    };
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
  return result;
}
