import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import {
  mergeAgentHistory,
  toolOverlayMatches,
  type AgentHistory,
  type AgentHistoryResponse,
  type HistoryEntry,
  type ToolTextOverlay,
} from "./agentHistory";

/**
 * An agent's history as a bounded window: the server sends the last window
 * of conversation entries once, then only what changed since the cursor.
 * Tool payloads arrive redacted and are fetched on demand. History and Chat
 * both read through this, so a long, busy transcript is never re-read or
 * re-rendered whole.
 *
 * The merged window is kept per pane for this page (a few panes at most), so
 * a window that remounts, docks, undocks or reopens shows its conversation at
 * once and carries on from its cursor.
 *
 * Scrolling back past the window loads older entries a page at a time
 * (agent_history.get with `before`). They are kept before the window; entries the window
 * drops off its head while older ones are shown join them, so the reader's
 * place never vanishes.
 */
const CACHE_LIMIT = 12;
const OLDER_PAGE = 100;
type Older = { epoch: string; entries: HistoryEntry[]; hasMore: boolean };
const cache = new Map<string, { history: AgentHistory; older: Older | null }>();

const cacheKey = (client: ConnectionClient, pane: Pane) =>
  JSON.stringify([
    client.connectionId,
    client.serverRuntimeGeneration,
    pane.pane_id,
    pane.workspace_id,
    pane.tab_id,
    pane.agent,
  ]);

function remember(
  key: string,
  history: AgentHistory | null,
  older: Older | null,
) {
  cache.delete(key);
  if (!history) return;
  cache.set(key, { history, older });
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

export function useAgentHistoryWindow({
  pane,
  client,
  active,
  pollMs = null,
}: {
  pane: Pane;
  client: ConnectionClient;
  /** Only an active (shown) window reads. */
  active: boolean;
  /** Reread on a timer; null when the caller refreshes on change pushes. */
  pollMs?: number | null;
}) {
  const key = pane.agent ? cacheKey(client, pane) : null;
  const [history, setHistory] = useState<AgentHistory | null>(() =>
    key ? (cache.get(key)?.history ?? null) : null,
  );
  const [older, setOlder] = useState<Older | null>(() =>
    key ? (cache.get(key)?.older ?? null) : null,
  );
  const [olderLoading, setOlderLoading] = useState(false);
  const olderRef = useRef<Older | null>(older);
  // Conversation entries the server's window holds; a full window may have
  // older entries behind it.
  const windowLimitRef = useRef<number | null>(null);
  const [toolEntryTexts, setToolEntryTexts] = useState<
    ReadonlyMap<string, ToolTextOverlay>
  >(() => new Map());
  const [toolEntryLoading, setToolEntryLoading] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const historyRef = useRef<AgentHistory | null>(history);
  const loadSeqRef = useRef(0);
  const inFlightRef = useRef<number | null>(null);
  // A refresh asked for while one is in flight runs once more afterwards:
  // bursts of change pushes coalesce into at most one queued read.
  const againRef = useRef(false);
  const paneIdRef = useRef(pane.pane_id);
  paneIdRef.current = pane.pane_id;
  // Entries whose content fetch failed; suppresses auto-refetch loops while
  // keeping a manual Load usable.
  const toolEntryFailedRef = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => {
    if (!pane.agent || !key || !client.isCurrent()) return;
    if (inFlightRef.current !== null) {
      againRef.current = true;
      return;
    }
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    inFlightRef.current = seq;
    setLoading(!historyRef.current);
    const requested = historyRef.current?.cursor ?? null;
    client
      .call("agent_history.get", {
        history_version: 2,
        cursor: requested,
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        agent: pane.agent,
      })
      .then((response) => {
        if (!client.isCurrent() || loadSeqRef.current !== seq) return;
        const limit = (response as AgentHistoryResponse | null)?.window_limit;
        if (typeof limit === "number") windowLimitRef.current = limit;
        const previous = historyRef.current;
        const merged = mergeAgentHistory(
          historyRef.current,
          response as AgentHistoryResponse,
          requested,
        );
        if (merged === historyRef.current) {
          // A valid answer with nothing new (same cursor) still ends an
          // earlier failure; an invalid or out-of-date one does not.
          const reply = response as AgentHistoryResponse;
          const kept = historyRef.current?.cursor;
          if (
            reply?.history_version === 2 &&
            kept &&
            reply.cursor?.epoch === kept.epoch &&
            reply.cursor?.revision === kept.revision
          )
            setError("");
          return;
        }
        historyRef.current = merged;
        // Older pages belong to one epoch; entries the window evicts from its
        // head join them so the scrolled-back reader keeps their place.
        let kept = olderRef.current;
        if (kept && (!merged || merged.cursor.epoch !== kept.epoch))
          kept = null;
        else if (kept && merged && previous) {
          const ids = new Set(merged.messages.map((message) => message.id));
          const evicted: HistoryEntry[] = [];
          for (const entry of previous.messages) {
            if (ids.has(entry.id)) break;
            evicted.push(entry);
          }
          if (evicted.length)
            kept = { ...kept, entries: [...kept.entries, ...evicted] };
        }
        if (kept !== olderRef.current) {
          olderRef.current = kept;
          setOlder(kept);
        }
        remember(key, merged, kept);
        setHistory(merged);
        if (!merged) return;
        // Drop fetched texts for entries that left the window or whose content
        // changed under the same id (hash or byte-length mismatch).
        setToolEntryTexts((current) => {
          if (current.size === 0) return current;
          const kept = new Map<string, ToolTextOverlay>();
          for (const message of [
            ...(olderRef.current?.entries ?? []),
            ...merged.messages,
          ]) {
            const overlay = current.get(message.id);
            if (overlay !== undefined && toolOverlayMatches(overlay, message))
              kept.set(message.id, overlay);
          }
          return kept.size === current.size ? current : kept;
        });
        // Failure marks for entries that left the window are dead weight; an
        // entry reappearing later may retry once.
        const windowed = new Set(
          [...(olderRef.current?.entries ?? []), ...merged.messages].map(
            (message) => message.id,
          ),
        );
        for (const id of toolEntryFailedRef.current)
          if (!windowed.has(id)) toolEntryFailedRef.current.delete(id);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!client.isCurrent() || loadSeqRef.current !== seq) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (inFlightRef.current === seq) inFlightRef.current = null;
        if (client.isCurrent() && loadSeqRef.current === seq) {
          setLoading(false);
          if (againRef.current) {
            againRef.current = false;
            refreshRef.current();
          }
        }
      });
  }, [client, key, pane.agent, pane.pane_id, pane.tab_id, pane.workspace_id]);
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Resource-derived state belongs to one pane and one connection lease. A
  // new pane starts from its kept window, or empty.
  const shownKey = useRef(key);
  useEffect(() => {
    if (shownKey.current === key) return;
    shownKey.current = key;
    loadSeqRef.current += 1;
    inFlightRef.current = null;
    againRef.current = false;
    const kept = key ? (cache.get(key) ?? null) : null;
    historyRef.current = kept?.history ?? null;
    setHistory(kept?.history ?? null);
    olderRef.current = kept?.older ?? null;
    setOlder(kept?.older ?? null);
    setOlderLoading(false);
    windowLimitRef.current = null;
    setToolEntryTexts(new Map());
    setToolEntryLoading(new Set());
    toolEntryFailedRef.current.clear();
    setLoading(false);
    setError("");
  }, [key]);

  useEffect(() => {
    if (!active) return;
    if (document.visibilityState === "visible") refresh();
    if (pollMs === null) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, pollMs);
    return () => window.clearInterval(timer);
  }, [active, pollMs, refresh]);
  useEffect(
    () => () => {
      loadSeqRef.current += 1;
      inFlightRef.current = null;
    },
    [],
  );

  const loadToolEntry = useCallback(
    (entry: HistoryEntry) => {
      if (!pane.agent || !client.isCurrent()) return;
      const paneId = pane.pane_id;
      setToolEntryLoading((current) => new Set(current).add(entry.id));
      client
        .call("agent_history.entry", {
          pane_id: pane.pane_id,
          workspace_id: pane.workspace_id,
          tab_id: pane.tab_id,
          agent: pane.agent,
          entry_id: entry.id,
        })
        .then((result) => {
          if (!client.isCurrent() || paneIdRef.current !== paneId) return;
          toolEntryFailedRef.current.delete(entry.id);
          const { text, text_hash } = result as {
            text?: unknown;
            text_hash?: unknown;
          };
          const value = typeof text === "string" ? text : "";
          setToolEntryTexts((current) =>
            new Map(current).set(entry.id, {
              text: value,
              bytes: new TextEncoder().encode(value).length,
              hash: typeof text_hash === "string" ? text_hash : undefined,
            }),
          );
        })
        .catch((reason: unknown) => {
          if (!client.isCurrent() || paneIdRef.current !== paneId) return;
          toolEntryFailedRef.current.add(entry.id);
          setError(reason instanceof Error ? reason.message : String(reason));
        })
        .finally(() => {
          setToolEntryLoading((current) => {
            if (!current.has(entry.id)) return current;
            const next = new Set(current);
            next.delete(entry.id);
            return next;
          });
        });
    },
    [client, pane.agent, pane.pane_id, pane.tab_id, pane.workspace_id],
  );

  // One older page at a time, before the oldest entry shown.
  const olderSeqRef = useRef(0);
  const olderInFlightRef = useRef(false);
  const loadOlder = useCallback(() => {
    const current = historyRef.current;
    if (!pane.agent || !key || !current || !client.isCurrent()) return;
    if (olderInFlightRef.current) return;
    const kept = olderRef.current;
    const anchor = kept?.entries[0] ?? current.messages[0];
    if (!anchor || (kept && !kept.hasMore)) return;
    const epoch = current.cursor.epoch;
    // Keep what the window drops from now on, not from when the page
    // arrives: a refresh while it is in flight would otherwise leave a gap
    // between the page and the window.
    if (!kept) {
      const started: Older = { epoch, entries: [], hasMore: true };
      olderRef.current = started;
      setOlder(started);
    }
    const seq = olderSeqRef.current + 1;
    olderSeqRef.current = seq;
    olderInFlightRef.current = true;
    let committed = false;
    setOlderLoading(true);
    client
      .call("agent_history.get", {
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        agent: pane.agent,
        before: anchor.id,
        limit: OLDER_PAGE,
      })
      .then((result) => {
        if (!client.isCurrent() || olderSeqRef.current !== seq) return;
        const reply = result as {
          epoch?: unknown;
          entries?: unknown;
          has_more?: unknown;
        };
        const now = historyRef.current;
        if (
          !now ||
          reply.epoch !== epoch ||
          now.cursor.epoch !== epoch ||
          !Array.isArray(reply.entries)
        )
          return;
        const shown = new Set(
          [...(olderRef.current?.entries ?? []), ...now.messages].map(
            (entry) => entry.id,
          ),
        );
        const page = (reply.entries as HistoryEntry[]).filter(
          (entry) => !shown.has(entry.id),
        );
        const next: Older = {
          epoch,
          entries: [...page, ...(olderRef.current?.entries ?? [])],
          hasMore: reply.has_more === true && page.length > 0,
        };
        olderRef.current = next;
        // The guard holds until this page has rendered (see below): a scroll
        // in between still reads the old top and would fetch the next page.
        committed = true;
        setOlder(next);
        remember(key, now, next);
      })
      .catch((reason: unknown) => {
        if (!client.isCurrent() || olderSeqRef.current !== seq) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (olderSeqRef.current !== seq) return;
        if (!committed) olderInFlightRef.current = false;
        setOlderLoading(false);
      });
  }, [client, key, pane.agent, pane.pane_id, pane.tab_id, pane.workspace_id]);
  useLayoutEffect(() => {
    olderInFlightRef.current = false;
  }, [older]);
  // Back at the newest message, the older pages go: they would otherwise
  // keep every entry the window drops for as long as the session lasts.
  const dropOlder = useCallback(() => {
    if (!olderRef.current || olderInFlightRef.current) return;
    olderRef.current = null;
    setOlder(null);
    const current = historyRef.current;
    if (key && current) remember(key, current, null);
  }, [key]);
  useEffect(() => {
    // A new pane or lease drops a page still in flight.
    olderSeqRef.current += 1;
    olderInFlightRef.current = false;
  }, [key]);

  const windowMessages = history?.messages;
  const olderEntries = older?.entries;
  const messages = useMemo(
    () =>
      olderEntries?.length
        ? [...olderEntries, ...(windowMessages ?? [])]
        : (windowMessages ?? []),
    [olderEntries, windowMessages],
  );
  const conversationCount = useMemo(
    () =>
      (windowMessages ?? []).filter((message) => message.role !== "tool")
        .length,
    [windowMessages],
  );
  const hasOlder = older
    ? older.hasMore
    : windowLimitRef.current !== null &&
      conversationCount >= windowLimitRef.current;
  // Substitute fetched tool payloads only while they still match the entry.
  const hydrated = useMemo(
    () =>
      toolEntryTexts.size === 0
        ? messages
        : messages.map((entry) => {
            const overlay = toolEntryTexts.get(entry.id);
            return overlay !== undefined && toolOverlayMatches(overlay, entry)
              ? { ...entry, text: overlay.text }
              : entry;
          }),
    [messages, toolEntryTexts],
  );

  return {
    history,
    messages: hydrated,
    loading,
    error,
    refresh,
    hasOlder,
    olderLoading,
    loadOlder,
    dropOlder,
    toolEntryTexts,
    toolEntryLoading,
    toolEntryFailedRef,
    loadToolEntry,
  };
}
