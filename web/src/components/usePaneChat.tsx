import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Check, Square, SquareCheck, SquareTerminal } from "lucide-react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import type { AgentActivity, AgentPrompt } from "../agentPrompt";
import type { AgentCommand } from "../claudeCommands";
import { useOperationalStore } from "../store";
import { connectionClientScopeKey } from "../useConnectionClient";
import {
  readTerminalComposerDraft,
  TerminalComposerSubmitKeyError,
  terminalComposerDraftKey,
} from "../terminalComposer";
import { sendTerminalComposerText } from "../terminalComposerSend";
import { uploadTerminalImage } from "../terminalImageUpload";
import { AgentHistoryComposer } from "./AgentHistoryComposer";
import { agentPromptWarning } from "./agentSession";
import type {
  AgentHistory,
  HistoryEntry as AgentHistoryEntry,
} from "./agentHistory";
import {
  newOutboxMessage,
  nextOutboxDeadline,
  type OutboxMessage,
  readOutbox,
  settleOutbox,
  subscribeOutbox,
  updateOutbox,
} from "./chatOutbox";
import { promptKeyInput } from "./promptKeys";
import { ConfirmDialog } from "./ModalDialogs";
export type PaneChatOptions = {
  prompt?: AgentPrompt | null;
  activity?: AgentActivity | null;
  active?: boolean;
  onShowTerminal(): void;
  onKeys(text: string): void;
  composerTarget?: HTMLElement | null;
};
const PROMPT_KEYS: [string, string, string][] = [
  ["←", "\x1b[D", "Left: previous question"],
  ["↑", "\x1b[A", "Up"],
  ["↓", "\x1b[B", "Down"],
  ["→", "\x1b[C", "Right: next question"],
  ["Tab", "\t", "Tab"],
  ["Enter", "\r", "Enter: confirm"],
  ["Esc", "\x1b", "Escape: cancel"],
];
export function usePaneChat({
  paneChat,
  pane,
  open,
  connectionClient,
  activeConnectionId,
  connectionGeneration,
  loadHistory,
  history,
  drawerRef,
  agentCommands,
  mobile,
}: {
  paneChat?: PaneChatOptions;
  pane: Pane;
  open: boolean;
  connectionClient: ConnectionClient;
  activeConnectionId: string;
  connectionGeneration: number;
  loadHistory(): void;
  history: AgentHistory | null;
  drawerRef: RefObject<HTMLElement | null>;
  agentCommands: AgentCommand[];
  mobile: boolean;
}) {
  const store = useOperationalStore();
  const scope = connectionClientScopeKey(
    connectionClient,
    pane.pane_id,
    pane.terminal_id,
    pane.agent,
  );
  const pollScopeRef = useRef(scope);
  const sentRefreshTimerRef = useRef<number | null>(null);
  useEffect(() => {
    pollScopeRef.current = open ? scope : "";
    return () => {
      pollScopeRef.current = "";
      if (sentRefreshTimerRef.current !== null)
        window.clearTimeout(sentRefreshTimerRef.current);
    };
  }, [scope, open]);
  const sendMessage = useCallback(
    async (text: string) => {
      if (
        !open ||
        pollScopeRef.current !== scope ||
        !connectionClient.isCurrent()
      )
        throw new Error(
          "The terminal connection changed. Reopen Chat to send.",
        );
      const admittedScope = pollScopeRef.current;
      // Writing a question's own answer ("Type something.") where Enter would
      // tick the box off again: the text alone.
      const answering = paneChat?.prompt?.options.find(
        (option) => option.cursor && option.freeText,
      );
      await sendTerminalComposerText(
        connectionClient,
        { paneId: pane.pane_id, agent: pane.agent },
        text,
        answering?.checked === undefined,
      );
      if (
        !connectionClient.isCurrent() ||
        pollScopeRef.current !== admittedScope
      )
        return;
      // The agent records the prompt in its transcript once it accepts it;
      // refresh shortly instead of waiting for the next poll. A poll still in
      // flight may predate the prompt, so wait for it and load again.
      const refresh = (delay: number) => {
        if (sentRefreshTimerRef.current !== null)
          window.clearTimeout(sentRefreshTimerRef.current);
        sentRefreshTimerRef.current = window.setTimeout(() => {
          sentRefreshTimerRef.current = null;
          loadHistory();
        }, delay);
      };
      refresh(1000);
    },
    [
      connectionClient,
      loadHistory,
      pane.agent,
      pane.pane_id,
      paneChat?.prompt,
      scope,
      open,
    ],
  );
  // Messages sent from the box that the transcript does not show yet
  // (chatOutbox): shown on their way, then replaced by their entries. Kept
  // per pane outside this chat, which a switch to the terminal unmounts.
  const outboxKey = JSON.stringify([
    pane.terminal_id,
    terminalComposerDraftKey(
      activeConnectionId,
      connectionGeneration,
      pane.pane_id,
    ),
  ]);
  const paneOutbox = useSyncExternalStore(subscribeOutbox, () =>
    readOutbox(outboxKey),
  );
  const historyMessagesRef = useRef(history?.messages ?? []);
  historyMessagesRef.current = history?.messages ?? [];
  const settlePaneOutbox = useCallback(
    (entries: readonly AgentHistoryEntry[]) =>
      updateOutbox(outboxKey, (current) =>
        settleOutbox(current, entries, Date.now()),
      ),
    [outboxKey],
  );
  useEffect(() => {
    // Not before the history is read: a message would time out against an
    // empty one.
    if (history) settlePaneOutbox(history.messages);
  }, [history, settlePaneOutbox]);
  useEffect(() => {
    const deadline = nextOutboxDeadline(paneOutbox);
    if (deadline === null) return;
    const timer = window.setTimeout(
      () => settlePaneOutbox(historyMessagesRef.current),
      Math.max(0, deadline - Date.now()) + 50,
    );
    return () => window.clearTimeout(timer);
  }, [paneOutbox, settlePaneOutbox]);
  const sendFromBox = useCallback(
    async (text: string, replacing?: string) => {
      // An answer typed into a question, a /command or a ! shell line is
      // not recorded as the user's message: those are sent as before.
      const answering = paneChat?.prompt?.options.some(
        (option) => option.cursor && option.freeText,
      );
      if (answering || /^\s*[/!]/.test(text)) {
        await sendMessage(text);
        return;
      }
      // The pane's outbox at the time of sending, whatever this chat shows
      // by the time the send settles.
      const key = outboxKey;
      const message = newOutboxMessage(
        pane.pane_id,
        text,
        historyMessagesRef.current,
        Date.now(),
      );
      const update = (patch: Partial<OutboxMessage>) =>
        updateOutbox(key, (current) =>
          current.map((each) =>
            each.id === message.id ? { ...each, ...patch } : each,
          ),
        );
      updateOutbox(key, (current) => [
        ...current.filter((each) => each.id !== replacing),
        message,
      ]);
      try {
        await sendMessage(text);
        update({ state: "sent", sentAtMs: Date.now() });
      } catch (error) {
        if (error instanceof TerminalComposerSubmitKeyError) {
          // The text is in the terminal: kept as sent, never sent again.
          update({ state: "sent", sentAtMs: Date.now() });
          throw error;
        }
        // Kept in the chat, marked, rather than put back in the box.
        update({
          state: "failed",
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [outboxKey, pane.pane_id, paneChat?.prompt, sendMessage],
  );
  const retryContext = JSON.stringify([
    outboxKey,
    pane.agent,
    pane.agent_status,
    pane.state_change_seq,
    open,
  ]);
  const [retryConfirmation, setRetryConfirmation] = useState<{
    message: OutboxMessage;
    context: string;
  } | null>(null);
  useEffect(() => {
    if (retryConfirmation?.context !== retryContext) setRetryConfirmation(null);
  }, [retryConfirmation, retryContext]);
  const notifyComposerError = useCallback(
    (detail: string) => {
      store.notify({ kind: "error", message: "Message input failed", detail });
    },
    [store],
  );
  const resendMessage = useCallback(
    (message: OutboxMessage) => {
      void sendFromBox(message.text, message.id).catch((error) =>
        notifyComposerError(
          error instanceof Error ? error.message : String(error),
        ),
      );
    },
    [notifyComposerError, sendFromBox],
  );
  const retryWarning = agentPromptWarning(pane.agent, pane.agent_status);
  const retrySend = useCallback(
    (message: OutboxMessage) => {
      if (retryWarning)
        setRetryConfirmation({ message, context: retryContext });
      else resendMessage(message);
    },
    [retryWarning, retryContext, resendMessage],
  );
  const discardSend = useCallback(
    (message: OutboxMessage) =>
      updateOutbox(outboxKey, (current) =>
        current.filter((each) => each.id !== message.id),
      ),
    [outboxKey],
  );
  const composerDraftKey = terminalComposerDraftKey(
    activeConnectionId,
    connectionGeneration,
    pane.pane_id,
  );
  const historyComposer = (
    <AgentHistoryComposer
      // A pane or connection switch must never render, or send, the
      // previous draft before the new one loads.
      key={composerDraftKey}
      draftKey={composerDraftKey}
      agent={pane.agent}
      status={pane.agent_status}
      stateSeq={pane.state_change_seq}
      onSend={sendFromBox}
      onUploadImage={(file) => uploadTerminalImage(connectionClient, file)}
      commands={agentCommands}
      onError={notifyComposerError}
    />
  );
  // An agent's question takes the keys in its card, as in the terminal.
  const paneActive = paneChat?.active !== false;
  const promptRef = useRef<HTMLDivElement | null>(null);
  // Blocked, or a menu on its screen though it still counts as working.
  const promptShown =
    !!paneChat &&
    (pane.agent_status.toLowerCase() === "blocked" ||
      !!paneChat.prompt?.confirm ||
      !!paneChat.prompt?.tabs);
  const promptTyping = !!paneChat?.prompt?.options.some(
    (option) => option.cursor && option.freeText,
  );
  const focusChatBox = useCallback(() => {
    (paneChat?.composerTarget ?? drawerRef.current)
      ?.querySelector<HTMLElement>(
        ".agent-history-composer :is(textarea, [contenteditable='true'])",
      )
      ?.focus({ preventScroll: true });
  }, [paneChat?.composerTarget, drawerRef]);
  const onPromptKey = (
    event: Pick<
      ReactKeyboardEvent<HTMLDivElement>,
      | "key"
      | "shiftKey"
      | "ctrlKey"
      | "metaKey"
      | "altKey"
      | "preventDefault"
      | "stopPropagation"
    > & { nativeEvent: KeyboardEvent },
  ) => {
    if (!paneChat || event.nativeEvent.isComposing) return;
    const input = promptKeyInput(event, promptTyping);
    if (input === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (input === "box") focusChatBox();
    else paneChat.onKeys(input);
  };
  // The message box is hidden while a question only takes a choice; an
  // answer of one's own ("Type something.") is written in it.
  const boxHidden = promptShown && !promptTyping;
  // A question takes the keys when it comes, unless the user is writing; the
  // box gets them for an answer of one's own, and back when it goes.
  const promptWas = useRef<"none" | "choice" | "typing">("none");
  useEffect(() => {
    const now = !promptShown ? "none" : promptTyping ? "typing" : "choice";
    const was = promptWas.current;
    promptWas.current = now;
    if (now === was || !paneActive) return;
    const active = document.activeElement;
    const idle =
      !active ||
      active === document.body ||
      !!active.closest(".agent-history-composer, .agent-chat-prompt");
    if (now === "typing") {
      if (idle) requestAnimationFrame(focusChatBox);
    } else if (now === "choice") {
      if (
        idle &&
        (was === "typing" ||
          !readTerminalComposerDraft(composerDraftKey).trim())
      )
        requestAnimationFrame(() =>
          promptRef.current?.focus({ preventScroll: true }),
        );
    } else if (!active || active === document.body)
      requestAnimationFrame(focusChatBox);
  }, [promptShown, promptTyping, composerDraftKey, focusChatBox, paneActive]);
  // With nothing focused (the hidden box had the keys, say), they still go
  // to the question.
  const onPromptKeyRef = useRef(onPromptKey);
  onPromptKeyRef.current = onPromptKey;
  useEffect(() => {
    if (!promptShown || !paneActive) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.target !== document.body) return;
      promptRef.current?.focus({ preventScroll: true });
      onPromptKeyRef.current({
        key: event.key,
        shiftKey: event.shiftKey,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        nativeEvent: event,
        preventDefault: () => event.preventDefault(),
        stopPropagation: () => event.stopPropagation(),
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [promptShown, paneActive]);
  // Tab from an empty message box goes to the question. The box is a
  // child of the bottom bar on a phone, so this is caught on the drawer
  // (events come up through the portal), with no element around the box.
  const onComposerKeyCapture = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (
      event.key !== "Tab" ||
      event.shiftKey ||
      !promptShown ||
      !(event.target as HTMLElement).closest?.(".agent-history-composer") ||
      readTerminalComposerDraft(composerDraftKey).trim()
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    promptRef.current?.focus({ preventScroll: true });
  };
  // Hidden by not being drawn: its draft stays in the store.
  const shownComposer = boxHidden ? null : historyComposer;
  // The History view on a phone writes through the bottom bar's Message box.
  const paneComposer = paneChat?.composerTarget
    ? createPortal(shownComposer, paneChat.composerTarget)
    : mobile && !paneChat
      ? null
      : shownComposer;
  // What the agent is doing, or asking, under the conversation; also shown
  // before it has one (a new session asking to trust its folder).
  const chatStatus = (
    <>
      {paneChat &&
      !promptShown &&
      pane.agent_status.toLowerCase() === "working" ? (
        <div className="agent-chat-activity" role="status">
          <span className="agent-chat-activity-mark" aria-hidden="true" />
          <strong>{paneChat.activity?.word ?? "Working..."}</strong>
          {paneChat.activity?.detail ? (
            <span>{paneChat.activity.detail}</span>
          ) : null}
        </div>
      ) : null}
      {promptShown ? (
        <div
          ref={promptRef}
          className="agent-chat-prompt"
          role="status"
          tabIndex={-1}
          onKeyDown={onPromptKey}
        >
          <strong>{pane.agent ?? "The agent"} is waiting for you</strong>
          {paneChat.prompt?.tabs ? (
            // AskUserQuestion's questions: the one shown, and the others.
            <div className="agent-chat-prompt-tabs" role="tablist">
              {paneChat.prompt.tabs.map((tab) => (
                <button
                  key={tab.label}
                  type="button"
                  role="tab"
                  aria-selected={tab.current}
                  className={`${tab.current ? "is-current" : ""}${
                    tab.done ? " is-done" : ""
                  }`}
                  onClick={() => {
                    if (tab.input) paneChat.onKeys(tab.input);
                  }}
                >
                  {tab.done ? <Check size={13} aria-hidden="true" /> : null}
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}
          {paneChat.prompt?.lines.length ? (
            <pre>
              {paneChat.prompt.lines
                .filter((line) =>
                  paneChat.prompt?.options.every(
                    (option) =>
                      !line.includes(
                        option.key
                          ? `${option.key}. ${option.label}`
                          : option.label,
                      ),
                  ),
                )
                .join("\n")}
            </pre>
          ) : null}
          <div
            className={`agent-chat-prompt-actions${
              paneChat.prompt?.options.some((option) => option.detail)
                ? " has-details"
                : ""
            }`}
          >
            {paneChat.prompt?.options.map((option) => (
              <button
                key={option.label}
                type="button"
                className={`secondary-btn${option.cursor ? " is-cursor" : ""}`}
                aria-current={option.cursor ? "true" : undefined}
                onClick={() => paneChat.onKeys(option.input)}
              >
                {option.key ? <kbd>{option.key}</kbd> : null}{" "}
                {option.checked === undefined ? null : option.checked ? (
                  <SquareCheck size={15} aria-label="picked" />
                ) : (
                  <Square size={15} aria-label="not picked" />
                )}{" "}
                {option.label}
                {option.detail ? <small>{option.detail}</small> : null}
              </button>
            ))}
          </div>
          {paneChat.prompt?.submit ? (
            <button
              type="button"
              className="secondary-btn agent-chat-prompt-submit"
              onClick={() => {
                if (paneChat.prompt?.submit)
                  paneChat.onKeys(paneChat.prompt.submit);
              }}
            >
              Submit these answers
            </button>
          ) : null}
          <small className="agent-chat-prompt-hint">
            {promptTyping
              ? "Write your answer in the message box · Enter sends it"
              : "↑↓ or j k · 1–9 · Tab · Enter · Esc"}
          </small>
          {/* The menu's own keys: moving between questions and choices,
              confirming, cancelling. */}
          <div className="agent-chat-prompt-keys" aria-label="Keys">
            {PROMPT_KEYS.filter(
              // The tabs move between questions themselves.
              ([, input]) =>
                !paneChat.prompt?.tabs ||
                (input !== "\x1b[D" && input !== "\x1b[C"),
            ).map(([label, input, name]) => (
              <button
                key={name}
                type="button"
                className="secondary-btn"
                aria-label={name}
                title={name}
                onClick={() => paneChat.onKeys(input)}
              >
                <kbd>{label}</kbd>
              </button>
            ))}
            <button
              type="button"
              className="secondary-btn"
              onClick={paneChat.onShowTerminal}
            >
              <SquareTerminal size={13} /> Terminal
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  const retryDialog = (
    <ConfirmDialog
      open={open && retryConfirmation?.context === retryContext}
      title="Send this message again?"
      message={retryWarning ?? "Send the message to the agent's terminal."}
      confirmLabel="Send anyway"
      onClose={() => setRetryConfirmation(null)}
      onConfirm={() => {
        if (retryConfirmation?.context !== retryContext) return;
        const message = readOutbox(outboxKey).find(
          (each) =>
            each.id === retryConfirmation.message.id && each.state === "failed",
        );
        if (message) resendMessage(message);
        setRetryConfirmation(null);
      }}
    />
  );
  return {
    paneOutbox,
    retrySend,
    discardSend,
    paneComposer,
    chatStatus,
    onComposerKeyCapture,
    retryDialog,
  };
}
