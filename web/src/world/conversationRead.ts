import { useEffect, useState } from "react";
import { bridge, type ConnectionClient } from "../api";
import { watchConversation } from "../conversationWatch";
import type { Conversation } from "../components/AgentChat";
import { deskClient } from "./handoffs";
import { screenIdentity } from "./paneScreen";
import type { WorldLeafObject } from "./worldObject";

/** The pane's own current connection, or null if its owner changed. */
export const leafOwner = (leaf: WorldLeafObject): ConnectionClient | null =>
  deskClient(
    (candidate: WorldLeafObject) =>
      bridge.connection(candidate.connectionId, candidate.generation),
    leaf,
  );

export type LatestConversation = Omit<Conversation, "messages">;

export type ConversationRead = {
  conversation: LatestConversation | null;
  /** The `readFor` the conversation shown was read for. */
  readFor: string | null;
  /** The newest read for this `readFor` failed. */
  failed: boolean;
  retry(): void;
};

/**
 * The agent's latest message from Chat's conversation read model
 * (`agent_conversation.latest`), with the same unavailable reasons Chat
 * shows. While `active` it is read once and again whenever the service pushes
 * a change for this pane, as Chat is: no timer. A read that fails after a
 * readable one keeps the readable one, as Chat does.
 *
 * It also reads again whenever `readFor` changes and says which `readFor` the
 * conversation shown was read for, so a caller can tell a report of an
 * earlier stop from the current one.
 */
export function useConversationRead(
  leaf: WorldLeafObject | null,
  active: boolean,
  readFor: string | null = null,
): ConversationRead {
  const [conversation, setConversation] = useState<{
    id: string;
    value: LatestConversation;
    readFor: string | null;
  } | null>(null);
  const [failed, setFailed] = useState<{
    id: string;
    readFor: string | null;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const identity = leaf ? screenIdentity(leaf) : null;
  useEffect(() => {
    const client = leaf && leafOwner(leaf);
    if (!leaf || !client || !active || !identity) return;
    let cancelled = false;
    let shown: LatestConversation | null = null;
    // Only the newest read may answer; an older one can finish later.
    let sequence = 0;
    const read = async () => {
      const mine = ++sequence;
      const answering = () =>
        !cancelled && mine === sequence && client.isCurrent();
      // An unreadable conversation keeps the last one until it can be read,
      // and says the read failed.
      const fail = () => {
        if (answering()) setFailed({ id: identity, readFor });
      };
      try {
        const reply = (await client.call(
          "agent_conversation.latest",
          { pane_id: leaf.pane.pane_id },
          8_000,
        )) as LatestConversation | null;
        if (!answering()) return;
        if (
          !reply ||
          typeof reply !== "object" ||
          (reply.status !== "ok" && reply.status !== "unavailable")
        )
          return fail();
        if (
          reply.unavailable?.reason === "read_failed" &&
          shown?.status === "ok"
        )
          return;
        shown = reply;
        setFailed(null);
        setConversation({ id: identity, value: reply, readFor });
      } catch {
        fail();
      }
    };
    const stop = watchConversation(client, leaf.pane.pane_id, () => {
      void read();
    });
    void read();
    return () => {
      cancelled = true;
      stop();
    };
    // identity captures the leaf's owner and pane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, active, readFor, attempt]);
  const retry = () => setAttempt((count) => count + 1);
  const failedNow = failed?.id === identity && failed.readFor === readFor;
  return conversation?.id === identity
    ? {
        conversation: conversation.value,
        readFor: conversation.readFor,
        failed: failedNow,
        retry,
      }
    : { conversation: null, readFor: null, failed: failedNow, retry };
}
