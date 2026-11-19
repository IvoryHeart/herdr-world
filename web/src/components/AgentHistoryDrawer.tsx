import { useHistoryMetadata } from "./useHistoryMetadata";
import {
  HistorySessionDetails,
  HistoryWidePanel,
  HistoryPaneChatActions,
} from "./HistoryPanels";
import { usePaneChat, type PaneChatOptions } from "./usePaneChat";

import { useAgentArtifacts } from "../agentArtifacts";
import { useAgentCommands } from "../claudeCommands";

import { isMobileLayout } from "../layoutPreferences";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { terminalComposerScopeGeneration } from "../terminalComposer";

import { workspaceFileUrl } from "../workspaceFileUrl";
import {
  Copy,
  Download,
  Eye,
  Info,
  MessagesSquare,
  RefreshCw,
  X,
} from "lucide-react";
import { useStoreSelector } from "../store";
import { paneAgentTitle } from "../agentName";
import { copyTextWithFeedback } from "../copyText";
import {
  connectionClientScopeKey,
  useConnectionClient,
} from "../useConnectionClient";
import { CodexSessionLink } from "./CodexSessionLink";
import type { Pane } from "../types";
import {
  DEFAULT_INSPECTOR_NAVIGATION_RATIO,
  inspectorNavigationRatioAtPosition,
} from "../workspaceResource";

import { prefersReducedMotion, shortId } from "../utils";
import { AgentIcon } from "./AgentIcon";

import { AgentMessageDialog } from "./AgentMessageDialog";
import { AgentHistoryCard } from "./AgentHistoryCard";
import { AgentHistoryChat } from "./AgentHistoryChat";
import { useAgentHistoryWindow } from "./useAgentHistoryWindow";

import { HistoryTerminalComposer } from "./HistoryTerminalComposer";
import { AgentHistoryFilters } from "./AgentHistoryFilters";
import { ConversationMinimap } from "./ConversationMinimap";
import {
  groupHistoryChatItems,
  searchHistoryChatEntries,
  readAgentHistoryView,
  writeAgentHistoryView,
  type AgentHistoryView,
} from "./agentHistoryView";
import {
  ALL_HISTORY_FILTERS,
  historyEntryLabel,
  isToolContentPending,
  selectHistoryEntries,
  toolOverlayMatches,
  type HistoryFilters,
  type HistoryEntry as AgentHistoryEntry,
} from "./agentHistory";
import { AgentSessionPreviewDialog } from "./AgentSessionPreviewDialog";
import { type AgentSessionSummary, downloadSession } from "./agentSession";

import "./AgentHistoryDrawer.css";

/** How long a pane waits for a readable transcript. */
const UNAVAILABLE_QUIET_MS = 20_000;

export function AgentHistoryDrawer({
  pane,
  open,
  embedded = false,
  wide = false,
  paneChat,
  onOpenChange,
}: {
  pane: Pane;
  open: boolean;
  embedded?: boolean;
  wide?: boolean;
  paneChat?: PaneChatOptions;
  onOpenChange: (open: boolean) => void;
}) {
  const activeConnectionId = useStoreSelector(
    (state) => state.activeConnectionId,
  );
  const connectionGeneration = useStoreSelector(
    terminalComposerScopeGeneration,
  );
  const mobile = isMobileLayout();
  const [searchOpen, setSearchOpen] = useState(false);
  const workspaces = useStoreSelector((state) => state.workspaces);
  const connectionClient = useConnectionClient();
  // Images the user uploaded load from the pane's host.
  const imageUrl = useCallback(
    (path: string) =>
      workspaceFileUrl(connectionClient, pane.workspace_id, path, {
        inline: true,
      }),
    [connectionClient, pane.workspace_id],
  );
  const workspaceLabel =
    workspaces.find((workspace) => workspace.workspace_id === pane.workspace_id)
      ?.label ?? pane.workspace_id;
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<HistoryFilters>({
    ...ALL_HISTORY_FILTERS,
    tool: false,
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [view, setView] = useState<AgentHistoryView>(readAgentHistoryView);
  const chatView = !!paneChat || view === "chat";
  const agentCommands = useAgentCommands(pane, open);
  const artifacts = useAgentArtifacts(pane, !!paneChat && open);
  const [previewPane, setPreviewPane] = useState<Pane | null>(null);
  const [previewSummary, setPreviewSummary] =
    useState<AgentSessionSummary | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [expandedMessage, setExpandedMessage] =
    useState<AgentHistoryEntry | null>(null);
  const [highlightedSequence, setHighlightedSequence] = useState<number | null>(
    null,
  );
  // Wide layout: the list sits in a resizable master column and the selected
  // entry opens in an inline detail panel instead of the modal dialog.
  const [wideListRatio, setWideListRatio] = useState(
    DEFAULT_INSPECTOR_NAVIGATION_RATIO,
  );
  const [wideSelectedId, setWideSelectedId] = useState<string | null>(null);
  const drawerRef = useRef<HTMLElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const wideSplitRef = useRef<HTMLDivElement>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const previewSeqRef = useRef(0);
  // History's window: the last conversation entries, then only what changed;
  // tool payloads are fetched on demand (useAgentHistoryWindow, shared with
  // Chat).
  const {
    history,
    messages: hydratedMessages,
    loading,
    error: historyError,
    refresh: loadHistory,
    toolEntryTexts,
    toolEntryLoading,
    toolEntryFailedRef,
    loadToolEntry,
  } = useAgentHistoryWindow({
    pane,
    client: connectionClient,
    active: open,
    pollMs: 4000,
  });
  // One set for the hook's lifetime, updated in place.
  const toolEntryFailed = toolEntryFailedRef.current;
  const messages = hydratedMessages;
  const {
    session,
    setSession,
    sessionError,
    setSessionError,
    loadSession,
    attachedImages,
  } = useHistoryMetadata({
    connectionClient,
    pane,
    messages,
    history,
    activeConnectionId,
    connectionGeneration,
  });
  // Substitute fetched tool payloads only while they still match the entry.
  const hydrateEntry = useCallback(
    (entry: AgentHistoryEntry): AgentHistoryEntry => {
      const overlay = toolEntryTexts.get(entry.id);
      return overlay !== undefined && toolOverlayMatches(overlay, entry)
        ? { ...entry, text: overlay.text }
        : entry;
    },
    [toolEntryTexts],
  );
  const error = [historyError, sessionError].filter(Boolean).join("\n");
  const refreshAll = useCallback(() => {
    loadHistory();
    loadSession();
  }, [loadHistory, loadSession]);

  useEffect(() => {
    // Resource-derived state belongs to one pane and one connection lease.
    // Invalidate old continuations before loading a colliding pane ID from a
    // switched connection or replacement runtime.
    previewSeqRef.current += 1;
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedSequence(null);
    setWideSelectedId(null);
    setWideListRatio(DEFAULT_INSPECTOR_NAVIGATION_RATIO);
    setQuery("");
    setSession(null);
    setDetailsOpen(false);
    setExpandedMessage(null);
    setPreviewPane(null);
    setPreviewSummary(null);
    setPreviewLoading(false);
    setPreviewError("");
    setSessionError("");
  }, [
    connectionClient,
    pane.agent,
    pane.pane_id,
    pane.workspace_id,
    pane.tab_id,
  ]);

  const timelineSelection = useMemo(
    () => selectHistoryEntries(hydratedMessages, filters, query),
    [hydratedMessages, filters, query],
  );
  // The chat view has no type filter: it shows every entry, with tool entries
  // collapsed into blocks between the conversation bubbles. Its search keeps
  // a tool call and its result together.
  const chatEntries = useMemo(
    () => (chatView ? searchHistoryChatEntries(hydratedMessages, query) : null),
    [chatView, hydratedMessages, query],
  );
  const visibleMessages = chatEntries ?? timelineSelection.visible;
  const counts = timelineSelection.counts;
  const chatItems = useMemo(
    () => (chatView ? groupHistoryChatItems(visibleMessages) : []),
    [chatView, visibleMessages],
  );
  // The chat view reads full messages in the modal dialog at any width; only
  // the wide timeline uses the inline master-detail reader.
  const masterDetail = wide && !chatView;
  const wideSelectedEntry = masterDetail
    ? (visibleMessages.find((entry) => entry.id === wideSelectedId) ?? null)
    : null;
  const activeMessage = masterDetail
    ? !detailsOpen
      ? wideSelectedEntry
      : null
    : expandedMessage;

  // A refresh can swap the expanded entry for a redacted stub whose fetched
  // text was pruned (e.g. tool arguments rewritten under the same call id).
  // Refetch instead of showing a blank dialog; failed fetches are not
  // retried automatically (the card's manual Load button still works).
  useEffect(() => {
    if (
      !open ||
      !activeMessage ||
      !isToolContentPending(activeMessage) ||
      toolEntryLoading.has(activeMessage.id) ||
      toolEntryFailed.has(activeMessage.id)
    ) {
      return;
    }
    const overlay = toolEntryTexts.get(activeMessage.id);
    if (overlay !== undefined && toolOverlayMatches(overlay, activeMessage))
      return;
    loadToolEntry(activeMessage);
  }, [
    activeMessage,
    open,
    toolEntryFailed,
    toolEntryTexts,
    toolEntryLoading,
    loadToolEntry,
  ]);

  useEffect(() => {
    if (!open) return;
    if (document.visibilityState === "visible") loadSession();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") loadSession();
    }, 4000);
    return () => {
      window.clearInterval(timer);
    };
  }, [loadSession, open, pane.terminal_id]);

  useEffect(() => {
    if (!open) {
      setExpandedMessage(null);
      setPreviewPane(null);
      setPreviewSummary(null);
      setPreviewError("");
    }
  }, [open]);

  const openSessionPreview = useCallback(() => {
    if (
      !pane.agent ||
      session?.status !== "ok" ||
      !connectionClient.isCurrent()
    ) {
      return;
    }
    const seq = ++previewSeqRef.current;
    setPreviewPane(pane);
    setPreviewSummary(null);
    setPreviewError("");
    setPreviewLoading(true);
    connectionClient
      .call("agent_session.get", {
        pane_id: pane.pane_id,
        agent: pane.agent,
        include_text: true,
        include_trajectory: true,
        preview_limit: 1024 * 1024,
      })
      .then((result) => {
        if (connectionClient.isCurrent() && previewSeqRef.current === seq) {
          setPreviewSummary(result as AgentSessionSummary);
        }
      })
      .catch((value) => {
        if (connectionClient.isCurrent() && previewSeqRef.current === seq) {
          setPreviewError(
            value instanceof Error ? value.message : String(value),
          );
        }
      })
      .finally(() => {
        if (connectionClient.isCurrent() && previewSeqRef.current === seq) {
          setPreviewLoading(false);
        }
      });
  }, [connectionClient, pane, session?.status]);

  const closeSessionPreview = useCallback(() => {
    previewSeqRef.current += 1;
    setPreviewPane(null);
    setPreviewSummary(null);
    setPreviewError("");
  }, []);

  useEffect(
    () => () => {
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
    },
    [],
  );

  const changeFilters = (next: HistoryFilters, nextQuery = query) => {
    setFilters(next);
    setQuery(nextQuery);
    setExpandedMessage((entry) =>
      entry &&
      (chatView
        ? searchHistoryChatEntries(hydratedMessages, nextQuery).some(
            (item) => item.id === entry.id,
          )
        : selectHistoryEntries([hydrateEntry(entry)], next, nextQuery).visible
            .length)
        ? entry
        : null,
    );
    if (highlightTimerRef.current !== null) {
      window.clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
    setHighlightedSequence(null);
    // The chat jumps back to its newest message itself (followKey).
    if (!chatView && contentRef.current) contentRef.current.scrollTop = 0;
  };

  // Stable identity so the message dialog's focus effect only re-runs when the
  // message itself changes, not on every drawer re-render.
  const closeExpandedMessage = useCallback(() => setExpandedMessage(null), []);

  // Minimap entries: every visible timeline card, or every chat bubble (tool
  // chip rows are not indexed).
  const messageEntries = useMemo(
    () =>
      chatView
        ? chatItems.flatMap((item) =>
            item.type === "message"
              ? [{ message: item.entry, sequence: item.sequence }]
              : [],
          )
        : visibleMessages.map((message, index) => ({
            message,
            sequence: index + 1,
          })),
    [chatItems, chatView, visibleMessages],
  );

  const scrollToMessage = useCallback(
    (sequence: number) => {
      const card = timelineRef.current?.querySelector(
        `[data-sequence="${sequence}"]`,
      );
      if (!(card instanceof HTMLElement)) return;
      if (masterDetail) {
        // Master-detail: the minimap selects the entry in the detail panel
        // and scrolls its row into view instead of flashing a highlight.
        const message = messageEntries[sequence - 1]?.message;
        if (message) setWideSelectedId(message.id);
        card.scrollIntoView({
          behavior: prefersReducedMotion() ? "auto" : "smooth",
          block: "nearest",
        });
        return;
      }
      const reduceMotion = prefersReducedMotion();
      card.scrollIntoView({
        behavior: reduceMotion ? "auto" : "smooth",
        block: "start",
      });
      if (highlightTimerRef.current !== null) {
        window.clearTimeout(highlightTimerRef.current);
      }
      setHighlightedSequence(sequence);
      highlightTimerRef.current = window.setTimeout(() => {
        highlightTimerRef.current = null;
        setHighlightedSequence(null);
      }, 1200);
    },
    [masterDetail, messageEntries],
  );
  const minimapEntries = useMemo(
    () =>
      messageEntries.map(({ message }) => ({
        id: message.id,
        role: message.role,
        label: historyEntryLabel(message),
        text: message.text,
      })),
    [messageEntries],
  );
  const selectMinimapEntry = useCallback(
    (index: number) => scrollToMessage(index + 1),
    [scrollToMessage],
  );

  const updateWideRatioFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const split = wideSplitRef.current;
      if (!split) return;
      const bounds = split.getBoundingClientRect();
      setWideListRatio(
        inspectorNavigationRatioAtPosition(
          event.clientX - bounds.left,
          bounds.width,
        ),
      );
    },
    [],
  );

  const handleWideResizerKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const split = wideSplitRef.current;
      if (!split) return;
      const availableWidth = split.getBoundingClientRect().width;
      let next: number | null = null;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        next = inspectorNavigationRatioAtPosition(
          wideListRatio * availableWidth +
            (event.key === "ArrowLeft" ? -16 : 16),
          availableWidth,
        );
      } else if (event.key === "Home") {
        next = inspectorNavigationRatioAtPosition(0, availableWidth);
      } else if (event.key === "End") {
        next = inspectorNavigationRatioAtPosition(
          availableWidth,
          availableWidth,
        );
      }
      if (next === null) return;
      event.preventDefault();
      setWideListRatio(next);
    },
    [wideListRatio],
  );
  const sessionReady = session?.status === "ok";
  const historyReady = history?.status === "ok" || messages.length > 0;
  const hasSessionData = sessionReady || historyReady;
  const unavailable = !loading && !hasSessionData;
  const unavailableDetail =
    session?.detail ||
    history?.detail ||
    error ||
    "No readable session transcript was reported for this agent.";
  const unavailableCommand = session?.command || history?.command;
  const sessionTitle = session?.title || null;
  // A pane's chat waits quietly while the transcript cannot be read (a
  // server restart, an agent not yet started): the poll keeps trying, and
  // the reason shows only once it has lasted.
  const [unavailableSince, setUnavailableSince] = useState<number | null>(null);
  const [, setUnavailableTick] = useState(0);
  useEffect(() => {
    if (!unavailable) {
      setUnavailableSince(null);
      return;
    }
    setUnavailableSince((since) => since ?? Date.now());
    const timer = window.setTimeout(
      () => setUnavailableTick((tick) => tick + 1),
      UNAVAILABLE_QUIET_MS + 100,
    );
    return () => window.clearTimeout(timer);
  }, [unavailable]);
  const unavailableLasted =
    unavailableSince !== null &&
    Date.now() - unavailableSince >= UNAVAILABLE_QUIET_MS;
  const updatedAt = sessionReady
    ? session.updated_at
    : historyReady
      ? history?.updated_at
      : undefined;

  const chatViewToggle = (
    <button
      type="button"
      className="agent-history-icon"
      aria-label="Chat view"
      aria-pressed={chatView && !detailsOpen}
      title={chatView && !detailsOpen ? "Show as timeline" : "Show as chat"}
      onClick={() => changeView(chatView && !detailsOpen ? "timeline" : "chat")}
      disabled={!hasSessionData}
    >
      <MessagesSquare size={14} />
    </button>
  );
  const sessionActions = sessionReady ? (
    <>
      <button
        type="button"
        className="agent-history-icon"
        onClick={openSessionPreview}
        aria-label="Open transcript"
        title="Open transcript"
      >
        <Eye size={14} />
      </button>
      <button
        type="button"
        className="agent-history-icon"
        onClick={() =>
          downloadSession(pane, connectionClient, session.session?.value)
        }
        aria-label="Export raw session"
        title="Export raw session"
      >
        <Download size={14} />
      </button>
    </>
  ) : null;

  const historySearch = (
    <div className="agent-history-search">
      <input
        type="search"
        aria-label="Search history messages"
        placeholder="Search loaded messages"
        title="Search loaded message text. Tool content is searchable after loading it."
        value={query}
        onChange={(event) => changeFilters(filters, event.currentTarget.value)}
      />
    </div>
  );
  const historyFilters = (
    <>
      {historySearch}
      <AgentHistoryFilters
        filters={filters}
        counts={counts}
        onToggle={(category) =>
          changeFilters({
            ...filters,
            [category]: !filters[category],
          })
        }
      />
    </>
  );
  // The timeline keeps a flat strip above its cards; the chat view gets the
  // side rail beside its bubbles.
  const historyMinimap = (orientation: "auto" | "horizontal") =>
    minimapEntries.length > 1 ? (
      <ConversationMinimap
        entries={minimapEntries}
        scrollerRef={contentRef}
        itemsRef={timelineRef}
        orientation={orientation}
        label="Jump to message"
        className={orientation === "horizontal" ? "agent-history-minimap" : ""}
        onSelect={selectMinimapEntry}
      />
    ) : null;
  const historyCards = (
    <div className="agent-history-timeline" ref={timelineRef}>
      {messageEntries.map(({ message, sequence }) => (
        <AgentHistoryCard
          entry={message}
          index={sequence}
          key={message.id}
          highlighted={highlightedSequence === sequence}
          selected={wide && wideSelectedId === message.id}
          contentLoading={toolEntryLoading.has(message.id)}
          onExpand={
            wide ? (entry) => setWideSelectedId(entry.id) : setExpandedMessage
          }
          onLoadContent={loadToolEntry}
        />
      ))}
    </div>
  );
  const historyEmptyState =
    loading && messages.length === 0 ? (
      <div className="agent-history-state">
        <span className="terminal-loading-dot" />
        Loading messages
      </div>
    ) : visibleMessages.length === 0 ? (
      <div className="agent-history-state">
        {messages.length > 0 ? (
          <>
            {chatView
              ? "No entries match the search."
              : query.trim()
                ? "No entries match the search and selected message types."
                : "No entries match the selected message types."}
            <button
              type="button"
              className="secondary-btn"
              onClick={() =>
                // The chat view only clears its search; the timeline's
                // hidden type filters keep their state.
                changeFilters(chatView ? filters : ALL_HISTORY_FILTERS, "")
              }
            >
              {chatView
                ? "Clear search"
                : query.trim()
                  ? "Reset filters"
                  : "Show all types"}
            </button>
          </>
        ) : (
          "No history entries were found in this session."
        )}
      </div>
    ) : null;
  const historyTimeline = (
    <div className="agent-history-content" ref={contentRef}>
      {historyEmptyState ?? historyCards}
    </div>
  );
  const {
    paneOutbox,
    retrySend,
    discardSend,
    paneComposer,
    chatStatus,
    onComposerKeyCapture,
    retryDialog,
  } = usePaneChat({
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
  });
  // Until a pane's transcript can be read, its chat says so in place of the
  // conversation; a message sent meanwhile shows instead, on its way.
  const paneWaiting =
    paneChat && unavailable ? (
      <div className="agent-chat-waiting" role="status">
        <span className="agent-chat-activity-mark" aria-hidden="true" />
        <span>No conversation yet</span>
        {unavailableLasted ? <small>{unavailableDetail}</small> : null}
      </div>
    ) : null;
  const historyChat = (
    <div
      className="agent-history-messages"
      role="region"
      aria-label="History messages"
      onClick={(event) => {
        // A click on the chat (not on a control, nor ending a selection)
        // goes to its message box, on a desktop; on a phone it would bring
        // the keyboard up with every tap.
        const target = event.target as Element;
        if (
          !paneChat ||
          !paneComposer ||
          target.closest(
            "button, a, input, textarea, select, summary, label, [role='button'], [contenteditable='true'], .agent-history-composer",
          ) ||
          window.getSelection()?.isCollapsed === false ||
          window.matchMedia("(pointer: coarse)").matches
        )
          return;
        event.currentTarget
          .querySelector<HTMLElement>(
            ".agent-history-composer :is(textarea, [contenteditable='true'])",
          )
          ?.focus({ preventScroll: true });
      }}
    >
      {!paneChat || searchOpen || query ? historySearch : null}
      {(paneOutbox.length ? null : (paneWaiting ?? historyEmptyState)) ?? (
        <div className="agent-history-chat-frame">
          <AgentHistoryChat
            items={chatItems}
            speechActive={open}
            // Speech belongs to this connection's pane and session.
            speechScopeKey={JSON.stringify([
              connectionClient.connectionId,
              connectionClient.generation,
              pane.pane_id,
              history?.path,
              session?.session?.value,
            ])}
            listRef={contentRef}
            contentRef={timelineRef}
            highlightedSequence={highlightedSequence}
            followKey={query}
            toolLoading={toolEntryLoading}
            onLoadTool={loadToolEntry}
            onOpen={setExpandedMessage}
            imageUrl={imageUrl}
            attachedImages={attachedImages}
            outbox={paneOutbox}
            onRetrySend={retrySend}
            onDiscardSend={discardSend}
          />
          {historyMinimap("auto")}
        </div>
      )}
      {chatStatus}
      {paneChat ? (
        paneComposer
      ) : (
        <HistoryTerminalComposer
          key={connectionClientScopeKey(
            connectionClient,
            pane.pane_id,
            pane.terminal_id,
          )}
          pane={pane}
          open={open}
          onSent={refreshAll}
        />
      )}
    </div>
  );
  const changeView = (next: AgentHistoryView) => {
    setView(next);
    writeAgentHistoryView(next);
    setDetailsOpen(false);
    setExpandedMessage(null);
  };

  // Wide layout: master-detail. The left column is a resizable list of
  // compact entries; the right column reads the selected entry in full.
  const wideMessagesPanel = (
    <HistoryWidePanel
      {...{
        wideSplitRef,
        wideListRatio,
        updateWideRatioFromPointer,
        setWideListRatio,
        handleWideResizerKeyDown,
        wideSelectedEntry,
        hydrateEntry,
        setWideSelectedId,
        historyFilters,
        historyTimeline,
      }}
      historyMinimap={historyMinimap("horizontal")}
    />
  );

  return (
    <>
      <aside
        ref={drawerRef}
        className={`agent-history-drawer ${open ? "is-open" : ""} ${
          embedded ? "is-embedded" : ""
        } ${wide ? "is-wide" : ""}${paneChat ? " is-pane-chat" : ""}`}
        data-view={detailsOpen ? "details" : view}
        aria-label="Agent session"
        aria-hidden={!open}
        inert={!open}
        onKeyDownCapture={onComposerKeyCapture}
      >
        <div className="agent-history-drawer-head">
          {paneChat ? (
            <>
              <AgentIcon agent={pane.agent} />
              {sessionTitle ? (
                <span className="agent-chat-title" title={sessionTitle}>
                  {sessionTitle}
                </span>
              ) : null}
            </>
          ) : (
            <div className="agent-history-identity">
              <AgentIcon agent={pane.agent} />
              <div className="agent-history-title">
                <strong>
                  {sessionTitle ?? "Session"}
                  {messages.length > 0 ? (
                    <span
                      className="agent-history-count"
                      aria-label={`${visibleMessages.length} of ${messages.length} history entries`}
                      title="Most recent 200 messages with their tool entries"
                    >
                      {visibleMessages.length === messages.length
                        ? messages.length
                        : `${visibleMessages.length}/${messages.length}`}
                    </span>
                  ) : null}
                </strong>
                <span title={workspaceLabel}>
                  {workspaceLabel} · {paneAgentTitle(pane) || "Agent"} ·{" "}
                  {shortId(pane.pane_id)}
                </span>
              </div>
            </div>
          )}
          <span
            className={`agent-history-status is-${pane.agent_status.toLowerCase()}`}
          >
            {pane.agent_status}
          </span>
          <div className="agent-history-actions">
            {paneChat ? (
              <HistoryPaneChatActions
                {...{ paneChat, pane, artifacts, searchOpen, setSearchOpen }}
                onClearSearch={() => changeFilters(filters, "")}
              />
            ) : (
              <>
                {chatViewToggle}
                <button
                  type="button"
                  className="agent-history-icon"
                  aria-label="Session details"
                  aria-pressed={detailsOpen}
                  title={detailsOpen ? "Show history" : "Show session details"}
                  onClick={() => setDetailsOpen((current) => !current)}
                  disabled={!hasSessionData}
                >
                  <Info size={14} />
                </button>
              </>
            )}
            {paneChat ? null : sessionActions}
            <button
              type="button"
              className={`agent-history-icon ${loading ? "is-loading" : ""}`}
              onClick={refreshAll}
              aria-label="Refresh session"
              title="Refresh"
              disabled={loading}
            >
              <RefreshCw size={14} />
            </button>
            {!embedded ? (
              <button
                type="button"
                className="agent-history-icon"
                onClick={() => onOpenChange(false)}
                aria-label="Close session"
                title="Close"
              >
                <X size={14} />
              </button>
            ) : null}
          </div>
        </div>

        {pane.agent === "codex" ? (
          <CodexSessionLink
            key={connectionClientScopeKey(
              connectionClient,
              pane.pane_id,
              pane.terminal_id,
            )}
            paneId={pane.pane_id}
            client={connectionClient}
            onLinked={refreshAll}
          />
        ) : null}
        {unavailable && !paneChat ? (
          <div className="agent-history-unavailable" role="status">
            <strong>Session unavailable</strong>
            <p>{unavailableDetail}</p>
            {unavailableCommand ? (
              <div className="agent-history-command-row">
                <code>{unavailableCommand}</code>
                <button
                  type="button"
                  className="agent-history-icon"
                  onClick={() => void copyTextWithFeedback(unavailableCommand)}
                  aria-label="Copy integration command"
                  title="Copy command"
                >
                  <Copy size={13} />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className="secondary-btn"
              onClick={refreshAll}
            >
              <RefreshCw size={13} />
              Retry
            </button>
          </div>
        ) : null}
        {/* A pane's chat still types into the agent, and answers its
            questions, without its transcript: its message box stays where
            it is, so a transcript appearing or going away keeps the focus
            and what is being typed. */}
        {unavailable && !paneChat ? null : (
          <>
            {/* Without a transcript, a pane's chat gives the reason once it lasted. */}
            {error && !paneWaiting ? (
              <div className="agent-history-error">{error}</div>
            ) : null}
            {!detailsOpen ? (
              chatView ? (
                historyChat
              ) : wide ? (
                wideMessagesPanel
              ) : (
                <div
                  className="agent-history-messages"
                  role="region"
                  aria-label="History messages"
                >
                  {historyFilters}
                  {historyMinimap("horizontal")}
                  {historyTimeline}
                </div>
              )
            ) : (
              <HistorySessionDetails
                {...{ session, history, pane, workspaceLabel, updatedAt }}
              />
            )}
          </>
        )}
      </aside>
      {retryDialog}
      <AgentMessageDialog
        message={
          !masterDetail && expandedMessage
            ? hydrateEntry(expandedMessage)
            : null
        }
        onClose={closeExpandedMessage}
      />
      <AgentSessionPreviewDialog
        pane={previewPane}
        summary={previewSummary}
        loading={previewLoading}
        error={previewError}
        onClose={closeSessionPreview}
      />
    </>
  );
}
