import type { ConnectionClient } from "./connectionClient";
import type { Pane } from "./types";

/** Chat's calls that type into the agent. */
const INPUT = new Set([
  "agent_conversation.send",
  "agent_conversation.answer",
  "agent_conversation.press",
  "agent_conversation.trust",
]);

/**
 * Chat's runtime adapter for a herdr-core agent: the same client, with every
 * input call addressed to the program the person saw (the read model's
 * `core_recipient`). Core refuses input without it, and the service checks
 * the occupant against it right before sending. A Herdr pane's client is
 * returned as it is.
 */
export function chatClient(
  client: ConnectionClient,
  pane: Pick<Pane, "runtime" | "core_recipient">,
): ConnectionClient {
  if (pane.runtime !== "herdr-core") return client;
  const recipient = pane.core_recipient ?? "";
  return {
    get agentWorktree() {
      return client.agentWorktree;
    },
    get connectionId() {
      return client.connectionId;
    },
    get generation() {
      return client.generation;
    },
    get serverRuntimeGeneration() {
      return client.serverRuntimeGeneration;
    },
    call: (method, params, timeoutMs, options) =>
      client.call(
        method,
        INPUT.has(method) ? { ...params, recipient } : params,
        timeoutMs,
        options,
      ),
    isCurrent: () => client.isCurrent(),
    acceptsServerGeneration: (value) => client.acceptsServerGeneration(value),
  };
}

/** Why Chat's Stop is off for a herdr-core agent World cannot address. */
export const CORE_STOP_REASON =
  "World does not know which program this is for yet. Interrupt this turn from the Terminal tab.";
