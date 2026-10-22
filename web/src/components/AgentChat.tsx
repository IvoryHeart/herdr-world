import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Copy,
  ListTree,
  RefreshCw,
  Send,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { bridge } from "../api";
import { copyTextWithFeedback } from "../copyText";
import type { Pane } from "../types";
import { formatUiDateTime } from "../uiLocale";
import { useConnectionClient } from "../useConnectionClient";
import { AgentHistoryDrawer } from "./AgentHistoryDrawer";
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
  status: "ok" | "unavailable";
  unavailable: {
    reason: string;
    detail: string;
    command?: string;
    issue?: string;
  } | null;
  messages: ConversationMessage[];
  latest: ConversationMessage | null;
};

type SendResult =
  | { status: "sent" }
  | { status: "refused"; reason: string; message: string };

const FOLLOW_THRESHOLD_PX = 48;

const ChatMessage = memo(function ChatMessage({
  message,
}: {
  message: ConversationMessage;
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
    <article className={`agent-chat-message ${tone}`} data-role={message.role}>
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
  const shownRef = useRef<Conversation | null>(null);

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
  // the conversation changed. Watch again after the connection comes back.
  useEffect(() => {
    if (!active || details) return;
    const paneId = pane.pane_id;
    const watch = () => {
      if (!connectionClient.isCurrent()) return;
      connectionClient
        .call("agent_conversation.watch", { pane_id: paneId })
        .catch(() => {});
    };
    watch();
    load();
    const stopControl = bridge.onControl((control) => {
      if (
        control.type === "agent_conversation_changed" &&
        control.connection_id === connectionClient.connectionId &&
        control.pane_id === paneId
      )
        load();
    });
    // onStatus reports the current status at once; only a later reconnect
    // needs a new watch.
    let current = true;
    const stopStatus = bridge.onStatus((status) => {
      if (current || status !== "connected") return;
      watch();
      load();
    });
    current = false;
    return () => {
      stopControl();
      stopStatus();
      if (connectionClient.isCurrent())
        connectionClient
          .call("agent_conversation.unwatch", { pane_id: paneId })
          .catch(() => {});
    };
  }, [active, connectionClient, details, load, pane.pane_id]);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && followRef.current) list.scrollTop = list.scrollHeight;
  }, [conversation]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending || !conversation?.session_fingerprint) return;
    setSending(true);
    setNotice("");
    try {
      const result = (await connectionClient.call("agent_conversation.send", {
        pane_id: pane.pane_id,
        text,
        session_fingerprint: conversation.session_fingerprint,
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
  }, [connectionClient, conversation, draft, load, pane.pane_id, sending]);

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
          }}
        >
          <div className="agent-chat-content">
            {conversation && conversation.messages.length === 0 ? (
              <p className="agent-chat-empty">No messages yet.</p>
            ) : null}
            {!conversation && !stale ? (
              <p className="agent-chat-empty">Loading conversation…</p>
            ) : null}
            {conversation?.messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
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
          <div className="agent-chat-composer-row">
            <textarea
              value={draft}
              rows={2}
              placeholder={`Message ${conversation?.agent ?? "agent"}`}
              aria-label="Message"
              onChange={(event) => setDraft(event.target.value)}
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
              disabled={sending || !draft.trim()}
              aria-label="Send"
              title="Send (Enter)"
            >
              <Send size={14} />
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
