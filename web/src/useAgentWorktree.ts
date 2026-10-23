import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentWorktreeCandidate,
  AgentWorktreeObservation,
  AgentWorktreeTarget,
} from "../../shared/agentWorktree";
import { bridge, type ConnectionClient } from "./api";
import { agentWorktreeClient } from "./agentWorktreeClient";

export type AgentWorktreeView = {
  observation: AgentWorktreeObservation | null;
  selected: AgentWorktreeCandidate | null;
  target: AgentWorktreeTarget | null;
  loading: boolean;
  refresh(): void;
  select(id: string): void;
};

export function useAgentWorktree(
  client: ConnectionClient,
  input: {
    enabled: boolean;
    active?: boolean;
    paneId?: string;
    terminalId?: string;
    sessionFingerprint?: string;
  },
) {
  const subject = useMemo(
    () => ({
      connectionId: client.connectionId,
      generation: client.serverRuntimeGeneration ?? -1,
      paneId: input.paneId ?? "",
      ...(input.terminalId ? { terminalId: input.terminalId } : {}),
      sessionFingerprint: input.sessionFingerprint ?? null,
    }),
    [client, input.paneId, input.terminalId, input.sessionFingerprint],
  );
  const owner = JSON.stringify(subject);
  const [read, setRead] = useState<{
    owner: string;
    observation: AgentWorktreeObservation | null;
    loading: boolean;
  }>({ owner, observation: null, loading: false });
  const [choice, setChoice] = useState<{ owner: string; id: string } | null>(
    null,
  );
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!input.enabled || !subject.paneId) return;
    let alive = true;
    let pending = false;
    let again = false;
    let forceAgain = false;
    const load = async (force = false) => {
      if (!alive) return;
      if (pending) {
        again = true;
        forceAgain ||= force;
        return;
      }
      pending = true;
      setRead((previous) => ({
        owner,
        observation: previous.owner === owner ? previous.observation : null,
        loading: true,
      }));
      try {
        if (!client.isCurrent() || subject.generation < 0)
          throw new Error("Host unavailable");
        const next = (await client.call("agent_worktree.get", {
          subject,
          refresh: force,
        })) as AgentWorktreeObservation;
        if (
          !next ||
          JSON.stringify(next.subject) !== owner ||
          !Array.isArray(next.candidates)
        )
          throw new Error("Worktree observation unavailable");
        if (alive && client.isCurrent())
          setRead((previous) => ({
            owner,
            observation:
              (next.state === "unavailable" || next.state === "stale") &&
              previous.owner === owner &&
              previous.observation?.candidates.length
                ? {
                    ...previous.observation,
                    state: "stale",
                    reason: next.reason,
                  }
                : next,
            loading: false,
          }));
      } catch {
        if (alive)
          setRead((previous) => ({
            owner,
            loading: false,
            observation:
              previous.owner === owner && previous.observation
                ? {
                    ...previous.observation,
                    state: "stale",
                    reason: "Worktree evidence could not be refreshed.",
                  }
                : null,
          }));
      } finally {
        pending = false;
        if (again && alive) {
          again = false;
          const queuedForce = forceAgain;
          forceAgain = false;
          void load(queuedForce);
        }
      }
    };
    refreshRef.current = () => void load(true);
    void load(input.active ?? false);
    const stop = bridge.onControl((control) => {
      if (
        (input.active ?? true) &&
        control.type === "agent_conversation_changed" &&
        control.connection_id === client.connectionId &&
        client.acceptsServerGeneration(control.connection_generation) &&
        control.pane_id === subject.paneId
      )
        void load();
    });
    return () => {
      alive = false;
      refreshRef.current = () => {};
      stop();
    };
  }, [client, owner, subject, input.enabled, input.active]);
  const observation = read.owner === owner ? read.observation : null;
  const selected =
    observation?.candidates.find(
      (candidate) =>
        candidate.candidateId ===
        (choice?.owner === owner ? choice.id : observation.selectedCandidateId),
    ) ?? null;
  const current = client.isCurrent();
  const target = useMemo<AgentWorktreeTarget | null>(
    () =>
      observation &&
      selected &&
      observation.state !== "stale" &&
      observation.state !== "unavailable" &&
      current
        ? {
            subject: observation.subject,
            revision: observation.revision,
            candidateId: selected.candidateId,
          }
        : null,
    [observation, selected, current],
  );
  const bindingChanged = useCallback(() => {
    setRead((previous) =>
      previous.owner === owner && previous.observation
        ? {
            ...previous,
            observation: {
              ...previous.observation,
              state: "stale",
              reason: "Worktree binding changed; refreshing evidence.",
            },
          }
        : previous,
    );
    refresh();
  }, [owner, refresh]);
  const scopedClient = useMemo(
    () =>
      input.enabled
        ? agentWorktreeClient(client, target, bindingChanged)
        : client,
    [client, input.enabled, target, bindingChanged],
  );
  const select = useCallback((id: string) => setChoice({ owner, id }), [owner]);
  const view: AgentWorktreeView | undefined = input.enabled
    ? {
        observation,
        selected,
        target,
        loading: read.owner === owner && read.loading,
        refresh,
        select,
      }
    : undefined;
  return { view, client: scopedClient };
}
