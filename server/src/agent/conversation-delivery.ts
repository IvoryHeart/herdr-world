import { randomUUID } from "node:crypto";
import type { ConversationMessage } from "./conversation";

/**
 * A message Chat sent that it has not yet seen arrive. Herdr's prompt takes
 * no expected session (herdrdev/herdr#4764), so a switch after Chat's last
 * check can deliver it elsewhere. Chat therefore never calls a message
 * delivered: it stays `pending` until it appears in the transcript of the
 * session Chat showed, and becomes `misdelivered`, naming where it went,
 * when Herdr or a transcript shows it reached another session.
 */
export type ConversationDelivery = {
  id: string;
  text: string;
  sent_at: string;
  state: "pending" | "misdelivered";
  /** The session Chat showed when the message was sent. */
  expected: string;
  /** Where it went, when it reached another session. */
  delivered_to?: string;
};

type Receipt = ConversationDelivery & {
  normalized: string;
  sentAtMs: number;
  fingerprint: string;
  /** User messages already in the expected transcript before the send. */
  baseline: ReadonlySet<string>;
};

/** What a read of the pane shows, for matching receipts against. */
export type DeliveryView = {
  fingerprint: string | null;
  label: string;
  messages: readonly ConversationMessage[];
};

// A transcript on another host may be written by a clock slightly behind.
const CLOCK_SKEW_MS = 5000;
const RECEIPTS_PER_PANE = 20;

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function createDeliveryLedger() {
  const panes = new Map<string, Receipt[]>();
  // A transcript message settles at most one send. Message IDs are content
  // hashes, so they are scoped to the pane and session read.
  const claimed = new Set<string>();
  const claimKey = (paneId: string, view: DeliveryView, id: string) =>
    JSON.stringify([paneId, view.fingerprint, id]);

  const receiptsFor = (paneId: string) => {
    let list = panes.get(paneId);
    if (!list) {
      list = [];
      panes.set(paneId, list);
    }
    return list;
  };

  return {
    record(
      paneId: string,
      send: {
        text: string;
        fingerprint: string;
        expected: string;
        baseline: readonly ConversationMessage[];
        delivered_to?: string;
        now?: number;
      },
    ): ConversationDelivery {
      const now = send.now ?? Date.now();
      const receipt: Receipt = {
        id: randomUUID(),
        text: send.text,
        sent_at: new Date(now).toISOString(),
        state: send.delivered_to ? "misdelivered" : "pending",
        expected: send.expected,
        ...(send.delivered_to ? { delivered_to: send.delivered_to } : {}),
        normalized: normalize(send.text),
        sentAtMs: now,
        fingerprint: send.fingerprint,
        baseline: new Set(
          send.baseline
            .filter((message) => message.role === "user")
            .map((message) => message.id),
        ),
      };
      const list = receiptsFor(paneId);
      list.push(receipt);
      // Keep every misdelivery until dismissed; drop the oldest pending.
      while (list.length > RECEIPTS_PER_PANE) {
        const index = list.findIndex((item) => item.state === "pending");
        list.splice(index >= 0 ? index : 0, 1);
      }
      return publicDelivery(receipt);
    },

    /** Settle pending receipts against what a read of the pane shows. */
    evaluate(paneId: string, view: DeliveryView) {
      const list = panes.get(paneId);
      if (!list) return;
      for (const receipt of [...list]) {
        if (receipt.state !== "pending") continue;
        const sameSession = view.fingerprint === receipt.fingerprint;
        const arrived = view.messages.find(
          (message) =>
            message.role === "user" &&
            message.kind === "message" &&
            !claimed.has(claimKey(paneId, view, message.id)) &&
            normalize(message.text) === receipt.normalized &&
            (sameSession
              ? !receipt.baseline.has(message.id)
              : Date.parse(message.sent_at) >=
                receipt.sentAtMs - CLOCK_SKEW_MS),
        );
        if (!arrived) continue;
        claimed.add(claimKey(paneId, view, arrived.id));
        if (sameSession) {
          list.splice(list.indexOf(receipt), 1);
        } else {
          receipt.state = "misdelivered";
          receipt.delivered_to = view.label;
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
    ...(receipt.delivered_to ? { delivered_to: receipt.delivered_to } : {}),
  };
}

export type DeliveryLedger = ReturnType<typeof createDeliveryLedger>;
