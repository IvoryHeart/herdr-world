import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SquareTerminal } from "lucide-react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { MarkdownPreview } from "../../components/markdown";
import { formatUiDateTime } from "../../uiLocale";
import type { TownChoice, TownConversation } from "./townChat";
import { townPortrait } from "./townSprites";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import {
  TERMINAL_COLOR_PALETTE,
  TERMINAL_COLORS,
  type TerminalColor,
} from "../terminalColor";

const STATUS: Record<OfficeAgent["semanticStatus"], string> = {
  working: "Working",
  blocked: "Needs your input",
  done: "Finished",
  idle: "On a break",
  unknown: "Unknown",
};

export function townStatusText(agent: OfficeAgent) {
  return agent.stale
    ? "Offline · last known state"
    : (agent.stateLabels[agent.semanticStatus] ?? STATUS[agent.semanticStatus]);
}

/**
 * A hover card for one agent, a preview only: its latest message from Chat's
 * conversation read model (never terminal text), the question it is asking
 * and one-tap answers that send the offered key. Replies, follow-ups and
 * attachments happen in the agent's one window: Open chat (or tapping the
 * agent) opens it on Chat, and Open terminal in the header opens its
 * terminal.
 */
export function TownPeek({
  agent,
  where,
  conversation,
  question,
  choices,
  canReply,
  anchor,
  onAnswer,
  onChat,
  onTerminal,
  onNext,
  onClose,
  onHold,
  onReviewed,
  deskColor = null,
}: {
  /** The colour of the agent's desk (its terminal), to change or reset. */
  deskColor?: {
    current: TerminalColor;
    custom: boolean;
    onColor(color: TerminalColor | null): void;
  } | null;
  /** The agent's latest message, as Chat reads it; null while loading. */
  conversation: TownConversation | null;
  /** The question a waiting agent asks, shown above its answers. */
  question: readonly string[];
  /** Check a finished agent's work, which sends it for a break. */
  onReviewed(): void;
  agent: OfficeAgent;
  where: string;
  choices: readonly TownChoice[];
  canReply: boolean;
  /** Client point the card sits beside. */
  anchor: { x: number; y: number };
  /** Send one offered answer's key to the agent's pane. */
  onAnswer(key: string): void;
  /** Open the agent's one window on Chat. */
  onChat(): void;
  onTerminal(): void;
  onNext: (() => void) | null;
  onClose(): void;
  onHold(hold: boolean): void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  // Follow the newest message unless the reader has scrolled up in it.
  const follow = useRef(true);
  const latest = conversation?.latest ?? null;
  const unavailable = conversation?.unavailable ?? null;
  const text = `${latest?.id ?? ""}${question.join("\n")}`;
  useEffect(() => {
    follow.current = true;
  }, [agent.key]);
  useLayoutEffect(() => {
    if (follow.current && screen.current)
      screen.current.scrollTop = screen.current.scrollHeight;
  }, [text]);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    if (!card.current) return;
    const box = card.current.getBoundingClientRect();
    const parent = card.current.offsetParent?.getBoundingClientRect();
    const originX = parent?.left ?? 0;
    const originY = parent?.top ?? 0;
    const width = window.innerWidth;
    const height = window.innerHeight;
    let left = anchor.x + 18;
    if (left + box.width > width - 12) left = anchor.x - box.width - 18;
    left = Math.max(12, left);
    const top = Math.min(
      Math.max(12, anchor.y - box.height / 2),
      height - box.height - 12,
    );
    setPlaced({ left: left - originX, top: top - originY });
    // The card is re-placed when its anchor point or content size changes.
  }, [anchor.x, anchor.y, agent.key, text, choices.length]);

  return (
    <div
      ref={card}
      className={`town-peek${agent.semanticStatus === "blocked" ? " town-peek-blocked" : ""}`}
      role="dialog"
      tabIndex={-1}
      data-agent-key={agent.key}
      aria-label={`${agent.displayLabel} peek`}
      style={
        placed
          ? { left: placed.left, top: placed.top }
          : { visibility: "hidden" }
      }
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onFocus={() => onHold(true)}
    >
      <div className="town-peek-head">
        <img src={townPortrait(agent.key)} alt="" />
        <div>
          <b>{agent.displayLabel}</b>
          <small>
            <span className={`town-pill town-pill-${agent.semanticStatus}`}>
              {townStatusText(agent)}
            </span>{" "}
            {where}
          </small>
        </div>
        {deskColor ? (
          <ColorSwatchButton
            className="town-peek-color"
            label="Desk colour"
            palette={TERMINAL_COLOR_PALETTE}
            current={{ id: deskColor.current, custom: deskColor.custom }}
            onColor={(id) =>
              deskColor.onColor(
                TERMINAL_COLORS.includes(id as TerminalColor)
                  ? (id as TerminalColor)
                  : null,
              )
            }
          />
        ) : null}
        <button
          type="button"
          className="town-peek-terminal"
          aria-label={`Open ${agent.displayLabel}'s terminal`}
          title="Open terminal"
          onClick={onTerminal}
        >
          <SquareTerminal size={15} aria-hidden="true" />
          <span>Open terminal</span>
        </button>
        <button
          type="button"
          className="town-peek-close"
          aria-label="Close peek"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        ref={screen}
        className="town-peek-screen"
        aria-label="Latest message"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        {unavailable ? (
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
              className="agent-chat-markdown town-peek-markdown"
              breaks
            />
            <time dateTime={latest.sent_at} title={latest.sent_at}>
              {formatUiDateTime(latest.sent_at)}
            </time>
          </article>
        ) : (
          <p className="town-peek-empty">
            {conversation
              ? (agent.taskSummary ?? "No messages yet.")
              : "Loading conversation…"}
          </p>
        )}
        {question.length ? (
          <pre className="town-question">{question.join("\n")}</pre>
        ) : null}
      </div>
      {choices.length && canReply ? (
        <div className="town-answers" role="group" aria-label="Answers">
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              type="button"
              title={choice.label}
              onClick={() => onAnswer(choice.key)}
            >
              <span>{choice.label}</span>
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
      <div className="town-answers" role="group" aria-label="Chat">
        {agent.semanticStatus === "done" ? (
          <button type="button" onClick={onReviewed}>
            <span>Mark reviewed</span>
          </button>
        ) : null}
        {canReply ? (
          <button type="button" onClick={onChat}>
            <span>
              {agent.semanticStatus === "done" ? "Follow up" : "Open chat"}
            </span>
          </button>
        ) : null}
      </div>
      <div className="town-peek-foot">
        {onNext ? (
          <button type="button" onClick={onNext}>
            Next ›
          </button>
        ) : null}
      </div>
    </div>
  );
}
