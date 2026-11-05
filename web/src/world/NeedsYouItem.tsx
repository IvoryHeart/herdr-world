import { MessageSquare, SendHorizontal, X } from "lucide-react";
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
import { chooseTrust } from "../components/chat/blocks/trust";
import type { AnswerResult, TrustChoice } from "../components/chat/types";
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

/** A card's header: its kind's own close action, if any, after Chat. */
type Head = (close: ReactNode) => ReactNode;

/**
 * One item in Needs you: a question (?), a blocked agent (!) or finished work
 * (✓), as a notification from its agent.
 *
 * Every kind has one anatomy: a header row (mark, name, place · age, then
 * the Chat icon and the kind's ✕), the message clipped to two lines with
 * "more", and quick replies or an answer field only when the agent asked.
 * ✕ keeps each kind's own action: Dismiss question on a question, Mark
 * reviewed on finished work; a blocked agent has none.
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
  // Hovering the name shows the agent's card beside the item.
  const [card, setCard] = useState(false);
  const at = item.kind === "asks" ? item.ask.at : leaf?.lastActivityAt;
  const meta = [
    leaf ? (leaf.spaceLabel ?? leaf.hostLabel) : "",
    typeof at === "number" ? townAgo(at, now) : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const done = item.kind === "done";
  const head: Head = (close) => (
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
            event.pointerType === "mouse" && setCard(true)
          }
          onPointerLeave={() => setCard(false)}
          onClick={() => onChat(leaf.id)}
        >
          {name}
        </button>
      ) : (
        <b className="needs-you-name">{name}</b>
      )}
      {unverified ? (
        <span className="needs-you-tag" title="World could not check this pane">
          unverified
        </span>
      ) : null}
      <small className="needs-you-meta">{meta}</small>
      {leaf ? (
        <button
          type="button"
          className="needs-you-icon needs-you-chat"
          aria-label={
            done ? `Follow up with ${name}` : `Chat with ${name} about this`
          }
          title={done ? "Follow up in Chat" : "Open in Chat"}
          onClick={() => onChat(leaf.id)}
        >
          <MessageSquare size={16} aria-hidden="true" />
        </button>
      ) : null}
      {close}
    </header>
  );
  return (
    <article
      className={`needs-you-item is-${item.kind}${focused ? " is-focused" : ""}`}
      data-needs-you-item={item.key}
      aria-label={`${who}: ${item.kind === "asks" ? "asks you" : item.kind === "needs" ? "needs you" : "done, not reviewed"}`}
    >
      {item.kind === "asks" ? (
        <NeedsYouAsk
          ask={item.ask}
          name={name}
          who={who}
          head={head}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ) : (
        <NeedsYouAgent
          leaf={item.leaf}
          name={name}
          kind={item.kind}
          stop={stop}
          head={head}
          onOpenTerminal={() => onOpenTerminal(item.leaf.id)}
          onReviewed={onReviewed}
        />
      )}
      {card && leaf ? (
        <AgentHoverCard
          id={cardId}
          leaf={leaf}
          name={name}
          where={leafWhere(leaf)}
          floating
        />
      ) : null}
    </article>
  );
}

/**
 * An item's message, clipped to two lines with "more" on the last line while
 * it runs longer. Tapping the clipped text (not a link in it) or "more"
 * shows all of it in place; "less", at its end, clips it again. Only this
 * box re-renders: the message is passed in as children, so toggling never
 * re-renders the markdown.
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
  // Measured before paint, so "more" arrives with the text, never after it.
  // A clipped box keeps its height when its text changes, so watch both.
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
  return (
    <div
      ref={box}
      id={textId}
      className={`needs-you-text${expanded ? " is-expanded" : clipped ? " is-clipped" : ""}`}
      onFocus={(event) => {
        // Tab can reach links below the clip. Reveal keyboard focus before
        // the user activates it; pointer clicks on visible links stay put.
        if (
          !expanded &&
          clipped &&
          event.target.matches(":focus-visible") &&
          !event.target.matches(".needs-you-more-text")
        )
          setExpanded(true);
      }}
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
      {expanded || clipped ? (
        <button
          type="button"
          className="needs-you-more-text"
          aria-expanded={expanded}
          aria-controls={textId}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "less" : "more"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * An owner question: its options as quick replies (the first one primary,
 * then "Other…" for a typed answer), or one answer field when it offers
 * none. ✕ dismisses it without answering.
 */
function NeedsYouAsk({
  ask,
  name,
  who,
  head,
  onAnswer,
  onDismiss,
}: {
  ask: WorldAsk;
  name: string;
  who: string;
  head: Head;
  onAnswer(text: string): Promise<string | null>;
  onDismiss(): Promise<string | null>;
}) {
  const { question, options } = ask;
  const deliveryMessage = askDeliveryMessage(ask);
  const questionId = useId();
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const field = useRef<HTMLInputElement | null>(null);
  // "Other…" swaps the replies for the field and moves focus into it.
  useEffect(() => {
    if (typing) field.current?.focus();
  }, [typing]);
  const act = async (close: () => Promise<string | null>) => {
    if (busy) return;
    setBusy(true);
    const problem = await close();
    setBusy(false);
    setError(problem);
  };
  const send = (text: string) =>
    text.trim() ? act(() => onAnswer(text.trim())) : Promise.resolve();
  const notice = error ?? deliveryMessage;
  return (
    <>
      {head(
        <button
          type="button"
          className="needs-you-icon"
          aria-label={`Dismiss ${who}'s question without answering`}
          title="Dismiss question"
          disabled={busy}
          onClick={() => void act(onDismiss)}
        >
          <X size={16} aria-hidden="true" />
        </button>,
      )}
      <NeedsYouText id={questionId}>
        <MarkdownPreview
          text={question}
          className="needs-you-markdown"
          breaks
        />
      </NeedsYouText>
      {options.length && !typing ? (
        <div
          className="needs-you-replies"
          role="group"
          aria-label={`Answers to ${who}`}
        >
          {options.map((option, index) => (
            <button
              key={`${index}:${option}`}
              type="button"
              className={index === 0 ? "is-primary" : undefined}
              aria-describedby={questionId}
              disabled={busy}
              onClick={() => void send(option)}
            >
              {option}
            </button>
          ))}
          <button
            type="button"
            className="ghost"
            title="Type another answer"
            disabled={busy}
            onClick={() => setTyping(true)}
          >
            Other…
          </button>
        </div>
      ) : (
        <form
          className="needs-you-field"
          aria-label={`Question from ${who}`}
          onSubmit={(event) => {
            event.preventDefault();
            void send(draft);
          }}
        >
          <input
            ref={field}
            value={draft}
            aria-label={`Your answer to ${who}`}
            aria-describedby={questionId}
            placeholder={`Answer ${name}…`}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="needs-you-icon"
            aria-label="Send answer"
            title="Send answer"
            disabled={busy || !draft.trim()}
          >
            <SendHorizontal size={16} aria-hidden="true" />
          </button>
        </form>
      )}
      {notice ? (
        <small className="needs-you-notice" role={error ? "alert" : "status"}>
          {notice}
        </small>
      ) : null}
    </>
  );
}

type Answered = Pick<
  Extract<AnswerResult, { status: "sent" }>,
  "number" | "label" | "text" | "acknowledged" | "unconfirmed_reason"
> & { question: string[]; fingerprint: string };

/**
 * A blocked or finished agent's latest message, as Chat reads it. A blocked
 * agent's question is answered with Chat's checked answer and receipt, its
 * options as quick replies; finished work is marked reviewed (✕) in the one
 * reviewed record, for the stop whose report is shown.
 */
function NeedsYouAgent({
  leaf,
  name,
  kind,
  stop,
  head,
  onOpenTerminal,
  onReviewed,
}: {
  leaf: WorldLeafObject;
  name: string;
  kind: "needs" | "done";
  stop: string | null;
  head: Head;
  onOpenTerminal(): void;
  onReviewed(stop: string): Promise<boolean>;
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
  // Claude's folder-trust question, as in Chat.
  const trust = async (choice: TrustChoice) => {
    const client = leafOwner(leaf);
    if (!prompt?.trust || !client || answering) return;
    setAnswering(true);
    setNotice("");
    setNotice(await chooseTrust(client, leaf.pane.pane_id, prompt, choice));
    setAnswering(false);
    read.retry();
  };
  // The report on screen belongs to the current stop only once read for it.
  const stale = !conversation || read.readFor !== stop;
  const current = stop !== null && !stale;
  const unread = read.failed && stale;
  // A question still waiting is the message; its options are the replies.
  const asking =
    prompt && prompt.fingerprint !== answered?.fingerprint ? prompt : null;
  return (
    <>
      {head(
        kind === "done" ? (
          <button
            type="button"
            className="needs-you-icon"
            aria-label={`Mark ${name}'s work reviewed`}
            title={
              current
                ? "Mark reviewed"
                : unread
                  ? "Mark reviewed: the latest report could not be read"
                  : "Mark reviewed: reading the latest report…"
            }
            disabled={marking || !current}
            onClick={() => {
              if (!current || stop === null) return;
              setMarking(true);
              setMarkError(false);
              void onReviewed(stop)
                .then((saved) => setMarkError(!saved))
                .finally(() => setMarking(false));
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null,
      )}
      {asking ? null : latest ? (
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
        <div className="needs-you-replies">
          <small className="needs-you-notice" role="alert">
            Could not read the latest report.
          </small>
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
        prompt={asking}
        renderPromptMessage={(message) => (
          <NeedsYouText>
            <div className="needs-you-markdown">{message}</div>
          </NeedsYouText>
        )}
        agent={name}
        answering={answering}
        notice={notice}
        onAnswer={(key, text) => void answer(key, text)}
        onOpenTerminal={onOpenTerminal}
        onTrust={(choice) => void trust(choice)}
      />
      {answered && !answered.acknowledged ? (
        <div className="needs-you-replies">
          <button type="button" onClick={onOpenTerminal}>
            Open Terminal
          </button>
        </div>
      ) : null}
      {markError ? (
        <small className="needs-you-notice" role="alert">
          Could not save the review mark. Try again when the connection is
          ready.
        </small>
      ) : null}
    </>
  );
}
