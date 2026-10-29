import { useEffect, useId, useMemo, useRef, useState } from "react";
import { WorldPanel } from "./windows/WorldPanel";
import { useNow } from "./handoffs";
import { agentMarkKind } from "../agentMarks";
import { AgentMark } from "../components/AgentMark";
import { AskCard } from "../components/chat/blocks/ask";
import type { AnswerResult } from "../components/chat/types";
import { MarkdownPreview } from "../components/markdown";
import { townAgo } from "./town/TownRail";
import { townOwner, useTownConversation } from "./town/townChat";
import { useReviewedWork } from "./useReviewedWork";
import {
  askerName,
  sharedAsksStore,
  useWorldAsks,
  type WorldAsksStore,
} from "./worldAsks";
import type { WorldDeskStore } from "./deskStateStore";
import type { WorldLeafObject, WorldObject } from "./worldObject";
import {
  NEEDS_YOU_OPEN_EVENT,
  needsYouCount,
  needsYouItems,
  needsYouLeafKey,
  openNeedsYou,
  type NeedsYouItem,
} from "./needsYou";
import "./needsYouWindow.css";

/** An agent's name as Chat titles it: its Herdr name, else its label. */
const leafName = (leaf: WorldLeafObject) => leaf.agentName ?? leaf.label;
const leafWhere = (leaf: WorldLeafObject) =>
  [leaf.tabLabel, leaf.spaceLabel, leaf.hostLabel].filter(Boolean).join(" · ");

/** The window shows at most this many items; the rest are counted. */
const ITEM_LIMIT = 30;

/**
 * The one Needs you window for every view. Openers (the counter, Town's
 * reception, Desk's lane, Board's cards) dispatch openNeedsYou with the item
 * to show; the window is the shared panel, so it moves, resizes, expands and
 * reopens where it was left.
 */
export function NeedsYouHost({
  world,
  onOpenAgent,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  onOpenAgent(leafId: string): void;
}) {
  const [open, setOpen] = useState<{ itemKey?: string; at: number } | null>(
    null,
  );
  useEffect(() => {
    const show = (event: Event) => {
      const { itemKey } = (event as CustomEvent<{ itemKey?: string }>).detail;
      setOpen((current) => ({ itemKey, at: (current?.at ?? 0) + 1 }));
    };
    window.addEventListener(NEEDS_YOU_OPEN_EVENT, show);
    return () => window.removeEventListener(NEEDS_YOU_OPEN_EVENT, show);
  }, []);
  return open ? (
    <WorldPanel
      name="needs-you"
      label="Needs you"
      focusKey={open.at}
      onClose={() => setOpen(null)}
    >
      <NeedsYouWindow
        world={world}
        focusKey={open.itemKey}
        onOpenAgent={onOpenAgent}
      />
    </WorldPanel>
  ) : null;
}

/** "Needs you N" beside the view picker: questions and blocked agents. */
export function NeedsYouCounter({
  world,
}: {
  world: Pick<WorldObject, "leaves">;
}) {
  const asks = useWorldAsks(sharedAsksStore());
  const blocked = useMemo(
    () =>
      world.leaves.filter(
        (leaf) =>
          leaf.kind === "agent" &&
          leaf.status === "blocked" &&
          leaf.actionable &&
          !leaf.stale,
      ).length,
    [world.leaves],
  );
  const count = asks.length + blocked;
  return (
    <button
      type="button"
      className="needs-you-counter"
      aria-label={`Needs you: ${count}`}
      title="Open Needs you"
      onClick={() => openNeedsYou()}
    >
      <AgentMark kind={count ? "needs" : "idle"} />
      <span>Needs you</span>
      <b>{count}</b>
    </button>
  );
}

/**
 * Needs you as a conversation: each question, blocked agent and finished task
 * is a message from its agent, rendered as Chat renders it and answered in
 * place. The window around it is the shared World panel (WorldPanel).
 */
export function NeedsYouWindow({
  world,
  focusKey,
  now: shownNow,
  onOpenAgent,
  asksStore = sharedAsksStore(),
  deskStore,
}: {
  world: Pick<WorldObject, "leaves" | "nodeById">;
  /** The item an opener asked for, scrolled into view. */
  focusKey?: string;
  /** A fixed clock for tests; the open window ticks its own. */
  now?: number;
  onOpenAgent(leafId: string): void;
  /** The shared stores unless a test provides its own. */
  asksStore?: WorldAsksStore;
  deskStore?: WorldDeskStore;
}) {
  const ticking = useNow(5_000);
  const now = shownNow ?? ticking;
  const asks = useWorldAsks(asksStore);
  const work = useReviewedWork(deskStore);
  const all = needsYouItems(world, asks, work.reviewed);
  const items = all.slice(0, ITEM_LIMIT);
  // Answers given here, shown folded until the window closes.
  const [answered, setAnswered] = useState<
    readonly { key: string; name: string; text: string }[]
  >([]);
  const body = useRef<HTMLDivElement | null>(null);
  // An opener names an item, or an agent (needsYouLeafKey) for its item.
  const focused = focusKey
    ? items.find(
        (item) =>
          item.key === focusKey ||
          (item.leaf && needsYouLeafKey(item.leaf.id) === focusKey),
      )?.key
    : undefined;
  useEffect(() => {
    if (!focused) return;
    body.current
      ?.querySelector(`[data-needs-you-item="${CSS.escape(focused)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focused, focusKey]);
  const shown = new Set(items.map((item) => item.key));
  const folded = answered.filter((entry) => !shown.has(entry.key));
  const count = needsYouCount(all);
  return (
    <div className="needs-you" ref={body}>
      <p className="needs-you-count" role="status">
        {count
          ? `${count} waiting on you`
          : items.length
            ? "Nothing blocked; finished work to review below."
            : "Nobody is waiting on you."}
      </p>
      {items.map((item) => (
        <NeedsYouMessage
          key={item.key}
          item={item}
          now={now}
          focused={item.key === focused}
          onOpenAgent={onOpenAgent}
          onAnswer={async (text) => {
            if (item.kind !== "asks") return null;
            const problem = await asksStore.answer(item.ask.id, text);
            if (!problem)
              setAnswered((current) => [
                ...current,
                { key: item.key, name: askName(item), text },
              ]);
            return problem;
          }}
          onDismiss={() =>
            item.kind === "asks"
              ? asksStore.dismiss(item.ask.id)
              : Promise.resolve(null)
          }
          onReviewed={() =>
            item.kind === "done" ? work.mark(item.leaf) : Promise.resolve(false)
          }
        />
      ))}
      {all.length > items.length ? (
        <p className="needs-you-count">+{all.length - items.length} more</p>
      ) : null}
      {folded.map((entry) => (
        <article
          key={entry.key}
          className="needs-you-item is-answered"
          data-needs-you-item={entry.key}
        >
          <p>
            You answered <b>{entry.text}</b>. Waiting for {entry.name} to pick
            it up.
          </p>
        </article>
      ))}
    </div>
  );
}

const askName = (item: Extract<NeedsYouItem, { kind: "asks" }>) =>
  item.leaf ? leafName(item.leaf) : askerName(item.ask);

function NeedsYouMessage({
  item,
  now,
  focused,
  onOpenAgent,
  onAnswer,
  onDismiss,
  onReviewed,
}: {
  item: NeedsYouItem;
  now: number;
  focused: boolean;
  onOpenAgent(leafId: string): void;
  onAnswer(text: string): Promise<string | null>;
  onDismiss(): Promise<string | null>;
  onReviewed(): Promise<boolean>;
}) {
  const { leaf } = item;
  const name = item.kind === "asks" ? askName(item) : leafName(item.leaf);
  const unverified = item.kind === "asks" && !item.ask.actor.verified;
  const who = `${name}${unverified ? " (unverified)" : ""}`;
  const kind =
    item.kind === "asks"
      ? "asks"
      : agentMarkKind(item.kind === "needs" ? "blocked" : "done");
  return (
    <article
      className={`needs-you-item is-${item.kind}${focused ? " is-focused" : ""}`}
      data-needs-you-item={item.key}
      aria-label={`${who}: ${item.kind === "asks" ? "asks you" : item.kind === "needs" ? "needs you" : "done"}`}
    >
      <header>
        <AgentMark kind={kind} />
        <b>{name}</b>
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
            className="needs-you-open"
            aria-label={`Open ${name}`}
            onClick={() => onOpenAgent(leaf.id)}
          >
            Open agent
          </button>
        ) : null}
      </header>
      {item.kind === "asks" ? (
        <NeedsYouAsk
          question={item.ask.question}
          options={item.ask.options}
          who={who}
          onAnswer={onAnswer}
          onDismiss={onDismiss}
        />
      ) : (
        <NeedsYouAgent
          leaf={item.leaf}
          name={name}
          kind={item.kind}
          onOpenAgent={() => onOpenAgent(item.leaf.id)}
          onReviewed={onReviewed}
        />
      )}
    </article>
  );
}

/** An owner question: its options, a typed answer, or Dismiss. */
function NeedsYouAsk({
  question,
  options,
  who,
  onAnswer,
  onDismiss,
}: {
  question: string;
  options: readonly string[];
  who: string;
  onAnswer(text: string): Promise<string | null>;
  onDismiss(): Promise<string | null>;
}) {
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
      <div id={questionId}>
        <MarkdownPreview
          text={question}
          className="agent-chat-markdown needs-you-markdown"
          breaks
        />
      </div>
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
      {error ? <small role="alert">{error}</small> : null}
    </form>
  );
}

/**
 * A blocked or finished agent's latest message, as Chat reads it. A blocked
 * agent's question is answered with Chat's checked answer; finished work is
 * marked reviewed in the one reviewed record.
 */
function NeedsYouAgent({
  leaf,
  name,
  kind,
  onOpenAgent,
  onReviewed,
}: {
  leaf: WorldLeafObject;
  name: string;
  kind: "needs" | "done";
  onOpenAgent(): void;
  onReviewed(): Promise<boolean>;
}) {
  const conversation = useTownConversation(leaf, true);
  const latest = conversation?.latest ?? null;
  const prompt =
    kind === "needs" ? (conversation?.pending_prompt ?? null) : null;
  const [answering, setAnswering] = useState(false);
  const [notice, setNotice] = useState("");
  const [marking, setMarking] = useState(false);
  const answer = async (key: string, text?: string) => {
    const client = townOwner(leaf);
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
      setNotice(
        result.status === "sent" ? `Answered ${result.label}.` : result.message,
      );
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setAnswering(false);
    }
  };
  return (
    <>
      {latest ? (
        <MarkdownPreview
          text={latest.text}
          className="agent-chat-markdown needs-you-markdown"
          breaks
        />
      ) : (
        <p className="needs-you-empty">
          {conversation?.status === "unavailable"
            ? (conversation.unavailable?.detail ?? "No conversation.")
            : conversation
              ? (leaf.taskSummary ?? "No messages yet.")
              : "Loading conversation…"}
        </p>
      )}
      {prompt ? (
        <AskCard
          agent={name}
          prompt={prompt}
          answering={answering}
          notice={notice}
          onAnswer={(key, text) => void answer(key, text)}
          onOpenTerminal={onOpenAgent}
        />
      ) : notice ? (
        <small role="status">{notice}</small>
      ) : null}
      {kind === "done" ? (
        <div className="needs-you-options">
          <button
            type="button"
            className="is-primary"
            disabled={marking}
            onClick={() => {
              setMarking(true);
              void onReviewed().finally(() => setMarking(false));
            }}
          >
            Mark reviewed
          </button>
        </div>
      ) : null}
    </>
  );
}
