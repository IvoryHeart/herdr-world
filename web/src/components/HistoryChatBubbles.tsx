import type { useChatSpeech } from "../useChatSpeech";
import type { HistoryEntry } from "./agentHistory";
import { HISTORY_PREVIEW_CHARS } from "./AgentHistoryCard";
import { useState } from "react";
import { Copy, RotateCw, X } from "lucide-react";
import { copyTextWithFeedback } from "../copyText";
import {
  attachedImagePieces,
  type MessagePiece,
  messageImagePieces,
} from "../chatImages";
import { ImageLightbox } from "./ImageLightbox";
import type { OutboxMessage } from "./chatOutbox";
import type { ChatRow } from "./chat/chatSenders";
import type { HistoryDecorator } from "./historyDecoration";
type MessageImage = Extract<MessagePiece, { image: string }>;

/** A message of the user's, with the images it sent shown, not their paths. */
export function UserText({
  text,
  imageUrl,
  images,
}: {
  text: string;
  imageUrl?: (path: string) => string;
  images?: readonly string[];
  from?: string | null;
  fromKind?: ChatRow["sender"]["kind"];
  continued?: boolean;
  matched?: "words" | "order" | null;
  decorate?: HistoryDecorator;
  decorationToken?: unknown;
}) {
  const [shown, setShown] = useState<MessageImage | null>(null);
  const pieces = (
    images?.length
      ? attachedImagePieces(text, images)
      : messageImagePieces(text)
  ).flatMap((piece): MessagePiece[] =>
    // A path with nowhere to load it from stays text.
    "image" in piece && !piece.url && !imageUrl
      ? [{ text: piece.image }]
      : [piece],
  );
  if (!pieces.some((piece) => "image" in piece)) return <p>{text}</p>;
  const nameOf = (path: string) => path.split(/[\\/]/).pop() ?? path;
  const urlOf = (piece: MessageImage) => piece.url ?? imageUrl!(piece.image);
  return (
    <>
      {pieces.map((piece, index) =>
        "image" in piece ? (
          <a
            // The pieces of a message never move.
            key={index}
            className="agent-history-chat-image"
            href={urlOf(piece)}
            target="_blank"
            rel="noreferrer"
            title={piece.image}
            // A click leaves the focus where it was (the message box), for
            // the image to give it back there: in the list, it would stop
            // the chat following new messages.
            onMouseDown={(event) => {
              if (event.button === 0) event.preventDefault();
            }}
            onClick={(event) => {
              // Cmd / Ctrl / Shift / middle click still open a tab.
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              setShown(piece);
            }}
          >
            <img src={urlOf(piece)} alt={nameOf(piece.image)} loading="lazy" />
          </a>
        ) : (
          <p key={index}>{piece.text}</p>
        ),
      )}
      {shown ? (
        <ImageLightbox
          src={urlOf(shown)}
          name={nameOf(shown.image)}
          onClose={() => setShown(null)}
        />
      ) : null}
    </>
  );
}

// A message sent from the chat that the transcript does not show yet: on its
// way (dashed and dimmed, like a queued one) until its entry replaces it, or
// not delivered, with the ways out.
export function OutboxBubble({
  message,
  onRetry,
  onDiscard,
}: {
  message: OutboxMessage;
  onRetry?: (message: OutboxMessage) => void;
  onDiscard?: (message: OutboxMessage) => void;
}) {
  const failed = message.state === "failed";
  return (
    <article
      className={`agent-history-chat-message is-user is-outbox is-${message.state}`}
      data-outbox-id={message.id}
    >
      <div className="agent-history-chat-bubble">
        <p>{message.text.slice(0, HISTORY_PREVIEW_CHARS)}</p>
      </div>
      <div className="agent-history-chat-meta">
        {failed ? (
          <>
            <span
              className="agent-history-chat-undelivered"
              title={message.reason}
            >
              Not delivered
            </span>
            {onRetry ? (
              <button
                type="button"
                className="agent-history-copy"
                onClick={() => onRetry(message)}
                aria-label="Send this message again"
                title="Send again"
              >
                <RotateCw size={12} />
              </button>
            ) : null}
            {onDiscard ? (
              <button
                type="button"
                className="agent-history-copy"
                onClick={() => onDiscard(message)}
                aria-label="Discard this message"
                title="Discard"
              >
                <X size={12} />
              </button>
            ) : null}
          </>
        ) : (
          <span
            className="agent-history-chat-sending"
            role="status"
            title={
              message.state === "sending"
                ? "Sending it to the agent"
                : "Sent: waiting for the agent's session to show it"
            }
          >
            <span
              className="agent-history-chat-sending-mark"
              aria-hidden="true"
            />
            {message.state === "sending" ? "Sending…" : "On its way"}
          </span>
        )}
        <button
          type="button"
          className="agent-history-copy"
          onClick={() => void copyTextWithFeedback(message.text)}
          aria-label="Copy the message"
          title="Copy"
        >
          <Copy size={12} />
        </button>
      </div>
    </article>
  );
}

export type BubbleProps = {
  entry: HistoryEntry;
  sequence: number;
  highlighted: boolean;
  speech: ReturnType<typeof useChatSpeech>;
  onOpen: (entry: HistoryEntry) => void;
  imageUrl?: (path: string) => string;
  /** The images the message carried, loaded. */
  images?: readonly string[];
  from?: string | null;
  fromKind?: ChatRow["sender"]["kind"];
  continued?: boolean;
  matched?: "words" | "order" | null;
  decorate?: HistoryDecorator;
  decorationToken?: unknown;
};
// A history refresh hands over new entry objects even for messages that did
// not change: a bubble re-renders only when what it shows changed.
export function sameBubble(a: BubbleProps, b: BubbleProps): boolean {
  const x = a.entry;
  const y = b.entry;
  return (
    a.sequence === b.sequence &&
    a.highlighted === b.highlighted &&
    a.speech === b.speech &&
    a.onOpen === b.onOpen &&
    a.imageUrl === b.imageUrl &&
    a.images === b.images &&
    a.from === b.from &&
    a.fromKind === b.fromKind &&
    a.continued === b.continued &&
    a.matched === b.matched &&
    a.decorate === b.decorate &&
    a.decorationToken === b.decorationToken &&
    (x === y ||
      (x.id === y.id &&
        x.text === y.text &&
        x.role === y.role &&
        x.kind === y.kind &&
        x.sent_at === y.sent_at &&
        x.queued === y.queued &&
        x.compact_summary === y.compact_summary &&
        x.text_bytes === y.text_bytes &&
        x.text_hash === y.text_hash))
  );
}
