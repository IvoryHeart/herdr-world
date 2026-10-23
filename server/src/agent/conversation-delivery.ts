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
 *   in another session clearly after the send and within moments of it.
 * - `matched`: the same words appeared in its own session clearly after the
 *   send. That shows order, not cause: another client or person could have
 *   typed them. Chat marks that message as matched by its words, never as
 *   delivered, and keeps checking the other sessions until the check window
 *   ends.
 * - `uncertain`: the same words appeared at about the time of the send, or
 *   both in its own session and first in a session the pane moved to, so
 *   Chat cannot tell where it went.
 * - `unverified`: Chat can no longer check it, because the transcript it
 *   was sent to cannot be read or the check window passed.
 * Matched receipts are kept until their check window ends; after that the
 * cap may drop the oldest of them. The others stay until the user dismisses
 * them, and a full pane refuses new sends instead.
 */
export type ConversationDelivery = {
  id: string;
  text: string;
  sent_at: string;
  state: "pending" | "matched" | "misdelivered" | "uncertain" | "unverified";
  /** The session Chat showed when the message was sent. */
  expected: string;
  /** That session's fingerprint; a pending message shows only there. */
  fingerprint: string;
  /** matched: the transcript message taken for this send. */
  matched_id?: string;
  /**
   * matched: how. `words`: the same words. `order`: no turn had them, and
   * this was the first user turn in its session written after the send
   * (harnesses rewrite multi-line input, pastes and attachments).
   */
  matched_by?: "words" | "order";
  /** misdelivered: the session the evidence names. */
  delivered_to?: string;
  /** misdelivered: Herdr's prompt reply, or another session's transcript. */
  evidence?: "herdr" | "transcript";
  /** uncertain and unverified: why Chat cannot tell. */
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
  /**
   * Transcript times from `near` up to `after` are about the time of the
   * send: the clock's uncertainty, and a second for transcripts that round.
   * A copy stamped there may or may not be this message. One stamped at or
   * after `after` was written after the send began; one before `near` was
   * written before it.
   */
  near: number;
  after: number;
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
// Transcript timestamps may be rounded down to the second.
const TIMESTAMP_ROUNDING_MS = 1000;
/** Receipts kept per pane; a send is refused rather than drop one. */
export const RECEIPTS_PER_PANE = 20;
const SEEN_PER_RECEIPT = 4;

// An attachment as Chat sends it (an uploaded file's path, bare or quoted)
// or as a harness records it: Claude Code turns an image path into
// "[Image #N]" and long or multi-line input into "[Pasted text #N ...]".
const ATTACHMENT =
  /\[(?:Image|Pasted text) #\d+[^\]]*\]|(['"]?)[^\s'"]*herdr-world-uploads-[^\s'"]*\1/g;

// Harnesses trim, rewrap and rewrite what was typed, so words are compared
// without attachments and with whitespace collapsed.
// Claude Code wraps pasted and multi-line input in a pasted_content tag
// pair carrying one id; the words inside are what was typed.
const PASTED_WRAPPER = /<\/?pasted_content(?: id="[^"]*")?>/g;

export const typedText = (text: string) =>
  text
    .replace(PASTED_WRAPPER, " ")
    .replace(ATTACHMENT, " ")
    .replace(/\s+/g, " ")
    .trim();

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

  // Pending receipts, and matched ones within the check window, can still
  // change.
  const open = (receipt: Receipt, now: number) =>
    receipt.state === "pending" ||
    (receipt.state === "matched" &&
      now - receipt.sentAtMs <= DELIVERY_CHECK_MS);

  // A matched receipt whose window has ended can change no more, and
  // carries no warning: the only kind the cap may drop.
  const finished = (receipt: Receipt, now: number) =>
    receipt.state === "matched" && !open(receipt, now);

  const expireOne = (receipt: Receipt) => {
    receipt.state = "unverified";
    receipt.detail = `Chat did not see it in ${receipt.expected} within ${DELIVERY_CHECK_MS / 60_000} minutes.`;
  };

  return {
    /**
     * No room for another receipt: refuse the send rather than drop one
     * still being checked or a warning. Only matched receipts whose check
     * window has ended make room.
     */
    full: (paneId: string, now = Date.now()) =>
      (panes.get(paneId) ?? []).filter((receipt) => !finished(receipt, now))
        .length >= RECEIPTS_PER_PANE,

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
      const near =
        send.startedAt + offsetMs - uncertaintyMs - TIMESTAMP_ROUNDING_MS;
      const after = send.startedAt + offsetMs + uncertaintyMs;
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
        near,
        after,
        switchedBy: latest + MISDELIVERY_WINDOW_MS,
        until: latest + DELIVERY_CHECK_MS,
        baseline: new Set(send.baseline),
        seen: new Set(),
      };
      const list = receiptsFor(paneId);
      list.push(receipt);
      while (list.length > RECEIPTS_PER_PANE) {
        const index = list.findIndex((item) => finished(item, send.endedAt));
        if (index < 0) break;
        list.splice(index, 1);
      }
      return publicDelivery(receipt);
    },

    /**
     * The sessions whose transcripts can still change this pane's receipts:
     * each open one's own session and the others the pane showed since.
     */
    watching(paneId: string, now = Date.now()) {
      const sessions = new Set<string>();
      for (const receipt of panes.get(paneId) ?? []) {
        if (!open(receipt, now)) continue;
        sessions.add(receipt.fingerprint);
        for (const fingerprint of receipt.seen) sessions.add(fingerprint);
      }
      return sessions;
    },

    /**
     * Check open receipts against the session the pane shows now
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
      for (const receipt of list) {
        if (!open(receipt, now)) continue;
        if (
          current &&
          current !== receipt.fingerprint &&
          receipt.seen.size < SEEN_PER_RECEIPT
        )
          receipt.seen.add(current);
        const own = views.find(
          (view) => view.fingerprint === receipt.fingerprint,
        );
        const candidates = (view: DeliveryView) =>
          userMessages(view.messages ?? []).filter(
            (message) =>
              !claimed.has(claimKey(paneId, view.fingerprint, message.id)) &&
              Date.parse(message.sent_at) >= receipt.near,
          );
        const same = (message: ConversationMessage) =>
          typedText(message.text) === receipt.typed;
        let unclear: { view: DeliveryView; id: string } | null = null;
        // Its own session: a copy written clearly after the send matches it.
        let match: { view: DeliveryView; id: string } | null = null;
        if (receipt.state === "pending" && own?.messages) {
          const copies = candidates(own).filter(
            (message) =>
              same(message) &&
              !receipt.baseline.has(message.id) &&
              Date.parse(message.sent_at) <= receipt.until,
          );
          const after = copies.find(
            (message) => Date.parse(message.sent_at) >= receipt.after,
          );
          if (after) match = { view: own, id: after.id };
          else if (copies[0]) unclear = { view: own, id: copies[0].id };
        }
        // Another session: evidence only when the text is the first thing
        // said there clearly after the send, within moments of it. The same
        // words typed there later, or already there, are not.
        let evidence: { view: DeliveryView; id: string } | null = null;
        for (const view of views) {
          // An attachment alone has no words to tell sessions apart.
          if (
            view.fingerprint === receipt.fingerprint ||
            !view.messages ||
            !receipt.typed
          )
            continue;
          const first = candidates(view)[0];
          if (!first || !same(first)) continue;
          const at = Date.parse(first.sent_at);
          if (at < receipt.after) unclear ??= { view, id: first.id };
          else if (at <= receipt.switchedBy) {
            evidence = { view, id: first.id };
            break;
          }
        }
        const claim = (found: { view: DeliveryView; id: string }) =>
          claimed.add(claimKey(paneId, found.view.fingerprint, found.id));
        // Words in both sessions, or a match followed by evidence elsewhere,
        // cannot be told apart.
        if (evidence && (match || receipt.state === "matched")) {
          claim(evidence);
          if (match) claim(match);
          receipt.state = "uncertain";
          receipt.detail = `The same words appeared in ${receipt.expected} and, first thing after you sent them, in ${evidence.view.label}, so Chat cannot tell which got this message.`;
          continue;
        }
        if (evidence) {
          claim(evidence);
          receipt.state = "misdelivered";
          receipt.evidence = "transcript";
          receipt.delivered_to = evidence.view.label;
          continue;
        }
        if (match) {
          claim(match);
          receipt.state = "matched";
          receipt.matched_id = match.id;
          receipt.matched_by = "words";
          continue;
        }
        if (receipt.state !== "pending") continue;
        if (unclear) {
          claim(unclear);
          receipt.state = "uncertain";
          receipt.detail = `The same words appeared in ${unclear.view.label || receipt.expected} at about the time you sent them, so Chat cannot tell whether that was this message.`;
          continue;
        }
      }
      // A send no turn matched by its words takes the first user turn in its
      // own session written clearly after it, oldest send first. Harnesses
      // rewrite multi-line input, pastes and attachments, and a busy one
      // writes a queued message only when the agent takes it up; until a
      // turn appears, the send stays pending ("waiting").
      for (const receipt of list) {
        if (receipt.state !== "pending" || !open(receipt, now)) continue;
        const own = views.find(
          (view) => view.fingerprint === receipt.fingerprint,
        );
        const next = userMessages(own?.messages ?? []).find(
          (message) =>
            !claimed.has(claimKey(paneId, receipt.fingerprint, message.id)) &&
            !receipt.baseline.has(message.id) &&
            Date.parse(message.sent_at) >= receipt.after &&
            Date.parse(message.sent_at) <= receipt.until,
        );
        if (!next) continue;
        claimed.add(claimKey(paneId, receipt.fingerprint, next.id));
        receipt.state = "matched";
        receipt.matched_id = next.id;
        receipt.matched_by = "order";
      }
      for (const receipt of list) {
        if (receipt.state !== "pending" || !open(receipt, now)) continue;
        const own = views.find(
          (view) => view.fingerprint === receipt.fingerprint,
        );
        if (now - receipt.sentAtMs > DELIVERY_CHECK_MS) expireOne(receipt);
        else if (current !== receipt.fingerprint && own?.messages === null) {
          receipt.state = "unverified";
          receipt.detail = `The pane left ${receipt.expected} before Chat saw the message there, and Chat cannot read that session.`;
        }
      }
    },

    /**
     * End the check for receipts past their window, whether or not a read
     * happened: the source calls this when a receipt's deadline passes.
     */
    expire(paneId: string, now = Date.now()) {
      for (const receipt of panes.get(paneId) ?? [])
        if (
          receipt.state === "pending" &&
          now - receipt.sentAtMs > DELIVERY_CHECK_MS
        )
          expireOne(receipt);
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
    ...(receipt.matched_id ? { matched_id: receipt.matched_id } : {}),
    ...(receipt.matched_by ? { matched_by: receipt.matched_by } : {}),
    ...(receipt.delivered_to ? { delivered_to: receipt.delivered_to } : {}),
    ...(receipt.evidence ? { evidence: receipt.evidence } : {}),
    ...(receipt.detail ? { detail: receipt.detail } : {}),
  };
}

export type DeliveryLedger = ReturnType<typeof createDeliveryLedger>;
