/**
 * The group orders' calls (#820), each the single-agent verb Town and Chat
 * already use: a message goes through Chat's send and admission
 * (`agent_conversation.latest`, then `agent_conversation.send` qualified by
 * the session it read), and Mark reviewed marks one agent at a time. Each
 * agent's outcome is reported as it arrives.
 */

import type {
  ConversationDelivery,
  SendResult,
} from "../../components/chat/types";
import type { TownReviewOutcome, TownSendOutcome } from "./townGroup";

type Client = {
  call(method: string, params?: Record<string, unknown>): Promise<unknown>;
  isCurrent(): boolean;
};

const refused = (reason: string): TownSendOutcome => ({
  status: "refused",
  reason,
});

const message = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * Send `text` to one agent as Chat does. It reads the agent's conversation
 * first: a question or menu on its screen, an unreadable session or an
 * unread session-switch notice refuses here, and the service's own checks
 * refuse the rest. A working agent's message is queued, as in Chat.
 */
export async function townSendOne(
  client: Client | null,
  paneId: string,
  text: string,
): Promise<TownSendOutcome> {
  if (!client || !client.isCurrent())
    return refused("its host changed; nothing was sent");
  try {
    const latest = (await client.call("agent_conversation.latest", {
      pane_id: paneId,
      menus: true,
    })) as {
      status?: string;
      session_fingerprint?: string | null;
      unavailable?: { detail?: string } | null;
      pending_prompt?: { menu?: unknown } | null;
      deliveries?: ConversationDelivery[];
    } | null;
    if (latest?.pending_prompt)
      return refused(
        latest.pending_prompt.menu
          ? "a menu is open on its screen; nothing was sent"
          : "it has a question; nothing was sent",
      );
    if (latest?.status !== "ok" || !latest.session_fingerprint)
      return refused(
        latest?.unavailable?.detail ??
          "Chat cannot read its session; nothing was sent",
      );
    if (
      latest.deliveries?.some((delivery) => delivery.state === "misdelivered")
    )
      return refused(
        "read the session-switch notice in its Chat first; nothing was sent",
      );
    const result = (await client.call("agent_conversation.send", {
      pane_id: paneId,
      text,
      session_fingerprint: latest.session_fingerprint,
    })) as (SendResult & { delivery?: { queued?: boolean } }) | null;
    if (result?.status === "sent")
      return result.delivery?.queued
        ? { status: "queued" }
        : { status: "sent" };
    return refused(
      result?.status === "refused" ? result.message : "World sent no answer",
    );
  } catch (cause) {
    return refused(`${message(cause)} Nothing was sent.`);
  }
}

/**
 * Send to every recipient at once and report each outcome as it arrives.
 * Resolves when every send has an outcome.
 */
export async function townSendAll<T extends { key: string }>(
  recipients: readonly T[],
  send: (recipient: T) => Promise<TownSendOutcome>,
  report: (key: string, outcome: TownSendOutcome) => void,
) {
  for (const recipient of recipients)
    report(recipient.key, { status: "sending" });
  await Promise.all(
    recipients.map(async (recipient) => {
      const outcome = await send(recipient).catch(
        (cause: unknown): TownSendOutcome => refused(message(cause)),
      );
      report(recipient.key, outcome);
    }),
  );
}

/**
 * Mark each finished agent's work reviewed with the existing rule, one agent
 * at a time, reporting each as the service saves it (or does not).
 */
export async function townReviewAll<T extends { key: string }>(
  agents: readonly T[],
  mark: (agent: T) => Promise<boolean>,
  report: (key: string, outcome: TownReviewOutcome) => void,
) {
  for (const agent of agents) report(agent.key, "marking");
  for (const agent of agents) {
    const saved = await mark(agent).catch(() => false);
    report(agent.key, saved ? "reviewed" : "not saved");
  }
}
