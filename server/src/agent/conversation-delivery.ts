import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "./conversation";

/**
 * A message Chat sent that it has not yet seen arrive. Herdr's prompt takes
 * no expected session (herdrdev/herdr#4764), so a switch after Chat's last
 * check can deliver it elsewhere. Chat therefore never calls a message
 * delivered:
 * - `pending`: not yet seen in the session it was sent to; shown only in that
 *   session's conversation.
 * - `misdelivered`: there is evidence of a switch after the send, either
 *   Herdr's prompt reply naming another session or the text arriving first
 *   in another session right after the send.
 * - `unverified`: Chat can no longer check it, for example because the pane
 *   left the session before the text was seen there and that transcript
 *   cannot be read, or because the check window passed.
 * A pending message seen in its own session is settled and removed. The
 * others stay until the user dismisses them.
 */
export type ConversationDelivery = {
  id: string;
  text: string;
  sent_at: string;
  state: "pending" | "misdelivered" | "unverified";
  /** The session Chat showed when the message was sent. */
  expected: string;
  /** That session's fingerprint; a pending message shows only there. */
  fingerprint: string;
  /** misdelivered: the session the evidence names. */
  delivered_to?: string;
  /** misdelivered: Herdr's prompt reply, or another session's transcript. */
  evidence?: "herdr" | "transcript";
  /** unverified: why Chat stopped checking. */
  detail?: string;
};

/**
 * The transcript clock relative to this service: `offsetMs` is the transcript
 * host's time minus ours, known to within `uncertaintyMs`. Zero for this
 * machine; measured for an SSH host.
 */
export type DeliveryClock = { offsetMs: number; uncertaintyMs: number };

/** One session's transcript, for matching receipts against. */
export type DeliveryView = {
  fingerprint: string;
  label: string;
  /** Null when Chat cannot read this session's transcript. */
  messages: readonly ConversationMessage[] | null;
};

type Receipt = ConversationDelivery & {
  typed: string;
  sentAtMs: number;
  /** Transcript time before which the text cannot have been recorded. */
  from: number;
  /** Latest transcript time at which another session's copy is evidence. */
  switchedBy: number;
  /** Latest transcript time at which the expected session's copy counts. */
  until: number;
  /** User messages already in the expected transcript before the send. */
  baseline: ReadonlySet<string>;
  /** Other sessions the pane showed while this was pending. */
  seen: Set<string>;
};

/** How long Chat looks for a sent message before it stops checking. */
export const DELIVERY_CHECK_MS = 15 * 60_000;
/**
 * Herdr types the text when it handles the prompt, and transcripts record a
 * submitted prompt at once, so a copy in another session is evidence only
 * within this long after the send.
 */
export const MISDELIVERY_WINDOW_MS = 10_000;
// Transcript timestamps may be rounded to the second.
const TIMESTAMP_SLACK_MS = 1000;
/** Receipts kept per pane; a send is refused rather than drop one. */
export const RECEIPTS_PER_PANE = 20;
const SEEN_PER_RECEIPT = 4;

// Harnesses may trim what was typed; inner whitespace is kept, so prompts
// that differ only in spacing stay distinct.
const typedText = (text: string) => text.trim();

const userMessages = (messages: readonly ConversationMessage[]) =>
  messages.filter(
    (message) => message.role === "user" && message.kind === "message",
  );

export function createDeliveryLedger() {
  const panes = new Map<string, Receipt[]>();
  // A transcript message settles at most one send. Message IDs are content
  // hashes, so they are scoped to the pane and session read.
  const claimed = new Set<string>();
  const claimKey = (paneId: string, fingerprint: string, id: string) =>
    JSON.stringify([paneId, fingerprint, id]);

  const receiptsFor = (paneId: string) => {
    let list = panes.get(paneId);
    if (!list) {
      list = [];
      panes.set(paneId, list);
    }
    return list;
  };

  return {
    /** No room for another receipt: refuse the send rather than drop one. */
    full: (paneId: string) =>
      (panes.get(paneId)?.length ?? 0) >= RECEIPTS_PER_PANE,

    /**
     * Record a send. `startedAt` and `endedAt` bracket the prompt call on
     * this service's clock.
     */
    record(
      paneId: string,
      send: {
        text: string;
        fingerprint: string;
        expected: string;
        /** IDs of the user messages Chat showed before sending. */
        baseline: Iterable<string>;
        clock: DeliveryClock;
        startedAt: number;
        endedAt: number;
        /** Herdr's prompt reply named another identified session. */
        switchedTo?: string;
      },
    ): ConversationDelivery {
      const { offsetMs, uncertaintyMs } = send.clock;
      const from =
        send.startedAt + offsetMs - uncertaintyMs - TIMESTAMP_SLACK_MS;
      const latest = send.endedAt + offsetMs + uncertaintyMs;
      const receipt: Receipt = {
        id: randomUUID(),
        text: send.text,
        sent_at: new Date(send.startedAt).toISOString(),
        state: send.switchedTo ? "misdelivered" : "pending",
        expected: send.expected,
        fingerprint: send.fingerprint,
        ...(send.switchedTo
          ? { delivered_to: send.switchedTo, evidence: "herdr" as const }
          : {}),
        typed: typedText(send.text),
        sentAtMs: send.startedAt,
        from,
        switchedBy: latest + MISDELIVERY_WINDOW_MS,
        until: latest + DELIVERY_CHECK_MS,
        baseline: new Set(send.baseline),
        seen: new Set(),
      };
      receiptsFor(paneId).push(receipt);
      return publicDelivery(receipt);
    },

    /**
     * The sessions whose transcripts can settle this pane's pending
     * receipts: each one's own session and the others the pane showed since.
     */
    watching(paneId: string) {
      const sessions = new Set<string>();
      for (const receipt of panes.get(paneId) ?? []) {
        if (receipt.state !== "pending") continue;
        sessions.add(receipt.fingerprint);
        for (const fingerprint of receipt.seen) sessions.add(fingerprint);
      }
      return sessions;
    },

    /**
     * Settle pending receipts against the session the pane shows now
     * (`current`, null when none is bound) and the transcripts read for it.
     */
    evaluate(
      paneId: string,
      current: string | null,
      views: readonly DeliveryView[],
      now = Date.now(),
    ) {
      const list = panes.get(paneId);
      if (!list) return;
      for (const receipt of [...list]) {
        if (receipt.state !== "pending") continue;
        if (
          current &&
          current !== receipt.fingerprint &&
          receipt.seen.size < SEEN_PER_RECEIPT
        )
          receipt.seen.add(current);
        const own = views.find(
          (view) => view.fingerprint === receipt.fingerprint,
        );
        const arrived = own?.messages
          ? userMessages(own.messages).find((message) => {
              const at = Date.parse(message.sent_at);
              return (
                message.text.trim() === receipt.typed &&
                !receipt.baseline.has(message.id) &&
                !claimed.has(claimKey(paneId, own.fingerprint, message.id)) &&
                at >= receipt.from &&
                at <= receipt.until
              );
            })
          : undefined;
        if (own && arrived) {
          claimed.add(claimKey(paneId, own.fingerprint, arrived.id));
          list.splice(list.indexOf(receipt), 1);
          continue;
        }
        // Another session is evidence only when the text is the first thing
        // anyone said there after the send, within moments of it: the same
        // words typed there later are not.
        for (const view of views) {
          if (view.fingerprint === receipt.fingerprint || !view.messages)
            continue;
          const first = userMessages(view.messages).find(
            (message) => Date.parse(message.sent_at) >= receipt.from,
          );
          if (
            !first ||
            first.text.trim() !== receipt.typed ||
            Date.parse(first.sent_at) > receipt.switchedBy ||
            claimed.has(claimKey(paneId, view.fingerprint, first.id))
          )
            continue;
          claimed.add(claimKey(paneId, view.fingerprint, first.id));
          receipt.state = "misdelivered";
          receipt.evidence = "transcript";
          receipt.delivered_to = view.label;
          break;
        }
        if (receipt.state !== "pending") continue;
        if (now - receipt.sentAtMs > DELIVERY_CHECK_MS) {
          receipt.state = "unverified";
          receipt.detail = `Chat did not see it in ${receipt.expected} within ${DELIVERY_CHECK_MS / 60_000} minutes.`;
        } else if (current !== receipt.fingerprint && own?.messages === null) {
          receipt.state = "unverified";
          receipt.detail = `The pane left ${receipt.expected} before Chat saw the message there, and Chat cannot read that session.`;
        }
      }
    },

    list(paneId: string): ConversationDelivery[] {
      return (panes.get(paneId) ?? []).map(publicDelivery);
    },

    dismiss(paneId: string, id: string) {
      const list = panes.get(paneId);
      const index = list?.findIndex((receipt) => receipt.id === id) ?? -1;
      if (list && index >= 0) list.splice(index, 1);
      return index >= 0;
    },
  };
}

function publicDelivery(receipt: Receipt): ConversationDelivery {
  return {
    id: receipt.id,
    text: receipt.text,
    sent_at: receipt.sent_at,
    state: receipt.state,
    expected: receipt.expected,
    fingerprint: receipt.fingerprint,
    ...(receipt.delivered_to ? { delivered_to: receipt.delivered_to } : {}),
    ...(receipt.evidence ? { evidence: receipt.evidence } : {}),
    ...(receipt.detail ? { detail: receipt.detail } : {}),
  };
}

export type DeliveryLedger = ReturnType<typeof createDeliveryLedger>;
