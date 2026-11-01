import {
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { agentMarkKind } from "./agentMarks";
import { AgentMark } from "../components/AgentMark";
import { ChatAfterBlocks } from "../components/chat/blocks/after";
import type { AnswerResult } from "../components/chat/types";
import { MarkdownPreview } from "../components/markdown";
import { AgentHoverCard } from "./AgentHoverCard";
import { leafOwner, useConversationRead } from "./conversationRead";
import { townAgo } from "./town/TownRail";
import { askDeliveryMessage, askerName, type WorldAsk } from "./worldAsks";
import type { WorldLeafObject } from "./worldObject";
import type { NeedsYouItem } from "./needsYou";

/** An agent's name as Chat titles it: its Herdr name, else its label. */
export const leafName = (leaf: WorldLeafObject) => leaf.agentName ?? leaf.label;
export const leafWhere = (leaf: WorldLeafObject) =>
  [leaf.tabLabel, leaf.spaceLabel, leaf.hostLabel].filter(Boolean).join(" · ");
export const itemName = (item: NeedsYouItem) =>
  item.leaf
    ? leafName(item.leaf)
    : item.kind === "asks"
      ? askerName(item.ask)
      : "";

/**
 * One item in Needs you: a question (?), a blocked agent (!) or finished work
 * (✓), as a short message from its agent with its quick reply in place.
 * Chat about this opens the agent's Chat for anything longer.
 */
export function NeedsYouMessage({
  item,
  now,
  focused,
  stop,
  onChat,
  onOpenTerminal,
  onAnswer,
  onDismiss,
  onReviewed,
}: {
  item: NeedsYouItem;
  now: number;
  focused: boolean;
  /** The agent's current stop, as the reviewed record names it. */
  stop: string | null;
  onChat(leafId: string): void;
  onOpenTerminal(leafId: string): void;
  onAnswer(text: string): Promise<string | null>;
  onDismiss(): Promise<string | null>;
  onReviewed(stop: string): Promise<boolean>;
}) {
  const { leaf } = item;
  const name = itemName(item);
  const unverified = item.kind === "asks" && !item.ask.actor.verified;
  const who = `${name}${unverified ? " (unverified)" : ""}`;
  const kind =
    item.kind === "asks"
      ? "asks"
      : agentMarkKind(item.kind === "needs" ? "blocked" : "done");
  const cardId = useId();
  // Hover (or ⓘ on touch) shows the agent's card beside the item.
  const [card, setCard] = useState<"hover" | "pinned" | null>(null);
  // Chat about this; finished work offers it beside Mark reviewed.
  const chat = leaf ? (
    <button
      type="button"
      className="needs-you-chat"
      aria-label={`${item.kind === "done" ? "Follow up with" : "Chat with"} ${name} about this`}
      onClick={() => onChat(leaf.id)}
    >
      {item.kind === "done" ? "Follow up…" : "Chat about this"}
    </button>
  ) : null;
  return (
    <article
      className={`needs-you-item is-${item.kind}${focused ? " is-focused" : ""}`}
      data-needs-you-item={item.key}
      aria-label={`${who}: ${item.kind === "asks" ? "asks you" : item.kind === "needs" ? "needs you" : "done, not reviewed"}`}
    >
      <header>
        <AgentMark kind={kind} />
        {leaf ? (
          // The name opens the agent's window, as on every item: its Chat
          // holds the context behind a question or a report.
          <button
            type="button"
            className="needs-you-name"
            aria-label={`Open ${name}'s window`}
            title={`Open ${name}'s window`}
            aria-describedby={card ? cardId : undefined}
            onPointerEnter={(event) =>
              event.pointerType === "mouse" && setCard("hover")
            }
            onPointerLeave={() =>
              setCard((current) => (current === "hover" ? null : current))
            }
            onClick={() => onChat(leaf.id)}
          >
            {name}
          </button>
        ) : (
          <b className="needs-you-name">{name}</b>
        )}
        {unverified ? (
          <span
            className="needs-you-tag"
            title="World could not check this pane"
          >
            unverified
          </span>
        ) : null}
        <small>
          {leaf ? leafWhere(leaf) : ""}
          {item.kind === "asks" ? ` · ${townAgo(item.ask.at, now)}` : ""}
        </small>
        {leaf ? (
          <button
            type="button"
            className="needs-you-info"
            aria-label={`About ${name}`}
            aria-expanded={card === "pinned"}
            onClick={() =>
              setCard((current) => (current === "pinned" ? null : "pinned"))
            }
          >
            ⓘ
          </button>
        ) : null}
      </header>
      {card && leaf ? (
        <AgentHoverCard
          id={cardId}
          leaf={leaf}
          name={name}
          where={leafWhere(leaf)}
          floating={card === "hover"}
        />
      ) : null}
      {item.kind === "asks" ? (
        <NeedsYouAsk
          ask={item.ask}
          who={who}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ) : (
        <NeedsYouAgent
          leaf={item.leaf}
          name={name}
          kind={item.kind}
          stop={stop}
          onOpenTerminal={() => onOpenTerminal(item.leaf.id)}
          onReviewed={onReviewed}
          chat={chat}
        />
      )}
      {leaf && item.kind !== "done" ? (
        <div className="needs-you-options">{chat}</div>
      ) : null}
    </article>
  );
}

/**
 * An item's message, clipped to its first lines with More while it runs
 * longer. Tapping the clipped text (not a link in it) or More shows all of it
 * in place; Less clips it again. Only this box re-renders: the message is
 * passed in as children, so toggling never re-renders the markdown.
 */
export function NeedsYouText({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}) {
  const ownId = useId();
  const textId = id ?? ownId;
  const box = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [clipped, setClipped] = useState(false);
  const clippedNow = useRef(clipped);
  clippedNow.current = clipped;
  // Measured before paint, so More arrives with the text, never after it.
  // A clamped box keeps its height when its text changes, so watch both.
  // Only a change renders: a resize elsewhere (the list's scrollbar) must
  // not re-render every card.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element || expanded) return;
    const measure = () => {
      const next = element.scrollHeight > element.clientHeight + 1;
      if (next !== clippedNow.current) {
        clippedNow.current = next;
        setClipped(next);
      }
    };
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    const changed = new MutationObserver(measure);
    changed.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [expanded]);
  const toggle = useRef<HTMLButtonElement | null>(null);
  return (
    <>
      <div
        ref={box}
        id={textId}
        className={`needs-you-text${expanded ? " is-expanded" : clipped ? " is-clipped" : ""}`}
        onClick={(event) => {
          if (expanded || !clipped) return;
          // A link opens; a drag selects; neither expands.
          if (
            event.target instanceof Element &&
            event.target.closest("a, button, input")
          )
            return;
          if (window.getSelection()?.toString()) return;
          setExpanded(true);
        }}
      >
        {children}
      </div>
      {expanded || clipped ? (
        <button
          ref={toggle}
          type="button"
          className="needs-you-more-text"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => {
            setExpanded(!expanded);
            // Less: keep the control in view when the text above it shrinks.
            if (expanded)
              requestAnimationFrame(() =>
                toggle.current?.scrollIntoView?.({ block: "nearest" }),
              );
          }}
        >
          {expanded ? "Less" : "More"}
        </button>
      ) : null}
    </>
  );
}

/** An owner question: its options, a typed answer, or Dismiss. */
function NeedsYouAsk({
  ask,
  who,
  onAnswer,
  onDismiss,
}: {
  ask: WorldAsk;
  who: string;
  onAnswer(text: string): Promise<string | null>;
  onDismiss(): Promise<string | null>;
}) {
  const { question, options } = ask;
  const deliveryMessage = askDeliveryMessage(ask);
  const questionId = useId();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (close: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    const problem = await close();
    setBusy(false);
    setError(problem);
  };
  const send = (text: string) =>
    text.trim() ? act(() => onAnswer(text.trim())) : Promise.resolve();
  return (
    <form
      className="needs-you-answer"
      aria-label={`Question from ${who}`}
      onSubmit={(event) => {
        event.preventDefault();
        void send(draft);
      }}
    >
      <NeedsYouText id={questionId}>
        <MarkdownPreview
          text={question}
          className="needs-you-markdown"
          breaks
        />
      </NeedsYouText>
      {options.length ? (
        <div className="needs-you-options">
          {options.map((option, index) => (
            <button
              key={`${index}:${option}`}
              type="button"
              aria-describedby={questionId}
              disabled={busy}
              onClick={() => void send(option)}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <div className="needs-you-reply">
        <input
          value={draft}
          aria-label={`Your answer to ${who}`}
          aria-describedby={questionId}
          placeholder={options.length ? "Or type an answer" : "Your answer"}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" disabled={busy || !draft.trim()}>
          Answer
        </button>
        <button
          type="button"
          aria-label={`Dismiss the question from ${who} without answering`}
          disabled={busy}
          onClick={() => void act(onDismiss)}
        >
          Dismiss
        </button>
      </div>
      {error || deliveryMessage ? (
        <small role={error ? "alert" : "status"}>
          {error ?? deliveryMessage}
        </small>
      ) : null}
    </form>
  );
}

type Answered = Pick<
  Extract<AnswerResult, { status: "sent" }>,
  "number" | "label" | "text" | "acknowledged" | "unconfirmed_reason"
> & { question: string[]; fingerprint: string };

/**
 * A blocked or finished agent's latest message, as Chat reads it. A blocked
 * agent's question is answered with Chat's checked answer and receipt;
 * finished work is marked reviewed in the one reviewed record, for the stop
 * whose report is shown.
 */
function NeedsYouAgent({
  leaf,
  name,
  kind,
  stop,
  onOpenTerminal,
  onReviewed,
  chat,
}: {
  leaf: WorldLeafObject;
  name: string;
  kind: "needs" | "done";
  stop: string | null;
  onOpenTerminal(): void;
  onReviewed(stop: string): Promise<boolean>;
  /** Follow up…, shown beside Mark reviewed. */
  chat: ReactNode;
}) {
  // Read again when the stop moves on, so the report and the mark agree.
  const read = useConversationRead(leaf, true, stop);
  const conversation = read.conversation;
  const latest = conversation?.latest ?? null;
  const prompt =
    kind === "needs" ? (conversation?.pending_prompt ?? null) : null;
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState("");
  const [answered, setAnswered] = useState<Answered | null>(null);
  // A different question replaces the last answer's receipt, as in Chat, so
  // returning to an earlier question shows its answers again.
  useEffect(() => {
    if (prompt && prompt.fingerprint !== answered?.fingerprint)
      setAnswered(null);
    // Only a new question resets the receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.fingerprint]);
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState(false);
  const answer = async (key: string, text?: string) => {
    const client = leafOwner(leaf);
    if (!prompt || !client || answering) return;
    setAnswering(true);
    setNotice("");
    try {
      const result = (await client.call("agent_conversation.answer", {
        pane_id: leaf.pane.pane_id,
        key,
        ...(text !== undefined ? { text } : {}),
        prompt_fingerprint: prompt.fingerprint,
      })) as AnswerResult;
      if (result.status === "sent")
        setAnswered({
          fingerprint: prompt.fingerprint,
          question: prompt.question,
          number: result.number,
          label: result.label,
          ...(result.text !== undefined ? { text: result.text } : {}),
          acknowledged: result.acknowledged,
          unconfirmed_reason: result.unconfirmed_reason,
        });
      else setNotice(result.message);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAnswering(false);
    }
  };
  // The report on screen belongs to the current stop only once read for it.
  const stale = !conversation || read.readFor !== stop;
  const current = stop !== null && !stale;
  const unread = read.failed && stale;
  return (
    <>
      {latest ? (
        <NeedsYouText>
          <MarkdownPreview
            text={latest.text}
            className="needs-you-markdown"
            breaks
          />
        </NeedsYouText>
      ) : (
        <p className="needs-you-empty">
          {conversation?.status === "unavailable"
            ? (conversation.unavailable?.detail ?? "No conversation.")
            : conversation
              ? (leaf.taskSummary ?? "No messages yet.")
              : read.failed
                ? "Could not read the conversation."
                : "Loading conversation…"}
        </p>
      )}
      {unread ? (
        <div className="needs-you-options">
          <small role="alert">Could not read the latest report.</small>
          <button type="button" onClick={read.retry}>
            Retry
          </button>
        </div>
      ) : null}
      <ChatAfterBlocks
        running={null}
        clock={0}
        // A new question replaces the last answer's receipt, as in Chat.
        answered={
          answered && (!prompt || prompt.fingerprint === answered.fingerprint)
            ? answered
            : null
        }
        prompt={
          prompt && prompt.fingerprint !== answered?.fingerprint ? prompt : null
        }
        agent={name}
        answering={answering}
        notice={notice}
        onAnswer={(key, text) => void answer(key, text)}
        onOpenTerminal={onOpenTerminal}
      />
      {answered && !answered.acknowledged ? (
        <div className="needs-you-options">
          <button type="button" onClick={onOpenTerminal}>
            Open Terminal
          </button>
        </div>
      ) : null}
      {kind === "done" ? (
        <div className="needs-you-options">
          <button
            type="button"
            className="is-primary"
            disabled={marking || !current}
            title={
              current
                ? undefined
                : unread
                  ? "The latest report could not be read"
                  : "Reading the latest report…"
            }
            onClick={() => {
              if (!current || stop === null) return;
              setMarking(true);
              setMarkError(false);
              void onReviewed(stop)
                .then((saved) => setMarkError(!saved))
                .finally(() => setMarking(false));
            }}
          >
            Mark reviewed
          </button>
          {chat}
          {markError ? (
            <small role="alert">
              Could not save the review mark. Try again when the connection is
              ready.
            </small>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
