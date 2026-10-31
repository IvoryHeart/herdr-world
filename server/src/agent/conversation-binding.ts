import { reportedSessionClaim } from "./agent-claims";
import { claimAuthorizes } from "../world/field-claims";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { taskSummarySessionFingerprint } from "../herdr/task-summary";
import type { ConversationBinding } from "./conversation";
import {
  codexTitleBinding,
  type AgentSessionResolverContext,
} from "./session-resolver";
import { isRecord, stringValue } from "./session-utils";

/**
 * The session Herdr ties to a pane, from its `agent.get` reply alone: the
 * thread a Codex title names, else the session the integration reported.
 * Directory guesses are never a binding. No file access, so a send can check
 * it immediately before prompting. A Codex title binds a complete thread ID
 * only: a truncated ID this context has not resolved to one transcript, or a
 * title naming two threads, binds the pane to its title with no fingerprint,
 * so nothing can be sent.
 */
export function paneBinding(
  agent: string,
  info: Record<string, unknown>,
  context: AgentSessionResolverContext,
  /** Title prefixes searched just now; remembered matches are ignored. */
  verified?: ReadonlyMap<string, string>,
): {
  binding: Exclude<ConversationBinding, "guessed">;
  fingerprint: string | null;
} | null {
  if (agent === "codex") {
    const title = codexTitleBinding(
      stringValue(info.terminal_title),
      context,
      verified,
    );
    if (
      title.kind === "id" &&
      claimAuthorizes("session", "conversation.send", {
        value: title.id,
        source: "herdr.title",
        observed_at: Date.now(),
        basis: "reported",
      })
    )
      return {
        binding: "title",
        fingerprint: createHash("sha256")
          .update(JSON.stringify(["codex-title", title.id]))
          .digest("hex"),
      };
    // The title decides whenever it names a thread.
    if (title.kind !== "none") return { binding: "title", fingerprint: null };
  }
  // This claim is made from this fresh agent.get reply, never from the read model.
  const current = reportedSessionClaim(info, Date.now());
  if (!current || !claimAuthorizes("session", "conversation.send", current))
    return null;
  const session = current.value;
  return {
    binding: "reported",
    fingerprint: taskSummarySessionFingerprint(
      session as { source: string; agent: string; kind: string; value: string },
    ),
  };
}

/** A plain name for the session a pane's `agent.get` reply describes. */
export function sessionLabel(
  agent: string,
  info: Record<string, unknown>,
  context: AgentSessionResolverContext,
  verified?: ReadonlyMap<string, string>,
) {
  if (agent === "codex") {
    const title = codexTitleBinding(
      stringValue(info.terminal_title),
      context,
      verified,
    );
    if (title.kind === "id") return `Codex thread ${title.id}`;
    if (title.kind !== "none")
      return "a Codex thread its title does not identify";
  }
  const session = isRecord(info.agent_session) ? info.agent_session : null;
  const value = stringValue(session?.value);
  if (!value) return "a session Herdr does not identify";
  // A reported transcript path is named by its file.
  const name = session?.kind === "path" ? basename(value) : value;
  return `${agent || "agent"} session ${name}`;
}
