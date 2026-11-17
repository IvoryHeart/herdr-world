import { MarkdownPreview } from "../components/markdown";
import { AgentMark } from "../components/AgentMark";
import { agentMarkKind } from "./agentMarks";
import { formatUiDateTime } from "../uiLocale";
import {
  useConversationRead,
  type LatestConversation,
} from "./conversationRead";
import type { WorldLeafObject } from "./worldObject";
import { viewOnlyMessage } from "./viewOnly";

/**
 * An agent's latest message as Chat reads it (never terminal text), the
 * question it is asking, or why there is none. Town's peek and the Needs you
 * hover card show the same body.
 */
export function AgentLatestMessage({
  conversation,
  taskSummary,
  question = [],
  viewOnly,
}: {
  conversation: LatestConversation | null;
  taskSummary?: string;
  question?: readonly string[];
  /** A view-only agent: its own words and why World only watches it. */
  viewOnly?: { message: string; reason: string };
}) {
  const latest = conversation?.latest ?? null;
  const unavailable = conversation?.unavailable ?? null;
  return (
    <>
      {viewOnly ? (
        <div className="town-peek-unavailable is-view-only" role="status">
          <strong>{viewOnly.message}</strong>
          <span>{viewOnly.reason}</span>
        </div>
      ) : unavailable ? (
        <div className="town-peek-unavailable" role="status">
          <strong>Conversation unavailable</strong>
          <span>{unavailable.detail}</span>
          {unavailable.command ? <code>{unavailable.command}</code> : null}
        </div>
      ) : latest ? (
        <article
          className={`town-peek-message${latest.kind === "error" ? " is-error" : ""}`}
        >
          <MarkdownPreview
            text={latest.text}
            className="town-peek-markdown"
            breaks
          />
          <time dateTime={latest.sent_at} title={latest.sent_at}>
            {formatUiDateTime(latest.sent_at)}
          </time>
        </article>
      ) : (
        <p className="town-peek-empty">
          {conversation
            ? (taskSummary ?? "No messages yet.")
            : "Loading conversation…"}
        </p>
      )}
      {question.length ? (
        <pre className="town-question">{question.join("\n")}</pre>
      ) : null}
    </>
  );
}

/**
 * The hover card for an agent outside Town: its mark, name, where it is and
 * its latest message, the body Town's peek shows. It reads the conversation
 * only while shown.
 */
export function AgentHoverCard({
  leaf,
  name,
  where,
  id,
  floating = false,
}: {
  leaf: WorldLeafObject;
  name: string;
  where: string;
  id?: string;
  /** Shown over the content below instead of pushing it down (hover). */
  floating?: boolean;
}) {
  // A view-only agent has no conversation World can read.
  const read = useConversationRead(leaf, !leaf.viewOnly);
  return (
    <div
      className={floating ? "agent-hover-card is-floating" : "agent-hover-card"}
      id={id}
      role="tooltip"
    >
      <header>
        <AgentMark kind={agentMarkKind(leaf.status)} />
        <b>{name}</b>
        <small>{where}</small>
      </header>
      <div className="town-peek-screen" aria-label="Latest message">
        <AgentLatestMessage
          conversation={read.conversation}
          taskSummary={leaf.taskSummary}
          {...(leaf.viewOnly
            ? {
                viewOnly: {
                  message: viewOnlyMessage(leaf),
                  reason: leaf.viewOnly,
                },
              }
            : {})}
        />
      </div>
    </div>
  );
}
