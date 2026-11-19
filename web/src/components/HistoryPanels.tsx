import { Search, Square, SquareTerminal } from "lucide-react";
import { AgentArtifactsMenu } from "./AgentArtifactsMenu";
import type { SessionArtifact } from "../agentArtifacts";
import type { PaneChatOptions } from "./usePaneChat";
import type {
  CSSProperties,
  ReactNode,
  RefObject,
  Dispatch,
  SetStateAction,
  PointerEvent as ReactPointerEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Pane } from "../types";
import { formatUiDateTime, formatUiRelativeTime } from "../uiLocale";
import { shortId } from "../utils";
import type { AgentHistory, HistoryEntry } from "./agentHistory";
import {
  type AgentSessionSummary,
  formatCount,
  formatTokenTotal,
  formatOptionalCompact,
  formatBytes,
  tokenUsage,
} from "./agentSession";
import { HistoryDetailRow as DetailRow } from "./HistoryDetailRow";
import { AgentMessageContent } from "./AgentMessageContent";
import { DEFAULT_INSPECTOR_NAVIGATION_RATIO } from "../workspaceResource";
function formatRelativeTime(timestamp: string) {
  const time = new Date(timestamp);
  if (Number.isNaN(time.getTime())) return "Unknown";
  const seconds = Math.round((time.getTime() - Date.now()) / 1000);
  const absoluteSeconds = Math.abs(seconds);
  if (absoluteSeconds < 60) return formatUiRelativeTime(seconds, "second");
  if (absoluteSeconds < 3600)
    return formatUiRelativeTime(Math.round(seconds / 60), "minute");
  if (absoluteSeconds < 86400)
    return formatUiRelativeTime(Math.round(seconds / 3600), "hour");
  return formatUiRelativeTime(Math.round(seconds / 86400), "day");
}

export function HistorySessionDetails({
  session,
  history,
  pane,
  workspaceLabel,
  updatedAt,
}: {
  session: AgentSessionSummary | null;
  history: AgentHistory | null;
  pane: Pane;
  workspaceLabel: string;
  updatedAt?: string | null;
}) {
  const sessionReady = session?.status === "ok";
  const usage = tokenUsage(session);
  return (
    <div
      className="agent-history-details"
      role="region"
      aria-label="Session details"
    >
      {sessionReady ? (
        <section
          className="agent-history-overview"
          aria-label="Session overview"
        >
          <div>
            <strong>{formatCount(session.stats.turns)}</strong>
            <span>Turns</span>
          </div>
          <div>
            <strong>{formatTokenTotal(session)}</strong>
            <span>Tokens</span>
          </div>
          <div>
            <strong title={updatedAt ? formatUiDateTime(updatedAt) : undefined}>
              {updatedAt ? formatRelativeTime(updatedAt) : "-"}
            </strong>
            <span>Updated</span>
          </div>
          <p>
            Input {formatOptionalCompact(usage?.input_tokens)}
            <span>·</span>
            Cached {formatOptionalCompact(usage?.cached_input_tokens)}
            <span>·</span>
            Output {formatOptionalCompact(usage?.output_tokens)}
          </p>
        </section>
      ) : null}
      <DetailRow label="Workspace" value={workspaceLabel} />
      <DetailRow label="Agent" value={pane.agent ?? "-"} />
      <DetailRow label="Pane" value={shortId(pane.pane_id)} />
      <DetailRow
        label="Session ID"
        value={session?.session?.value || "-"}
        copyable={!!session?.session?.value}
      />
      <DetailRow
        label="Session file"
        value={session?.path || history?.path || "-"}
        copyable={!!(session?.path || history?.path)}
      />
      <DetailRow
        label="Records"
        value={sessionReady ? formatCount(session.stats.records) : "-"}
      />
      <DetailRow
        label="File size"
        value={sessionReady ? formatBytes(session.file?.size) : "-"}
      />
      <DetailRow
        label="Reasoning"
        value={formatOptionalCompact(usage?.reasoning_output_tokens)}
      />
      <DetailRow
        label="Updated"
        value={updatedAt ? formatUiDateTime(updatedAt) : "-"}
      />
    </div>
  );
}
export function HistoryWidePanel({
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
  historyMinimap,
}: {
  wideSplitRef: RefObject<HTMLDivElement | null>;
  wideListRatio: number;
  updateWideRatioFromPointer(event: ReactPointerEvent<HTMLDivElement>): void;
  setWideListRatio: Dispatch<SetStateAction<number>>;
  handleWideResizerKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
  wideSelectedEntry: HistoryEntry | null;
  hydrateEntry(entry: HistoryEntry): HistoryEntry;
  setWideSelectedId: Dispatch<SetStateAction<string | null>>;
  historyFilters: ReactNode;
  historyTimeline: ReactNode;
  historyMinimap: ReactNode;
}) {
  return (
    <div
      className="agent-history-wide"
      ref={wideSplitRef}
      role="region"
      aria-label="History messages"
      style={
        {
          "--agent-history-list-width": `${wideListRatio * 100}%`,
        } as CSSProperties
      }
    >
      <div className="agent-history-wide-list">
        {historyFilters}
        {historyMinimap}
        {historyTimeline}
      </div>
      <div
        className="workspace-inspector-split-resizer"
        role="separator"
        tabIndex={0}
        aria-label="Resize message list"
        aria-orientation="vertical"
        aria-valuemin={15}
        aria-valuemax={75}
        aria-valuenow={Math.round(wideListRatio * 100)}
        title="Drag to resize; double-click to reset"
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          updateWideRatioFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          updateWideRatioFromPointer(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onPointerCancel={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
          }
        }}
        onDoubleClick={() =>
          setWideListRatio(DEFAULT_INSPECTOR_NAVIGATION_RATIO)
        }
        onKeyDown={handleWideResizerKeyDown}
      />
      <div className="agent-history-wide-detail">
        {wideSelectedEntry ? (
          <AgentMessageContent
            message={hydrateEntry(wideSelectedEntry)}
            embedded
            onClose={() => setWideSelectedId(null)}
          />
        ) : (
          <div className="agent-history-wide-placeholder">
            Select a message to read it here.
          </div>
        )}
      </div>
    </div>
  );
}

export function HistoryPaneChatActions({
  paneChat,
  pane,
  artifacts,
  searchOpen,
  setSearchOpen,
  onClearSearch,
}: {
  paneChat: PaneChatOptions;
  pane: Pane;
  artifacts: SessionArtifact[];
  searchOpen: boolean;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  onClearSearch(): void;
}) {
  return (
    <>
      <AgentArtifactsMenu artifacts={artifacts} />
      <button
        type="button"
        className="agent-history-icon"
        aria-label="Search the conversation"
        aria-pressed={searchOpen}
        title="Search"
        onClick={() => {
          if (searchOpen) onClearSearch();
          setSearchOpen(!searchOpen);
        }}
      >
        <Search size={14} />
      </button>
      {pane.agent_status.toLowerCase() === "working" ? (
        <button
          type="button"
          className="agent-history-icon"
          aria-label="Stop"
          title="Stop: Esc in the terminal"
          onClick={() => paneChat.onKeys("\x1b")}
        >
          <Square size={14} />
        </button>
      ) : null}
      <button
        type="button"
        className="agent-history-icon"
        aria-label="Show the terminal"
        title="Show the terminal"
        onClick={paneChat.onShowTerminal}
      >
        <SquareTerminal size={14} />
      </button>
    </>
  );
}
