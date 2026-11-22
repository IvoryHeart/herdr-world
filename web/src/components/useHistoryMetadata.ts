import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectionClient } from "../api";
import type { Pane } from "../types";
import type {
  AgentHistory,
  HistoryEntry,
  HistoryImage as AgentHistoryImage,
} from "./agentHistory";
import type { AgentSessionSummary } from "./agentSession";
import { useAttachedImages } from "./useAttachedImages";
export function useHistoryMetadata({
  connectionClient,
  pane,
  messages,
  history,
  activeConnectionId,
  connectionGeneration,
}: {
  connectionClient: ConnectionClient;
  pane: Pane;
  messages: readonly HistoryEntry[];
  history: AgentHistory | null;
  activeConnectionId: string;
  connectionGeneration: number;
}) {
  const [session, setSession] = useState<AgentSessionSummary | null>(null);
  const [sessionError, setSessionError] = useState("");
  // The session summary refreshes with the history. Only the newest read
  // for the current pane and connection publishes: a late answer from an
  // earlier poll, pane or connection is dropped, success or failure.
  const sessionSeqRef = useRef(0);
  const loadSession = useCallback(() => {
    if (!pane.agent || !connectionClient.isCurrent()) return;
    const seq = ++sessionSeqRef.current;
    const current = () =>
      connectionClient.isCurrent() && sessionSeqRef.current === seq;
    connectionClient
      .call("agent_session.get", { pane_id: pane.pane_id, agent: pane.agent })
      .then((value) => {
        if (!current()) return;
        setSession(value as AgentSessionSummary);
        setSessionError("");
      })
      .catch((reason: unknown) => {
        if (!current()) return;
        setSessionError(
          reason instanceof Error ? reason.message : String(reason),
        );
      });
  }, [connectionClient, pane.agent, pane.pane_id]);
  // A new pane, agent or connection drops reads still in flight.
  useEffect(() => {
    sessionSeqRef.current += 1;
  }, [connectionClient, pane.agent, pane.pane_id]);
  // The images the user's messages carried (Claude Code keeps a pasted image
  // in the message): their data comes with the entry, fetched once.
  const fetchEntryImages = useCallback(
    async (entryId: string) => {
      if (!pane.agent) return undefined;
      const result = (await connectionClient.call("agent_history.entry", {
        pane_id: pane.pane_id,
        workspace_id: pane.workspace_id,
        tab_id: pane.tab_id,
        agent: pane.agent,
        entry_id: entryId,
      })) as { images?: unknown };
      return Array.isArray(result.images)
        ? (result.images as AgentHistoryImage[])
        : undefined;
    },
    [
      connectionClient,
      pane.agent,
      pane.pane_id,
      pane.tab_id,
      pane.workspace_id,
    ],
  );
  const attachedImages = useAttachedImages(
    messages,
    fetchEntryImages,
    JSON.stringify([
      activeConnectionId,
      connectionGeneration,
      pane.pane_id,
      pane.terminal_id,
      history?.path,
    ]),
  );

  return {
    session,
    setSession,
    sessionError,
    setSessionError,
    loadSession,
    attachedImages,
  };
}
