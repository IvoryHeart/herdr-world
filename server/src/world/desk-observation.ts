import { createHash } from "node:crypto";
import {
  validDeskIdentity,
  type DeskIdentity,
} from "../../../shared/deskState";
import type { WorldDeskRegistry } from "./desk-state";

/** Same public-session digest used by turn receipts and World leaves. */
export function deskSessionFingerprint(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const session = value as Record<string, unknown>;
  const fields = [session.source, session.agent, session.kind, session.value];
  if (!fields.every((field) => typeof field === "string" && field.length > 0))
    return null;
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

/** Herdr's and harnesses' status words, as the states World observes. */
export function observedAgentStatus(status: unknown) {
  const word = String(status);
  return ["working", "busy", "running"].includes(word)
    ? "working"
    : ["idle", "waiting"].includes(word)
      ? "idle"
      : ["blocked", "error"].includes(word)
        ? "blocked"
        : ["done", "completed"].includes(word)
          ? "done"
          : "unknown";
}

/**
 * Each agent pane of one fresh host read, with the status and sequence World
 * admits for it: an agent.list row counts only when it is the pane's one row
 * and names the pane's current session; otherwise the pane's own status
 * stands. Panes sharing a terminal are ambiguous and left out.
 */
export function admittedAgentPanes(
  panes: readonly Record<string, unknown>[],
  agents: readonly Record<string, unknown>[] = [],
) {
  const agentByPane = new Map<string, Record<string, unknown> | null>();
  for (const agent of agents) {
    if (
      typeof agent.pane_id !== "string" ||
      typeof agent.terminal_id !== "string"
    )
      continue;
    const key = JSON.stringify([agent.pane_id, agent.terminal_id]);
    agentByPane.set(key, agentByPane.has(key) ? null : agent);
  }
  const seen = new Set<string>(),
    duplicates = new Set<string>();
  for (const pane of panes) {
    if (typeof pane.terminal_id !== "string") continue;
    if (seen.has(pane.terminal_id)) duplicates.add(pane.terminal_id);
    seen.add(pane.terminal_id);
  }
  const admitted: {
    terminalId: string;
    session: string | null;
    status: ReturnType<typeof observedAgentStatus>;
    sequence: unknown;
  }[] = [];
  for (const pane of panes) {
    if (
      typeof pane.agent !== "string" ||
      !pane.agent ||
      typeof pane.terminal_id !== "string" ||
      duplicates.has(pane.terminal_id)
    )
      continue;
    const candidate = agentByPane.get(
      JSON.stringify([pane.pane_id, pane.terminal_id]),
    );
    const paneSession = deskSessionFingerprint(pane.agent_session);
    const agentSession = deskSessionFingerprint(candidate?.agent_session);
    const agent =
      candidate && agentSession === paneSession ? candidate : undefined;
    admitted.push({
      terminalId: pane.terminal_id,
      session: paneSession,
      status: observedAgentStatus(
        typeof agent?.agent_status === "string" && agent.agent_status
          ? agent.agent_status
          : pane.agent_status,
      ),
      sequence: agent?.state_change_seq ?? pane.state_change_seq,
    });
  }
  return admitted;
}

/** Called only for a successfully admitted fresh host read, never cached topology. */
export function observeDeskPanes(
  desk: WorldDeskRegistry,
  connectionId: string,
  generation: number,
  panes: readonly Record<string, unknown>[],
  observedAt: number,
  agents: readonly Record<string, unknown>[] = [],
) {
  for (const { terminalId, session, status, sequence } of admittedAgentPanes(
    panes,
    agents,
  )) {
    const identity: DeskIdentity = {
      connection_id: connectionId,
      connection_generation: generation,
      terminal_id: terminalId,
      agent_session_fingerprint: session,
    };
    if (validDeskIdentity(identity))
      desk.observeAgent(
        identity,
        status,
        observedAt,
        Number.isSafeInteger(sequence) && (sequence as number) >= 0
          ? (sequence as number)
          : undefined,
      );
  }
}
