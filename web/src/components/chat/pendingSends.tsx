import type { ConversationDelivery } from "../AgentChat";
import { formatUiDateTime } from "../../uiLocale";
import { CommandReceipt } from "./blocks/command";

/**
 * Sends Herdr took that the session's transcript does not show yet. A busy
 * harness writes a message there only when the agent takes it up. Native
 * admission is not a transcript receipt. Each sits at its send time, never below replies written
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
    node:
      delivery.kind === "command" ? (
        <CommandReceipt
          text={delivery.text}
          at={delivery.sent_at}
          detail={delivery.detail}
          onDismiss={() => onDismiss(delivery.id)}
        />
      ) : (
        <article
          className="agent-history-chat-message is-user is-pending"
          data-delivery={delivery.state}
        >
          <div className="agent-history-chat-bubble">
            <p>{delivery.text}</p>
          </div>
          <div className="agent-history-chat-meta">
            {delivery.queued && delivery.state === "pending"
              ? `Queued · sent to ${agent}`
              : "Sent, not seen in the transcript"}{" "}
            ·{" "}
            <time dateTime={delivery.sent_at}>
              {formatUiDateTime(delivery.sent_at)}
            </time>{" "}
            <button
              type="button"
              className="agent-chat-pending-dismiss"
              onClick={() => onDismiss(delivery.id)}
            >
              {delivery.state === "pending" ? "Stop checking" : "Dismiss"}
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
