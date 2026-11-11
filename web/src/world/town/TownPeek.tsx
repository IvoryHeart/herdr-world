import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SquareTerminal, Terminal as ShellIcon } from "lucide-react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { agentStateWord } from "../agentMarks";
import { AgentLatestMessage } from "../AgentHoverCard";
import { CORE_WATCH_TITLE as WATCH_TITLE } from "../viewOnly";
import type { TownChoice, TownConversation } from "./townChat";
import { townPortrait } from "./townSprites";
import { store } from "../../store";
import { canOpenRoomShell, openRoomShell } from "../floatShell";
import type { WorldLeafObject } from "../worldObject";
import { useCoreSeen } from "../coreSeen";
import { CoreFavouriteButton } from "../CoreFavourite";
import { ContextFillBar } from "../../components/ContextFillBar";
import { useAgentContextFill } from "../agentContextFill";
import { ColorSwatchButton } from "../../components/ColorSwatch";
import {
  TERMINAL_COLOR_PALETTE,
  TERMINAL_COLORS,
  type TerminalColor,
} from "../terminalColor";

export function townStatusText(agent: OfficeAgent) {
  return agent.stale
    ? "Offline · last known state"
    : (agent.stateLabels[agent.semanticStatus] ??
        agentStateWord(agent.semanticStatus));
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
  leaf = null,
  onNext,
  onClose,
  onHold,
  onReviewed,
  review = { ready: true, failed: false, onRetry: () => {} },
  deskColor = null,
}: {
  /**
   * Whether the report shown is the current stop's: Mark reviewed waits
   * while a new stop's report is read, and offers Retry when it fails.
   */
  review?: { ready: boolean; failed: boolean; onRetry(): void };
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
  /**
   * The agent's live World object: its peek offers the room's floating
   * shell (Herdr Float, or World's own on core).
   */
  leaf?: WorldLeafObject | null;
  onNext: (() => void) | null;
  onClose(): void;
  onHold(hold: boolean): void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  // Follow the newest message unless the reader has scrolled up in it.
  const follow = useRef(true);
  const latest = conversation?.latest ?? null;
  const text = `${latest?.id ?? ""}${question.join("\n")}`;
  // A herdr-core agent drawn here is seen in Herdr's apps too.
  useCoreSeen(
    agent.coreShared ? { ...agent.coreShared, stale: agent.stale } : null,
  );
  const contextFill = useAgentContextFill({
    connectionId: agent.currentPaneRef.connectionId,
    generation: agent.currentPaneRef.generation,
    paneId: agent.currentPaneRef.nativeId,
  });
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
            </span>
            {/* Before the place, so a long place never clips it. */}
            {contextFill && !agent.stale ? (
              <ContextFillBar fill={contextFill} variant="inline" />
            ) : null}{" "}
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
        {agent.coreShared ? (
          <CoreFavouriteButton
            className="town-peek-favourite"
            target={agent.coreShared}
            disabled={agent.stale}
          />
        ) : null}
        <button
          type="button"
          className="town-peek-terminal"
          aria-label={`Open ${agent.displayLabel}'s terminal`}
          title={
            agent.viewOnly && !agent.viewOnly.watch
              ? agent.viewOnly.reason
              : agent.viewOnly
                ? WATCH_TITLE
                : "Open terminal"
          }
          disabled={Boolean(agent.viewOnly && !agent.viewOnly.watch)}
          onClick={onTerminal}
        >
          <SquareTerminal size={15} aria-hidden="true" />
          <span>Open terminal</span>
        </button>
        {leaf && canOpenRoomShell(leaf) ? (
          <button
            type="button"
            className="town-peek-terminal town-peek-shell"
            aria-label={`Open a shell in ${agent.displayLabel}'s room`}
            title="A shell in this room's folder that keeps running when hidden"
            onClick={() => {
              onClose();
              openRoomShell(leaf).catch((cause: unknown) =>
                store.notify({
                  kind: "error",
                  message: `No shell for ${agent.displayLabel}`,
                  detail:
                    cause instanceof Error ? cause.message : String(cause),
                }),
              );
            }}
          >
            <ShellIcon size={15} aria-hidden="true" />
            <span>Shell</span>
          </button>
        ) : null}
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
        <AgentLatestMessage
          conversation={conversation}
          taskSummary={agent.taskSummary}
          question={question}
          {...(agent.viewOnly ? { viewOnly: agent.viewOnly } : {})}
        />
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
          <button
            type="button"
            disabled={!review.ready || Boolean(agent.viewOnly)}
            title={
              agent.viewOnly
                ? agent.viewOnly.reason
                : review.ready
                  ? undefined
                  : review.failed
                    ? "The latest report could not be read"
                    : "Reading the latest report…"
            }
            onClick={onReviewed}
          >
            <span>Mark reviewed</span>
          </button>
        ) : null}
        {agent.semanticStatus === "done" && review.failed && !agent.viewOnly ? (
          <button type="button" onClick={review.onRetry}>
            <span>Retry</span>
          </button>
        ) : null}
        {agent.viewOnly && !agent.coreChat ? (
          <button type="button" disabled title={agent.viewOnly.reason}>
            <span>
              {agent.semanticStatus === "done" ? "Follow up" : "Open chat"}
            </span>
          </button>
        ) : canReply || agent.coreChat ? (
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
