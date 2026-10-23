import { useEffect, useMemo, useRef, useState } from "react";
import type { HistoryEntry } from "../agentHistory";
import type { ConversationStep } from "./blocks/steps";

type Client = {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
};

/**
 * The step model's evidence for History's rows, by tool-call ID. Chat asks
 * only for the calls in History's window that it does not have yet, or that
 * had not finished (running, or interrupted, which a late result can still
 * settle). It keeps only the window's calls, so it is bounded as History is,
 * and a step that did not change keeps its object, so its row need not
 * redraw.
 */
export function useStepEvidence({
  client,
  paneId,
  sessionFingerprint,
  entries,
  enabled,
}: {
  client: Client;
  paneId: string;
  sessionFingerprint: string | null;
  /** History's window. */
  entries: readonly HistoryEntry[];
  enabled: boolean;
}): ReadonlyMap<string, ConversationStep> {
  const [stepEvidence, setStepEvidence] = useState<
    ReadonlyMap<string, ConversationStep>
  >(() => new Map());
  const evidenceSession = `${paneId}\u0000${sessionFingerprint ?? ""}`;
  const evidenceSessionRef = useRef(evidenceSession);
  if (evidenceSessionRef.current !== evidenceSession) {
    evidenceSessionRef.current = evidenceSession;
    if (stepEvidence.size) setStepEvidence(new Map());
  }
  // Rebuilt whenever History's window changes, which is also when a running
  // call may have finished.
  const callIds = useMemo(() => {
    const ids = new Set<string>();
    for (const entry of entries)
      if (entry.role === "tool" && entry.source_call_id)
        ids.add(entry.source_call_id);
    return [...ids];
  }, [entries]);
  useEffect(() => {
    const inWindow = new Set(callIds);
    if ([...stepEvidence.keys()].some((id) => !inWindow.has(id))) {
      setStepEvidence(
        new Map([...stepEvidence].filter(([id]) => inWindow.has(id))),
      );
      return;
    }
    if (!enabled) return;
    const wanted = callIds.filter((id) => {
      const known = stepEvidence.get(id);
      return (
        !known || known.state === "running" || known.state === "interrupted"
      );
    });
    if (!wanted.length) return;
    let current = true;
    void client
      .call("agent_conversation.steps", {
        pane_id: paneId,
        call_ids: wanted,
      })
      .then((result) => {
        const steps = (result as { steps?: ConversationStep[] }).steps ?? [];
        if (!current || !steps.length) return;
        setStepEvidence((previous) => {
          let next: Map<string, ConversationStep> | null = null;
          for (const step of steps) {
            if (!step.call_id || !inWindow.has(step.call_id)) continue;
            const known = previous.get(step.call_id);
            if (known && JSON.stringify(known) === JSON.stringify(step))
              continue;
            next ??= new Map(previous);
            next.set(step.call_id, step);
          }
          return next ?? previous;
        });
      })
      // Evidence is extra; a failed read leaves the plain rows.
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [callIds, client, enabled, paneId, stepEvidence]);
  return stepEvidence;
}
