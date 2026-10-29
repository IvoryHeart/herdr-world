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

/** Called only for a successfully admitted fresh host read, never cached topology. */
export function observeDeskPanes(
  desk: WorldDeskRegistry,
  connectionId: string,
  generation: number,
  panes: readonly Record<string, unknown>[],
  observedAt: number,
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
    const status =
      typeof agent?.agent_status === "string" && agent.agent_status
        ? agent.agent_status
        : pane.agent_status;
    const sequence = agent?.state_change_seq ?? pane.state_change_seq;
    const identity: DeskIdentity = {
      connection_id: connectionId,
      connection_generation: generation,
      terminal_id: pane.terminal_id,
      agent_session_fingerprint: paneSession,
    };
    if (validDeskIdentity(identity))
      desk.observeAgent(
        identity,
        ["working", "busy", "running"].includes(String(status))
          ? "working"
          : ["idle", "waiting"].includes(String(status))
            ? "idle"
            : ["blocked", "error"].includes(String(status))
              ? "blocked"
              : ["done", "completed"].includes(String(status))
                ? "done"
                : "unknown",
        observedAt,
        Number.isSafeInteger(sequence) && (sequence as number) >= 0
          ? (sequence as number)
          : undefined,
      );
  }
}
