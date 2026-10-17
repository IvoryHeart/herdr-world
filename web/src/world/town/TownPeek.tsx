import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import type { HistoryEntry } from "../../components/agentHistory";
import { townLineKind, townQuestion, type TownChoice } from "./townChat";
import { townPortrait } from "./townSprites";

const STATUS: Record<OfficeAgent["semanticStatus"], string> = {
  working: "Working",
  blocked: "Needs your input",
  done: "Finished",
  idle: "On a break",
  unknown: "Unknown",
};

/** One history entry as a line or two of chat. */
function townHistoryText(entry: HistoryEntry) {
  const text = entry.text.replace(/\s+\n/g, "\n").trim();
  const short = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  if (entry.kind === "tool_call")
    return `⏺ ${entry.tool_name ?? "Tool"}${short ? ` · ${short.split("\n")[0]!.slice(0, 120)}` : ""}`;
  if (entry.kind === "error" || entry.is_error) return `✗ ${short}`;
  return entry.role === "user" ? `› ${short}` : short || "…";
}

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
 * A hover card for one agent: its latest chatter, the question it is asking,
 * one-tap answers and a reply line. On the phone the reply line opens World's
 * composer, so typing, keys and uploads use one window.
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
  inlineReply,
  onAttach,
  onReviewed,
  history,
}: {
  /** Recent messages from the agent's session, shown in place of its screen. */
  history: readonly HistoryEntry[] | null;
  /** Check a finished agent's work, which sends it for a break. */
  onReviewed(): void;
  /**
   * Upload files for this pane. Resolves to the text to put in the reply
   * line, or null when the upload went to World's composer instead.
   */
  onAttach(files: File[], image: boolean): Promise<string | null>;
  /** Type the reply in the card itself rather than opening the composer. */
  inlineReply: boolean;
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
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [uploads, setUploads] = useState(0);
  const filePicker = useRef<HTMLInputElement>(null);
  const attach = (files: File[], image: boolean) => {
    if (!files.length) return;
    setUploads((count) => count + 1);
    void onAttach(files, image).then((text) => {
      setUploads((count) => count - 1);
      if (text)
        setDraft((current) =>
          current && !current.endsWith(" ")
            ? `${current} ${text}`
            : current + text,
        );
      input.current?.focus();
    });
  };
  useEffect(() => setDraft(""), [agent.key]);
  const { chatter, question } =
    agent.semanticStatus === "blocked"
      ? townQuestion(lines, choices.length > 0 && canReply)
      : { chatter: [...lines], question: [] };
  // Follow the newest lines, as Desk's cards do, unless the reader has
  // scrolled up to read earlier messages.
  const follow = useRef(true);
  const text =
    lines.join("\n") +
    (history?.length ? `#${history[history.length - 1]!.id}` : "");
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
        return;
      }
      // Any other typing goes straight into the reply line.
      if (event.key.length === 1 && input.current) input.current.focus();
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
        {history?.length
          ? history.map((entry) => (
              <span
                key={entry.id}
                className={`town-msg town-msg-${entry.role}${entry.is_error ? " town-msg-error" : ""}`}
              >
                {townHistoryText(entry)}
                {"\n"}
              </span>
            ))
          : lines.length
            ? chatter.map((line, index) => (
                <span
                  key={index}
                  className={`town-line town-line-${townLineKind(line)}`}
                >
                  {line}
                  {"\n"}
                </span>
              ))
            : loading
              ? "Reading the screen…"
              : (agent.taskSummary ?? "Nothing on screen yet.")}
        {question.length ? (
          <span className="town-question">{question.join("\n")}</span>
        ) : null}
      </pre>
      {choices.length && canReply ? (
        <div className="town-answers" role="group" aria-label="Answers">
          {choices.map((choice, index) => (
            <button
              key={choice.key}
              type="button"
              title={choice.label}
              onClick={() => void onReply(choice.key, false)}
            >
              <span>{choice.label}</span>
              <kbd>{index + 1}</kbd>
            </button>
          ))}
        </div>
      ) : null}
      {agent.semanticStatus === "done" ? (
        <div className="town-answers" role="group" aria-label="Finished work">
          <button type="button" onClick={onReviewed}>
            <span>Mark reviewed</span>
          </button>
          {canReply ? (
            <button
              type="button"
              onClick={() => (inlineReply ? input.current?.focus() : onChat())}
            >
              <span>Follow up</span>
            </button>
          ) : null}
        </div>
      ) : null}
      {!chatting && canReply ? (
        <form
          className="town-reply"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (!inlineReply) {
              onChat();
              return;
            }
            if (!text || sending || uploads > 0) return;
            setSending(true);
            void onReply(text, true).then((sent) => {
              setSending(false);
              if (sent) setDraft("");
            });
          }}
        >
          <button
            type="button"
            className="town-attach"
            aria-label="Attach files"
            title="Attach files"
            disabled={uploads > 0}
            onClick={() => filePicker.current?.click()}
          >
            📎
          </button>
          <input
            ref={filePicker}
            type="file"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              // Reset so picking the same file again still fires change.
              event.target.value = "";
              attach(files, false);
            }}
          />
          {inlineReply ? (
            <input
              ref={input}
              value={draft}
              aria-label={`Reply to ${agent.displayLabel}`}
              placeholder={
                uploads > 0 ? "Uploading…" : `Reply to ${agent.displayLabel}…`
              }
              autoComplete="off"
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const images = Array.from(event.clipboardData.files).filter(
                  (file) => file.type.startsWith("image/"),
                );
                if (!images.length) return;
                event.preventDefault();
                attach(images, true);
              }}
            />
          ) : (
            <button
              type="button"
              className="town-message-box"
              aria-label={`Message ${agent.displayLabel}`}
              onClick={onChat}
            >
              Reply to {agent.displayLabel}…
            </button>
          )}
          <button
            type="submit"
            disabled={inlineReply && (!draft.trim() || sending || uploads > 0)}
          >
            Send
          </button>
        </form>
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
