import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SquareTerminal } from "lucide-react";
import type { OfficeAgent } from "../herdrOfficeProjection";
import { AttachmentChips } from "../../components/AttachmentChips";
import {
  useAttachmentDelivery,
  useAttachmentUploads,
} from "../../attachmentUploads";
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

const typingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
    target.closest(".xterm, [role='dialog']:not(.town-peek)") !== null);

/**
 * A hover card for one agent: its latest message from Chat's conversation
 * read model (never terminal text), the question it is asking, one-tap
 * answers and a reply line. On the phone the reply line opens World's
 * composer, so typing, keys and uploads use one window. Open terminal in the
 * header opens the agent's terminal.
 */
export function TownPeek({
  agent,
  where,
  conversation,
  question,
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
  uploadScope,
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
  /** Upload files for this pane, one chip each under `uploadScope`. */
  onAttach(files: File[], image: boolean): void;
  /**
   * Where this pane's attachments are kept. Paths finished there join the
   * inline reply line, including ones started by an earlier peek.
   */
  uploadScope: string | null;
  /** Type the reply in the card itself rather than opening the composer. */
  inlineReply: boolean;
  /** World's composer for this pane; present while chatting. */
  composer?: ReactNode;
  onInspector(): void;
  agent: OfficeAgent;
  where: string;
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
  const screen = useRef<HTMLDivElement>(null);
  const chatting = Boolean(composer);
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const uploading = useAttachmentUploads(uploadScope).some(
    (upload) => upload.status === "uploading",
  );
  const filePicker = useRef<HTMLInputElement>(null);
  const attach = (files: File[], image: boolean) => {
    if (files.length) onAttach(files, image);
  };
  // A different agent starts with an empty reply; mounting keeps any path
  // already taken in for this one.
  const draftAgent = useRef(agent.key);
  useEffect(() => {
    if (draftAgent.current === agent.key) return;
    draftAgent.current = agent.key;
    setDraft("");
  }, [agent.key]);
  // On the phone, paths go to World's composer draft instead.
  useAttachmentDelivery(inlineReply ? uploadScope : null, (text) => {
    setDraft((current) =>
      current && !current.endsWith(" ") ? `${current} ${text}` : current + text,
    );
    input.current?.focus();
  });
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
  }, [anchor?.x, anchor?.y, agent.key, text, choices.length]);

  useEffect(() => {
    if (!pinned) return;
    const keydown = (event: KeyboardEvent) => {
      if (typingTarget(event.target)) return;
      if (event.key === "Escape") {
        onClose();
        return;
      }
      // Answers and typing belong to the card: a key pressed while focus is
      // on another control (zoom, the rail) never writes to the agent.
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !(event.target instanceof Node) ||
        !card.current?.contains(event.target)
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
  // A pinned card takes focus, so its answer keys work at once, unless the
  // user is already typing somewhere.
  useEffect(() => {
    if (!pinned || !card.current) return;
    if (!typingTarget(document.activeElement))
      card.current.focus({ preventScroll: true });
  }, [pinned, agent.key]);

  return (
    <div
      ref={card}
      className={`town-peek${anchor ? "" : " town-peek-sheet"}${chatting ? " town-peek-chat" : ""}${agent.semanticStatus === "blocked" ? " town-peek-blocked" : ""}`}
      role="dialog"
      tabIndex={-1}
      data-agent-key={agent.key}
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
      {!chatting ? <AttachmentChips scope={uploadScope} /> : null}
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
            if (!text || sending || uploading) return;
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
                uploading ? "Uploading…" : `Reply to ${agent.displayLabel}…`
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
            disabled={inlineReply && (!draft.trim() || sending || uploading)}
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
