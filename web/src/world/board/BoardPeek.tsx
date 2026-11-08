/**
 * Board's peek at an agent, the preview Town's peek gives: its latest
 * message from Chat's conversation read model (never terminal text), the
 * question it is asking with one-tap answers, and Mark reviewed for a
 * finished agent. A mouse shows it by resting on an agent's card or row; a
 * tap opens it from the card's bar (Preview), so a phone reaches every
 * action too.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AgentLatestMessage } from "../AgentHoverCard";
import { agentStateWord } from "../agentMarks";
import { sharedDeskStore, type WorldDeskStore } from "../deskStateStore";
import { useShownReport } from "../shownReport";
import { markReviewed } from "../useReviewedWork";
import {
  sendTownReply,
  townChoices,
  townQuestion,
  townScreenLines,
  useTownScreen,
} from "../town/townChat";
import type { WorldLeafObject } from "../worldObject";
import "./boardPeek.css";

/** The agent being peeked at and where its card sits on screen. */
export type BoardPeekTarget = {
  leaf: WorldLeafObject;
  name: string;
  where: string;
  /** Whether its pane can take answers now (a current, reachable host). */
  canReply: boolean;
  /** Client point the card sits beside. */
  anchor: { x: number; y: number };
};

const isPhone = () => window.matchMedia("(max-width: 720px)").matches;

export function BoardPeek({
  target,
  notify,
  deskStore = sharedDeskStore(),
  onOpen,
  onClose,
  onHold,
}: {
  target: BoardPeekTarget;
  notify(kind: "ok" | "error", text: string): void;
  deskStore?: WorldDeskStore;
  /** Open the agent as the user opens agents: its Chat or its terminal. */
  onOpen(): void;
  onClose(): void;
  /** The pointer is over the peek: keep it while it is. */
  onHold(hold: boolean): void;
}) {
  const { leaf, name, where, canReply, anchor } = target;
  const status = leaf.stale ? "unknown" : leaf.status;
  const blocked = status === "blocked";
  const done = status === "done";
  // The screen is read only for a waiting agent's question and answers.
  const screen = useTownScreen(leaf, blocked, 2_000);
  // The report shown and its stop: Mark reviewed names only that stop.
  const report = useShownReport(leaf, true, done, deskStore);
  const choices = blocked ? townChoices(townScreenLines(screen, 12)) : [];
  const question = blocked
    ? townQuestion(townScreenLines(screen), choices.length > 0 && canReply)
        .question
    : [];
  const card = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const text = `${report.conversation?.latest?.id ?? ""}${question.join("\n")}`;
  useLayoutEffect(() => {
    if (follow.current && body.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [text]);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );
  useEffect(() => {
    if (!card.current) return;
    // A phone shows the peek as a sheet; CSS places it.
    if (isPhone()) return setPlaced({ left: 0, top: 0 });
    const box = card.current.getBoundingClientRect();
    const parent = card.current.offsetParent?.getBoundingClientRect();
    let left = anchor.x + 14;
    if (left + box.width > window.innerWidth - 12)
      left = anchor.x - box.width - 14;
    left = Math.max(12, left);
    const top = Math.min(
      Math.max(12, anchor.y - box.height / 2),
      window.innerHeight - box.height - 12,
    );
    setPlaced({
      left: left - (parent?.left ?? 0),
      top: top - (parent?.top ?? 0),
    });
  }, [anchor.x, anchor.y, text, choices.length]);
  const answer = async (key: string) => {
    try {
      await sendTownReply(leaf, key, false);
      notify("ok", `Sent to ${name}`);
    } catch (cause) {
      notify(
        "error",
        `Not sent to ${name}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  };
  return (
    <div
      ref={card}
      className={`board-peek board-s-${status}`}
      role="dialog"
      aria-label={`${name} peek`}
      data-leaf={leaf.id}
      style={
        placed && !isPhone()
          ? { left: placed.left, top: placed.top }
          : placed
            ? undefined
            : { visibility: "hidden" }
      }
      onPointerEnter={() => onHold(true)}
      onPointerLeave={() => onHold(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="board-peek-head">
        <span className="board-dot" aria-hidden="true" />
        <div>
          <b>{name}</b>
          <small>
            {leaf.stale ? "Offline · last known state" : agentStateWord(status)}
            {" · "}
            {where}
          </small>
        </div>
        <button
          type="button"
          className="board-peek-icon"
          aria-label="Close peek"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div
        ref={body}
        className="board-peek-screen"
        aria-label="Latest message"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        <AgentLatestMessage
          conversation={report.conversation}
          taskSummary={leaf.taskSummary}
          question={question}
        />
      </div>
      {choices.length && canReply ? (
        <div className="board-peek-actions" role="group" aria-label="Answers">
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              type="button"
              className={index === 0 ? "board-peek-primary" : undefined}
              title={choice.label}
              onClick={() => void answer(choice.key)}
            >
              <span>{choice.label}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="board-peek-actions" role="group" aria-label="Chat">
        {done ? (
          <button
            type="button"
            disabled={!report.review.ready}
            title={
              report.review.ready
                ? undefined
                : report.review.failed
                  ? "The latest report could not be read"
                  : "Reading the latest report…"
            }
            onClick={() =>
              void report
                .markShown(
                  (shown, stop) => markReviewed(deskStore, shown, stop),
                  name,
                  notify,
                )
                .then((saved) => {
                  if (saved) onClose();
                })
            }
          >
            <span>Mark reviewed</span>
          </button>
        ) : null}
        {done && report.review.failed ? (
          <button type="button" onClick={report.review.onRetry}>
            <span>Retry</span>
          </button>
        ) : null}
        {canReply ? (
          <button type="button" onClick={onOpen}>
            <span>{done ? "Follow up" : "Open"}</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
