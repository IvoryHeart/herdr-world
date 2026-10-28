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
) {
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
    const identity: DeskIdentity = {
      connection_id: connectionId,
      connection_generation: generation,
      terminal_id: pane.terminal_id,
      agent_session_fingerprint: deskSessionFingerprint(pane.agent_session),
    };
    if (validDeskIdentity(identity))
      desk.observeAgent(
        identity,
        ["working", "busy", "running"].includes(String(pane.agent_status))
          ? "working"
          : ["idle", "waiting"].includes(String(pane.agent_status))
            ? "idle"
            : ["blocked", "error"].includes(String(pane.agent_status))
              ? "blocked"
              : ["done", "completed"].includes(String(pane.agent_status))
                ? "done"
                : "unknown",
        observedAt,
      );
  }
}
