import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ArrowDown,
  Copy,
  ListTree,
  Paperclip,
  RefreshCw,
  Send,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { watchConversation } from "../conversationWatch";
import {
  startAttachmentUploads,
  useAttachmentDelivery,
  useAttachmentUploads,
} from "../attachmentUploads";
import { terminalUploadedPathsText } from "../terminalFileDrop";
import {
  uploadTerminalFile,
  uploadTerminalImage,
} from "../terminalImageUpload";
import { copyTextWithFeedback } from "../copyText";
import type { Pane } from "../types";
import { formatUiDateTime } from "../uiLocale";
import { useConnectionClient } from "../useConnectionClient";
import { AgentHistoryDrawer } from "./AgentHistoryDrawer";
import { AttachmentChips } from "./AttachmentChips";
import { CodexSessionLink } from "./CodexSessionLink";
import { MarkdownPreview } from "./markdown";
import "./AgentChat.css";

// Mirrors the server's conversation read model (server/src/agent/conversation.ts).
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant" | "tool";
  kind: "message" | "error" | "activity" | "notice";
  text: string;
  sent_at: string;
  tools?: { name: string; calls: number }[];
  failed?: number;
};

export type Conversation = {
  conversation_version: 1;
  pane_id: string;
  agent: string | null;
  agent_status: string | null;
  session_binding: "reported" | "title" | "guessed" | null;
  session_fingerprint: string | null;
  session_label: string | null;
  status: "ok" | "unavailable";
  unavailable: {
    reason: string;
    detail: string;
    command?: string;
    issue?: string;
  } | null;
  messages: ConversationMessage[];
  latest: ConversationMessage | null;
  /**
   * Sends not yet seen in this conversation, sends with evidence they went
   * elsewhere, and sends Chat can no longer check.
   */
  deliveries?: ConversationDelivery[];
};

export type ConversationDelivery = {
  id: string;
  text: string;
  sent_at: string;
  state: "pending" | "matched" | "misdelivered" | "uncertain" | "unverified";
  expected: string;
  fingerprint: string;
  matched_id?: string;
  delivered_to?: string;
  evidence?: "herdr" | "transcript";
  detail?: string;
};

type SendResult =
  | { status: "sent" }
  | { status: "refused"; reason: string; message: string };

const FOLLOW_THRESHOLD_PX = 48;

const preview = (text: string) =>
  text.length > 80 ? `${text.slice(0, 79)}…` : text;

const ChatMessage = memo(function ChatMessage({
  message,
  matched = false,
}: {
  message: ConversationMessage;
  /** Has the same words as a message Chat sent: matched, not proven. */
  matched?: boolean;
}) {
  if (message.kind === "notice") {
    return (
      <div className="agent-chat-divider" role="separator">
        <span>{message.text}</span>
      </div>
    );
  }
  if (message.kind === "activity") {
    return (
      <div className="agent-chat-activity" data-role="tool">
        <Wrench size={12} aria-hidden />
        <span>{message.text}</span>
        {message.failed ? (
          <span className="agent-chat-activity-failed">
            {message.failed} failed
          </span>
        ) : null}
      </div>
    );
  }
  const tone = message.kind === "error" ? "is-error" : `is-${message.role}`;
  return (
    <article
      className={`agent-chat-message ${tone}`}
      data-role={message.role}
      data-delivery={matched ? "matched" : undefined}
    >
      <div className="agent-chat-bubble">
        {message.role === "user" ? (
          <p>{message.text}</p>
        ) : (
          <MarkdownPreview
            text={message.text}
            className="agent-chat-markdown"
            breaks
          />
        )}
      </div>
      <div className="agent-chat-meta">
        <time dateTime={message.sent_at} title={message.sent_at}>
          {formatUiDateTime(message.sent_at)}
        </time>
        {matched ? (
          <span title="Chat sent the same words just before this appeared; it cannot prove this is that message.">
            Sent from Chat; matched by its words
          </span>
        ) : null}
        <button
          type="button"
          className="agent-chat-copy"
          onClick={() => void copyTextWithFeedback(message.text)}
          aria-label="Copy message"
          title="Copy"
        >
          <Copy size={12} />
        </button>
      </div>
    </article>
  );
});

/**
 * Chat reads only the conversation read model and sends with Herdr's agent
 * prompt. While Chat shows a pane, the service watches it and pushes
 * `agent_conversation_changed`, so Chat has no timer. It never shows terminal
 * output: the Terminal tab stays a separate choice.
 */
export function AgentChat({
  pane,
  active,
  wide = false,
  onOpenTerminal,
  onClose,
}: {
  pane: Pane;
  active: boolean;
  wide?: boolean;
  onOpenTerminal?: () => void;
  onClose: () => void;
}) {
  const connectionClient = useConnectionClient();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // Set when the newest read failed; the last good conversation stays shown.
  const [stale, setStale] = useState("");
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [details, setDetails] = useState(false);
  const seqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  // Shown while the reader has scrolled up from the newest message.
  const [awayFromLatest, setAwayFromLatest] = useState(false);
  const shownRef = useRef<Conversation | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const uploadScope = `agent-chat\u0000${connectionClient.connectionId}\u0000${connectionClient.serverRuntimeGeneration}\u0000${pane.pane_id}`;
  const uploading = useAttachmentUploads(uploadScope).some(
    (upload) => upload.status === "uploading",
  );
  // Files upload through the pane's connection, as the terminal composer's
  // do. Each finished path joins the message of whichever Chat is open for
  // this pane, even if the one that started the upload has closed since.
  const attach = (files: File[]) => {
    if (!files.length) return;
    void startAttachmentUploads(uploadScope, files, async (file, onProgress) =>
      terminalUploadedPathsText([
        await (file.type.startsWith("image/")
          ? uploadTerminalImage
          : uploadTerminalFile)(connectionClient, file, onProgress),
      ]),
    );
  };
  useAttachmentDelivery(uploadScope, (text) =>
    setDraft((current) =>
      current && !/\s$/.test(current) ? `${current} ${text}` : current + text,
    ),
  );

  const load = useCallback(() => {
    if (!connectionClient.isCurrent()) return;
    const seq = ++seqRef.current;
    setLoading(true);
    connectionClient
      .call("agent_conversation.get", { pane_id: pane.pane_id })
      .then((result) => {
        if (seq !== seqRef.current || !connectionClient.isCurrent()) return;
        const reply = result as Partial<Conversation> | null;
        if (!reply || !Array.isArray(reply.messages))
          throw new Error("World sent an unreadable conversation.");
        const next = reply as Conversation;
        // A transcript caught mid-write must not replace what was readable.
        if (
          next.unavailable?.reason === "read_failed" &&
          shownRef.current?.status === "ok"
        ) {
          setStale(next.unavailable.detail);
          return;
        }
        shownRef.current = next;
        setConversation(next);
        setStale("");
      })
      .catch((reason: unknown) => {
        if (seq !== seqRef.current) return;
        setStale(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (seq === seqRef.current) setLoading(false);
      });
  }, [connectionClient, pane.pane_id]);

  // While visible, ask the service to watch this pane and reread when it says
  // the conversation changed, or after the connection comes back.
  useEffect(() => {
    if (!active || details) return;
    const stop = watchConversation(connectionClient, pane.pane_id, load);
    load();
    return stop;
  }, [active, connectionClient, details, load, pane.pane_id]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [conversation]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (
      !text ||
      sending ||
      uploading ||
      !conversation?.session_fingerprint ||
      conversation.deliveries?.some(
        (delivery) => delivery.state === "misdelivered",
      )
    )
      return;
    setSending(true);
    setNotice("");
    try {
      const result = (await connectionClient.call("agent_conversation.send", {
        pane_id: pane.pane_id,
        text,
        session_fingerprint: conversation.session_fingerprint,
        // What Chat showed: a send checks for the message after these.
        baseline: conversation.messages
          .filter((message) => message.role === "user")
          .map((message) => message.id),
      })) as SendResult;
      if (result.status === "sent") {
        setDraft("");
        followRef.current = true;
        load();
      } else {
        setNotice(result.message);
        if (result.reason === "changed") load();
      }
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSending(false);
    }
  }, [
    connectionClient,
    conversation,
    draft,
    load,
    pane.pane_id,
    sending,
    uploading,
  ]);

  const dismiss = useCallback(
    (deliveryId: string) => {
      connectionClient
        .call("agent_conversation.dismiss", {
          pane_id: pane.pane_id,
          delivery_id: deliveryId,
        })
        .then(load, load);
    },
    [connectionClient, load, pane.pane_id],
  );

  if (details) {
    return (
      <div className="agent-chat is-details">
        <div className="agent-chat-toolbar">
          <button type="button" onClick={() => setDetails(false)}>
            Back to chat
          </button>
        </div>
        <AgentHistoryDrawer
          pane={pane}
          open={active}
          embedded
          wide={wide}
          onOpenChange={(open) => {
            if (!open) onClose();
          }}
        />
      </div>
    );
  }

  const status = conversation?.agent_status ?? pane.agent_status;
  const unavailable = conversation?.unavailable;
  const deliveries = conversation?.deliveries ?? [];
  const pending = deliveries.filter(
    (delivery) =>
      delivery.state === "pending" &&
      delivery.fingerprint === conversation?.session_fingerprint,
  );
  const matchedIds = new Set(
    deliveries
      .filter(
        (delivery) =>
          delivery.state === "matched" &&
          delivery.fingerprint === conversation?.session_fingerprint,
      )
      .map((delivery) => delivery.matched_id),
  );
  // Sent to a session the pane has since left: still checked there.
  const elsewhere = deliveries.filter(
    (delivery) =>
      delivery.state === "pending" &&
      delivery.fingerprint !== conversation?.session_fingerprint,
  );
  const misdelivered = deliveries.filter(
    (delivery) => delivery.state === "misdelivered",
  );
  const unverified = deliveries.filter(
    (delivery) =>
      delivery.state === "unverified" || delivery.state === "uncertain",
  );
  const canSend =
    conversation?.status === "ok" && !!conversation.session_fingerprint;
  return (
    <div className="agent-chat">
      <div className="agent-chat-toolbar">
        <span className={`agent-chat-status is-${status.toLowerCase()}`}>
          {status}
        </span>
        <span className="agent-chat-toolbar-spacer" />
        <button
          type="button"
          onClick={load}
          disabled={loading}
          aria-label="Refresh conversation"
          title="Refresh"
        >
          <RefreshCw size={13} />
        </button>
        <button
          type="button"
          onClick={() => setDetails(true)}
          aria-label="Show session details"
          title="Timeline, tool output and export"
        >
          <ListTree size={13} /> Details
        </button>
      </div>
      {misdelivered.map((delivery) => (
        <div key={delivery.id} className="agent-chat-misdelivered" role="alert">
          {delivery.evidence === "herdr" ? (
            <>
              <strong>
                Your message may have gone to a different session.
              </strong>
              <span>
                Herdr had switched this pane to {delivery.delivered_to} when it
                took “{preview(delivery.text)}”, which you sent to{" "}
                {delivery.expected}. Check that session; Send is paused until
                you dismiss this.
              </span>
            </>
          ) : (
            <>
              <strong>
                Your message appears to have gone to a different session.
              </strong>
              <span>
                “{preview(delivery.text)}” was the first thing said in{" "}
                {delivery.delivered_to} right after you sent it to{" "}
                {delivery.expected}. Check that session; Send is paused until
                you dismiss this.
              </span>
            </>
          )}
          <button type="button" onClick={() => dismiss(delivery.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {unverified.map((delivery) => (
        <div
          key={delivery.id}
          className="agent-chat-misdelivered is-unverified"
          role="status"
        >
          <strong>
            {delivery.state === "uncertain"
              ? "Chat cannot tell where this went."
              : "Chat can no longer check this."}
          </strong>
          <span>
            You sent “{preview(delivery.text)}” to {delivery.expected}.{" "}
            {delivery.detail} Look in the Terminal to see where it went.
          </span>
          <button type="button" onClick={() => dismiss(delivery.id)}>
            Dismiss
          </button>
        </div>
      ))}
      {elsewhere.map((delivery) => (
        <p
          key={delivery.id}
          className="agent-chat-elsewhere"
          role="status"
          data-delivery="elsewhere"
        >
          Still checking {delivery.expected} for “{preview(delivery.text)}”,
          sent before this pane moved on.{" "}
          <button
            type="button"
            className="agent-chat-pending-dismiss"
            onClick={() => dismiss(delivery.id)}
          >
            Stop checking
          </button>
        </p>
      ))}
      {stale ? (
        <p className="agent-chat-stale" role="status">
          Could not refresh, so this is the last conversation read. {stale}
        </p>
      ) : null}
      {unavailable ? (
        <div className="agent-chat-unavailable" role="status">
          <strong>Conversation unavailable</strong>
          <span>{unavailable.detail}</span>
          {unavailable.command ? (
            <span className="agent-chat-command">
              <code>{unavailable.command}</code>
              <button
                type="button"
                onClick={() => void copyTextWithFeedback(unavailable.command!)}
              >
                <Copy size={13} /> Copy command
              </button>
            </span>
          ) : null}
          {unavailable.reason === "codex_unlinked" ? (
            <div className="agent-chat-link">
              <CodexSessionLink
                paneId={pane.pane_id}
                client={connectionClient}
                onLinked={load}
              />
            </div>
          ) : null}
          <span className="agent-chat-actions">
            <button type="button" onClick={load} disabled={loading}>
              <RefreshCw size={13} /> Refresh
            </button>
            {onOpenTerminal ? (
              <button type="button" onClick={onOpenTerminal}>
                <SquareTerminal size={13} /> Open Terminal
              </button>
            ) : null}
          </span>
          {unavailable.issue ? (
            <a href={unavailable.issue} target="_blank" rel="noreferrer">
              Known issue
            </a>
          ) : null}
        </div>
      ) : (
        <div
          ref={listRef}
          className="agent-chat-list"
          onScroll={(event) => {
            const list = event.currentTarget;
            if (list.clientHeight === 0) return;
            followRef.current =
              list.scrollHeight - list.scrollTop - list.clientHeight <
              FOLLOW_THRESHOLD_PX;
            setAwayFromLatest(!followRef.current);
          }}
        >
          {awayFromLatest ? (
            <button
              type="button"
              className="agent-chat-jump"
              onClick={() => {
                const list = listRef.current;
                followRef.current = true;
                setAwayFromLatest(false);
                list?.scrollTo({ top: list.scrollHeight });
              }}
            >
              <ArrowDown size={13} aria-hidden="true" /> Jump to latest
            </button>
          ) : null}
          <div className="agent-chat-content">
            {conversation && conversation.messages.length === 0 ? (
              <p className="agent-chat-empty">No messages yet.</p>
            ) : null}
            {!conversation && !stale ? (
              <p className="agent-chat-empty">Loading conversation…</p>
            ) : null}
            {conversation?.messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                matched={matchedIds.has(message.id)}
              />
            ))}
            {pending.map((delivery) => (
              <article
                key={delivery.id}
                className="agent-chat-message is-user is-pending"
                data-role="user"
                data-delivery="pending"
              >
                <div className="agent-chat-bubble">
                  <p>{delivery.text}</p>
                </div>
                <div className="agent-chat-meta">
                  Sent; not yet seen in this conversation{" "}
                  <button
                    type="button"
                    className="agent-chat-pending-dismiss"
                    onClick={() => dismiss(delivery.id)}
                  >
                    Stop checking
                  </button>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {conversation?.status === "ok" && !canSend ? (
        <div className="agent-chat-guessed" role="status">
          <span>
            {conversation.session_binding === "title"
              ? "The Codex title does not name one saved thread yet, so Chat cannot tell where a message would go. Send the first message from the Terminal; Chat can reply once Codex saves the thread."
              : "World found this conversation in the pane's folder; Herdr has not tied it to this pane, so Chat cannot send to it."}
          </span>
          {onOpenTerminal ? (
            <button type="button" onClick={onOpenTerminal}>
              <SquareTerminal size={13} /> Open Terminal
            </button>
          ) : null}
        </div>
      ) : null}
      {canSend ? (
        <form
          className="agent-chat-composer"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {notice ? (
            <p className="agent-chat-notice" role="alert">
              {notice}
            </p>
          ) : null}
          <AttachmentChips scope={uploadScope} />
          <div className="agent-chat-composer-row">
            <button
              type="button"
              className="agent-chat-attach"
              aria-label="Attach files"
              title="Attach files"
              onClick={() => filePicker.current?.click()}
            >
              <Paperclip size={14} />
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
                attach(files);
              }}
            />
            <textarea
              value={draft}
              rows={2}
              placeholder={`Message ${conversation?.agent ?? "agent"}`}
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
              onPaste={(event) => {
                const files = Array.from(event.clipboardData.files);
                if (!files.length) return;
                event.preventDefault();
                attach(files);
              }}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <button
              type="submit"
              disabled={
                sending || uploading || !draft.trim() || misdelivered.length > 0
              }
              aria-label="Send"
              title={
                misdelivered.length > 0
                  ? "Dismiss the notice about the other session first"
                  : uploading
                    ? "Waiting for uploads"
                    : "Send (Enter)"
              }
            >
              <Send size={14} />
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
