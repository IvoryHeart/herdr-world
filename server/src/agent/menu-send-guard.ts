import type { ConversationSendResult } from "./conversation";
import type { PendingPrompt } from "./pending-prompt";
import type { ConversationDelivery } from "./conversation-delivery";

type Refusal = Extract<ConversationSendResult, { status: "refused" }>;

/**
 * Whether a send must not reach the pane: an open command menu would take the
 * typed text as its own keys (and could pick options with them), and a slash
 * command already queued while the agent works would be queued twice. A menu
 * that opens after this check and before the prompt lands is not caught (the
 * same gap as Herdr #4764).
 */
export function menuSendRefusal({
  text,
  command,
  agentStatus,
  openMenu,
  deliveries,
}: {
  text: string;
  command: boolean;
  agentStatus: string;
  openMenu: PendingPrompt | null;
  deliveries: readonly ConversationDelivery[];
}): Refusal | null {
  if (openMenu?.menu)
    return {
      status: "refused",
      reason: "menu",
      message: `A menu is open in the terminal (“${openMenu.question.join(" ").slice(0, 80)}”). Typing would go into it as keys, so nothing was sent. Close it first with the key its card names, then send again.`,
    };
  const sameQueued = deliveries.some(
    (delivery) =>
      delivery.kind === "command" &&
      delivery.queued &&
      delivery.text.trim() === text.trim(),
  );
  if (command && agentStatus === "working" && sameQueued)
    return {
      status: "refused",
      reason: "duplicate",
      message: `${text.trim().split(/\s/)[0]} is already waiting: the agent is busy and runs it when it reaches it. Nothing was sent.`,
    };
  return null;
}
