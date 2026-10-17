import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import type { TownChoice } from "./townChat";
import { townPortrait } from "./townSprites";

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

const typingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest(".xterm, [role='dialog']:not(.town-peek)") !== null);

/**
 * A hover card for one agent: its live screen and one-tap answers. Replies
 * open World's terminal composer, so typing and uploads use one window.
 */
export function TownPeek({
  agent,
  where,
  lines,
  loading,
  choices,
  canReply,
  anchor,
  pinned,
  onReply,
  onChat,
  onTerminal,
  onInspector,
  onNext,
  onClose,
  onHold,
  composer,
}: {
  /** World's composer for this pane; present while chatting. */
  composer?: ReactNode;
  onInspector(): void;
  agent: OfficeAgent;
  where: string;
  lines: readonly string[];
  loading: boolean;
  choices: readonly TownChoice[];
  canReply: boolean;
  /** Client point the card sits beside; null shows it as a bottom sheet. */
  anchor: { x: number; y: number } | null;
  pinned: boolean;
  onReply(text: string, submit: boolean): Promise<boolean>;
  onChat(): void;
  onTerminal(): void;
  onNext: (() => void) | null;
  onClose(): void;
  onHold(hold: boolean): void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLPreElement>(null);
  const chatting = Boolean(composer);
  // Follow the newest lines, as Desk's cards do, unless the reader has
  // scrolled up to read earlier messages.
  const follow = useRef(true);
  const text = lines.join("\n");
  useEffect(() => {
    follow.current = true;
  }, [agent.key]);
  useLayoutEffect(() => {
    if (follow.current && screen.current)
      screen.current.scrollTop = screen.current.scrollHeight;
  }, [text, chatting]);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(
    null,
  );

  useEffect(() => {
    if (!anchor || !card.current) {
      setPlaced(null);
      return;
    }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor?.x, anchor?.y, agent.key, lines.length, choices.length]);

  useEffect(() => {
    if (!pinned) return;
    const keydown = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (
        typingTarget(event.target) ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return;
      const choice = choices.find(
        (candidate, index) =>
          event.key === String(index + 1) || event.key === candidate.key,
      );
      if (choice && canReply) {
        event.preventDefault();
        void onReply(choice.key, false);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [pinned, choices, canReply, onClose, onReply]);

  return (
    <div
      ref={card}
      className={`town-peek${anchor ? "" : " town-peek-sheet"}${chatting ? " town-peek-chat" : ""}${agent.semanticStatus === "blocked" ? " town-peek-blocked" : ""}`}
      role="dialog"
      aria-label={`${agent.displayLabel} peek`}
      style={
        anchor
          ? placed
            ? { left: placed.left, top: placed.top }
            : { visibility: "hidden" }
          : undefined
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
        <button
          type="button"
          className="town-peek-close"
          aria-label="Close peek"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <pre
        ref={screen}
        className="town-peek-screen"
        aria-label="Latest messages"
        onScroll={(event) => {
          const element = event.currentTarget;
          follow.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <
            24;
        }}
      >
        {lines.length
          ? lines.join("\n")
          : loading
            ? "Reading the screen…"
            : (agent.taskSummary ?? "Nothing on screen yet.")}
      </pre>
      {choices.length && canReply ? (
        <div className="town-answers" role="group" aria-label="Answers">
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              type="button"
              onClick={() => void onReply(choice.key, false)}
            >
              {choice.label}
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
      {!chatting && canReply ? (
        <button
          type="button"
          className="town-message-box"
          aria-label={`Message ${agent.displayLabel}`}
          onClick={onChat}
        >
          Message {agent.displayLabel}…
        </button>
      ) : null}
      <div className="town-peek-foot">
        <button
          type="button"
          title="Files, changes and history"
          onClick={onInspector}
        >
          Inspector
        </button>
        <button type="button" onClick={onTerminal}>
          Terminal
        </button>
        {onNext ? (
          <button type="button" onClick={onNext}>
            Next ›
          </button>
        ) : null}
      </div>
      {composer}
    </div>
  );
}
