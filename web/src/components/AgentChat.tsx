import "./AgentChat.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, ListTree, RefreshCw, SquareTerminal } from "lucide-react";
import { watchConversation } from "../conversationWatch";
import { type ChatFocusIntent, useChatFocusIntent } from "../chatFocus";
import { attachmentUploading } from "../attachmentUploads";
import {
  beginTerminalComposerSubmission,
  finishTerminalComposerSubmission,
  terminalComposerUploadCount,
} from "../terminalComposer";
import { ChatComposer, chatComposerDraftKey } from "./chat/ChatComposer";
import { copyTextWithFeedback } from "../copyText";
import type { Pane } from "../types";
import { useConnectionClient } from "../useConnectionClient";
import { AgentHistoryDrawer } from "./AgentHistoryDrawer";
import { AgentHistoryChat } from "./AgentHistoryChat";
import { AgentMessageDialog } from "./AgentMessageDialog";
import type { HistoryEntry } from "./agentHistory";
import { groupHistoryChatItems } from "./agentHistoryView";
import { useAgentHistoryWindow } from "./useAgentHistoryWindow";
import { matchedTurns, placedSends } from "./chat/pendingSends";
import { CodexSessionLink } from "./CodexSessionLink";
import { QuestLog } from "./QuestLog";
import { useStepEvidence } from "./chat/useStepEvidence";
import { useChatBlocks } from "./chat/useChatBlocks";
import { ChatAfterBlocks, decorateChat } from "./chat/blocks/registry";
import type { WorkItem } from "../../../shared/worldSources";
import {
  DOUBLE_ESCAPE_MS,
  elapsed,
  STOPS_WITH_ESCAPE,
  titleTask,
} from "./chat/blocks/now";
import type {
  AnswerResult,
  Conversation,
  SendResult,
  UnconfirmedReason,
} from "./chat/types";
import "./chat/blocks/now.css";
import { ChatStatusBadge } from "./chat/blocks/status-badge";

export type {
  Conversation,
  ConversationDelivery,
  ConversationMessage,
  PendingPrompt,
} from "./chat/types";

const preview = (text: string) =>
  text.length > 80 ? `${text.slice(0, 79)}…` : text;

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
  workSessionFingerprint,
  recipientLabel,
  focusIntent,
}: {
  pane: Pane;
  active: boolean;
  wide?: boolean;
  onOpenTerminal?: () => void;
  onClose: () => void;
  workSessionFingerprint?: string;
  recipientLabel?: string;
  focusIntent?: ChatFocusIntent | null;
}) {
  const localFocusIntent = useChatFocusIntent(
    active && focusIntent === undefined,
  );
  const connectionClient = useConnectionClient();
  const [conversation, setConversation] = useState<Conversation | null>(null);
  // Set when the newest read failed; the last good conversation stays shown.
  const [stale, setStale] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [details, setDetails] = useState(false);
  const seqRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const shownRef = useRef<Conversation | null>(null);
  // Chat's status, session and receipts come from the conversation summary
  // (agent_conversation.latest, without messages); the messages themselves
  // are History's window below, so a long, busy transcript is never re-read
  // or re-rendered whole. A burst of change pushes runs at most one more read.
  const inFlightRef = useRef(false);
  const againRef = useRef(false);
  const load = useCallback(() => {
    if (!connectionClient.isCurrent()) return;
    if (inFlightRef.current) {
      againRef.current = true;
      return;
    }
    inFlightRef.current = true;
    const seq = ++seqRef.current;
    setLoading(true);
    connectionClient
      .call("agent_conversation.latest", { pane_id: pane.pane_id })
      .then((result) => {
        if (seq !== seqRef.current || !connectionClient.isCurrent()) return;
        const reply = result as Partial<Conversation> | null;
        if (!reply || (reply.status !== "ok" && reply.status !== "unavailable"))
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
        inFlightRef.current = false;
        if (seq === seqRef.current) setLoading(false);
        if (againRef.current) {
          againRef.current = false;
          loadRef.current();
        }
      });
  }, [connectionClient, pane.pane_id]);
  const loadRef = useRef(load);
  loadRef.current = load;
  const history = useAgentHistoryWindow({
    pane,
    client: connectionClient,
    active: active && !details,
  });
  const refreshHistory = history.refresh;
  const [expanded, setExpanded] = useState<HistoryEntry | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const chatItems = useMemo(
    () => groupHistoryChatItems(history.messages),
    [history.messages],
  );
  const stepEvidence = useStepEvidence({
    client: connectionClient,
    paneId: pane.pane_id,
    sessionFingerprint: conversation?.session_fingerprint ?? null,
    entries: history.messages,
    enabled: active && !details,
  });

  // While visible, ask the service to watch this pane and reread when it says
  // the conversation changed, or after the connection comes back.
  useEffect(() => {
    if (!active || details) return;
    const stop = watchConversation(connectionClient, pane.pane_id, () => {
      load();
      refreshHistory();
    });
    load();
    return stop;
  }, [active, connectionClient, details, load, pane.pane_id, refreshHistory]);

  const send = useCallback(
    async (value: string) => {
      const text = value.trim();
      if (!text) throw new Error("Write a message first.");
      if (!connectionClient.isCurrent() || !conversation?.session_fingerprint)
        throw new Error(
          "The conversation changed. Nothing was sent; check it before sending again.",
        );
      if (
        conversation.deliveries?.some(
          (delivery) => delivery.state === "misdelivered",
        )
      )
        throw new Error(
          "Read and dismiss the session-switch notice before sending.",
        );
      setNotice("");
      const result = (await connectionClient.call("agent_conversation.send", {
        pane_id: pane.pane_id,
        text,
        session_fingerprint: conversation.session_fingerprint,
        baseline: history.messages
          .filter((message) => message.role === "user")
          .map((message) => message.id),
      })) as SendResult;
      if (result.status !== "sent") {
        if (result.reason === "changed") load();
        throw new Error(result.message);
      }
      load();
      refreshHistory();
    },
    [
      connectionClient,
      conversation,
      history.messages,
      load,
      pane.pane_id,
      refreshHistory,
    ],
  );

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

  const draftKey = chatComposerDraftKey(
    connectionClient,
    pane,
    conversation?.session_fingerprint,
  );
  const sendRef = useRef({ send, draftKey });
  sendRef.current = { send, draftKey };
  const askAuthor = useCallback((item: WorkItem) => {
    const current = sendRef.current;
    if (
      terminalComposerUploadCount(current.draftKey) ||
      attachmentUploading(current.draftKey)
    ) {
      setNotice("Wait for the uploads before sending.");
      return;
    }
    if (!beginTerminalComposerSubmission(current.draftKey)) return;
    void current
      .send(`↳ #${item.number} Please fix the findings on this pull request.`)
      .catch((reason: unknown) =>
        setNotice(reason instanceof Error ? reason.message : String(reason)),
      )
      .finally(() => finishTerminalComposerSubmission(current.draftKey));
  }, []);
  const decorationTokens = useChatBlocks({
    entries: history.messages,
    steps: stepEvidence,
    owner: {
      connectionId: connectionClient.connectionId,
      generation: connectionClient.serverRuntimeGeneration,
      paneId: pane.pane_id,
      sessionFingerprint: workSessionFingerprint,
      label: pane.agent_name ?? pane.agent ?? "the agent",
    },
    onAskAuthor:
      conversation?.status === "ok" && conversation.session_fingerprint
        ? askAuthor
        : undefined,
  });

  // The agent's question: answered by pressing one option's key in its pane,
  // only when the user picks it. The service checks the agent still shows
  // this same question just before the key goes.
  const prompt = conversation?.pending_prompt ?? null;
  const [answering, setAnswering] = useState(false);
  // The answer sent for a question, shown in its place until another
  // question appears.
  const [answered, setAnswered] = useState<{
    fingerprint: string;
    question: string[];
    number: string;
    label: string;
    acknowledged: boolean;
    unconfirmed_reason: UnconfirmedReason | null;
  } | null>(null);
  const [askNotice, setAskNotice] = useState("");
  const answer = useCallback(
    async (key: string) => {
      if (!prompt || answering) return;
      setAnswering(true);
      setAskNotice("");
      try {
        const result = (await connectionClient.call(
          "agent_conversation.answer",
          {
            pane_id: pane.pane_id,
            key,
            prompt_fingerprint: prompt.fingerprint,
          },
        )) as AnswerResult;
        if (result.status === "sent")
          setAnswered({
            fingerprint: result.prompt_fingerprint,
            question: prompt.question,
            number: result.number,
            label: result.label,
            acknowledged: result.acknowledged,
            unconfirmed_reason: result.unconfirmed_reason,
          });
        else setAskNotice(result.message);
      } catch (reason) {
        setAskNotice(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setAnswering(false);
        load();
      }
    },
    [answering, connectionClient, load, pane.pane_id, prompt],
  );
  // A different question replaces the last answer's receipt.
  const showAsk =
    prompt !== null && prompt.fingerprint !== answered?.fingerprint;
  useEffect(() => {
    if (prompt && prompt.fingerprint !== answered?.fingerprint) {
      setAskNotice("");
      setAnswered(null);
    }
    // Only a new question resets the receipt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prompt?.fingerprint]);
  // The Now bar: Herdr's status (newer than the last read), the task in the
  // terminal title, and time since this view saw the status change. A
  // display clock ticks only while something is running; nothing is polled.
  const liveStatus = pane.agent_status || conversation?.agent_status || "";
  const [statusSince, setStatusSince] = useState<number | null>(null);
  const seenStatus = useRef(liveStatus);
  useEffect(() => {
    if (seenStatus.current === liveStatus) return;
    seenStatus.current = liveStatus;
    setStatusSince(Date.now());
  }, [liveStatus]);
  // An open call is running only while Herdr says the agent works: a call
  // waiting for approval, or one cut off by an interrupt or crash, is not.
  const running =
    liveStatus === "working" ? (conversation?.running_tool ?? null) : null;
  const ticking = liveStatus === "working";
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [ticking]);
  // Stop presses Esc in the agent's pane, only when the user asks: the Stop
  // button, or Esc twice while Chat has focus.
  const agentName = conversation?.agent ?? pane.agent ?? "";
  const canStop = liveStatus === "working" && STOPS_WITH_ESCAPE.has(agentName);
  const [stopNote, setStopNote] = useState("");
  const stop = useCallback(async () => {
    try {
      await connectionClient.call("pane.send_input", {
        pane_id: pane.pane_id,
        text: "",
        keys: ["escape"],
      });
      setStopNote(`Pressed Esc in ${agentName || "the agent"}'s terminal.`);
    } catch (reason) {
      setStopNote(reason instanceof Error ? reason.message : String(reason));
    }
  }, [agentName, connectionClient, pane.pane_id]);
  const firstEscape = useRef(0);
  useEffect(() => {
    if (!canStop) return;
    let expire = 0;
    const keydown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        !(event.target instanceof HTMLElement) ||
        !event.target.closest(".agent-chat")
      )
        return;
      const now = Date.now();
      window.clearTimeout(expire);
      if (now - firstEscape.current < DOUBLE_ESCAPE_MS) {
        firstEscape.current = 0;
        void stop();
      } else {
        firstEscape.current = now;
        const note = `Press Esc again to stop ${agentName || "the agent"}.`;
        setStopNote(note);
        // The note holds only while a second Esc would stop.
        expire = window.setTimeout(
          () => setStopNote((current) => (current === note ? "" : current)),
          DOUBLE_ESCAPE_MS,
        );
      }
    };
    window.addEventListener("keydown", keydown);
    return () => {
      window.clearTimeout(expire);
      window.removeEventListener("keydown", keydown);
    };
  }, [agentName, canStop, stop]);
  // A new turn clears the last stop note.
  useEffect(() => {
    if (liveStatus !== "working") setStopNote("");
  }, [liveStatus]);

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

  const unavailable = conversation?.unavailable;
  const deliveries = conversation?.deliveries ?? [];
  const pending = deliveries.filter(
    (delivery) =>
      delivery.kind !== "command" &&
      (delivery.state === "pending" || delivery.state === "unverified") &&
      delivery.fingerprint === conversation?.session_fingerprint,
  );
  const commands = deliveries.filter(
    (delivery) => delivery.kind === "command" && delivery.state !== "matched",
  );
  const matched = matchedTurns(deliveries, conversation?.session_fingerprint);
  // Sent to a session the pane has since left: still checked there.
  const elsewhere = deliveries.filter(
    (delivery) =>
      delivery.kind !== "command" &&
      delivery.state === "pending" &&
      delivery.fingerprint !== conversation?.session_fingerprint,
  );
  const misdelivered = deliveries.filter(
    (delivery) =>
      delivery.kind !== "command" && delivery.state === "misdelivered",
  );
  const unverified = deliveries.filter(
    (delivery) =>
      delivery.kind !== "command" &&
      (delivery.state === "uncertain" ||
        (delivery.state === "unverified" &&
          delivery.fingerprint !== conversation?.session_fingerprint)),
  );
  const canSend =
    conversation?.status === "ok" && !!conversation.session_fingerprint;
  return (
    <div className="agent-chat">
      <div className="agent-chat-toolbar agent-chat-now">
        {/* Only the status and task are announced; the clocks are not. */}
        <span className="agent-chat-now-live" aria-live="polite">
          <ChatStatusBadge status={liveStatus} />
          <span
            className="agent-chat-now-title"
            title={conversation?.terminal_title ?? ""}
          >
            {titleTask(conversation?.terminal_title)}
          </span>
        </span>
        {stopNote ? (
          <span className="agent-chat-now-note" role="status" title={stopNote}>
            {stopNote}
          </span>
        ) : null}
        {statusSince !== null && ticking ? (
          <span className="agent-chat-now-time" aria-hidden="true">
            {elapsed(clock - statusSince)}
          </span>
        ) : null}
        {canStop ? (
          <button
            type="button"
            className="agent-chat-stop"
            title={
              // A touch screen has no Esc key to point to.
              window.matchMedia?.("(pointer: coarse)").matches
                ? "Interrupt this turn in the agent's terminal"
                : "Press Esc in the agent's terminal to interrupt this turn (or press Esc twice)"
            }
            onClick={() => void stop()}
          >
            ■ Stop <kbd>Esc</kbd>
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => {
            load();
            refreshHistory();
          }}
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
      {/* History's read failed: keep its last good window, if any, and say
          so; Refresh retries it. */}
      {!stale && !unavailable && history.error ? (
        <p className="agent-chat-stale" role="status">
          {history.history
            ? `Could not refresh the messages, so these are the last read. ${history.error}`
            : `Could not read the messages. ${history.error}`}
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
        <div className="agent-chat-list">
          {history.messages.length === 0 ? (
            <p className="agent-chat-empty">
              {history.history
                ? "No messages yet."
                : history.error
                  ? "Messages could not be read. Use Refresh to try again."
                  : "Loading conversation…"}
            </p>
          ) : null}
          <AgentHistoryChat
            items={chatItems}
            listRef={listRef}
            contentRef={contentRef}
            followKey={JSON.stringify([
              connectionClient.connectionId,
              connectionClient.serverRuntimeGeneration,
              pane.pane_id,
              conversation?.session_fingerprint,
            ])}
            countNewAgentMessages
            toolLoading={history.toolEntryLoading}
            onLoadTool={history.loadToolEntry}
            placed={[
              ...(conversation?.quest
                ? [
                    {
                      key: `quest:${conversation.session_fingerprint}:${conversation.quest.started_at}`,
                      at: conversation.quest.started_at,
                      node: (
                        <QuestLog
                          key={`${conversation.session_fingerprint}:${conversation.quest.started_at}`}
                          quest={conversation.quest}
                          compact
                        />
                      ),
                    },
                  ]
                : []),
              ...placedSends(
                [...pending, ...commands],
                recipientLabel ??
                  conversation?.agent ??
                  pane.agent ??
                  "the agent",
                dismiss,
              ),
            ]}
            hasOlder={history.hasOlder}
            olderLoading={history.olderLoading}
            onLoadOlder={history.loadOlder}
            onAtLatest={history.dropOlder}
            onOpen={setExpanded}
            matchedIds={matched}
            decorate={decorateChat}
            decorationTokens={decorationTokens}
            after={
              <ChatAfterBlocks
                running={running}
                clock={clock}
                answered={answered}
                prompt={showAsk ? prompt : null}
                agent={conversation?.agent ?? "The agent"}
                answering={answering}
                notice={askNotice}
                onAnswer={(key) => void answer(key)}
                onOpenTerminal={onOpenTerminal}
              />
            }
          />
          <AgentMessageDialog
            message={expanded}
            onClose={() => setExpanded(null)}
          />
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
        <ChatComposer
          active={active}
          focusIntent={
            focusIntent === undefined ? localFocusIntent : focusIntent
          }
          client={connectionClient}
          pane={pane}
          fingerprint={conversation?.session_fingerprint ?? ""}
          recipient={
            recipientLabel ?? conversation?.agent ?? pane.agent ?? "agent"
          }
          notice={notice}
          disabledReason={
            misdelivered.length
              ? "Read and dismiss the session-switch notice before sending."
              : undefined
          }
          onSubmit={send}
          onError={setNotice}
        />
      ) : null}
    </div>
  );
}
