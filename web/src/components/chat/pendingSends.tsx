import { CheckCheck } from "lucide-react";
import type { ConversationDelivery } from "../AgentChat";

/**
 * Sends Herdr took that the session's transcript does not show yet. A busy
 * harness writes a message there only when the agent takes it up: delivered,
 * not yet read. Each sits at its send time, never below replies written
 * since, until that turn appears.
 */
export function placedSends(
  pending: readonly ConversationDelivery[],
  agent: string,
  onDismiss: (id: string) => void,
) {
  return pending.map((delivery) => ({
    key: delivery.id,
    // On the transcript host's clock, so an SSH host's offset cannot put it
    // below replies written after it.
    at: delivery.transcript_at ?? delivery.sent_at,
    node: (
      <article
        className="agent-history-chat-message is-user is-pending"
        data-delivery="pending"
      >
        <div className="agent-history-chat-bubble">
          <p>{delivery.text}</p>
        </div>
        <div className="agent-history-chat-meta">
          <CheckCheck
            size={13}
            className="agent-chat-ticks"
            aria-hidden="true"
          />
          Delivered · waiting for {agent}{" "}
          <button
            type="button"
            className="agent-chat-pending-dismiss"
            onClick={() => onDismiss(delivery.id)}
          >
            Stop checking
          </button>
        </div>
      </article>
    ),
  }));
}

/** Transcript turns matched to this session's sends, and how. */
export function matchedTurns(
  deliveries: readonly ConversationDelivery[],
  fingerprint: string | null | undefined,
) {
  return new Map(
    deliveries.flatMap((delivery) =>
      delivery.state === "matched" &&
      delivery.fingerprint === fingerprint &&
      delivery.matched_id
        ? [[delivery.matched_id, delivery.matched_by ?? "words"] as const]
        : [],
    ),
  );
}
