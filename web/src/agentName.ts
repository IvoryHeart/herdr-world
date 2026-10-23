import type { Pane } from "./types";
import { basename, shortId } from "./utils";

/**
 * A title that names who you are talking to before what runs it:
 * "reviewer · claude". Without a Herdr name it is the harness alone.
 */
export function agentTitle(
  name: string | undefined,
  harness: string | undefined,
): string {
  const who = name?.trim() ?? "";
  const what = harness?.trim() ?? "";
  if (!who) return what;
  return what && what.toLowerCase() !== who.toLowerCase()
    ? `${who} · ${what}`
    : who;
}

/** A pane's agent as people know it: its Herdr name, else its harness. */
export function paneAgentName(
  pane: Pick<Pane, "agent_name" | "display_agent" | "agent">,
): string {
  return (
    pane.agent_name?.trim() ||
    pane.display_agent?.trim() ||
    pane.agent?.trim() ||
    ""
  );
}

/**
 * A pane's agent title (see agentTitle). Without a Herdr name it is exactly
 * the harness text the caller showed before (`pane.agent` unless given).
 */
export function paneAgentTitle(
  pane: Pick<Pane, "agent_name" | "agent">,
  harness: string | undefined = pane.agent,
): string {
  return agentTitle(pane.agent_name, harness);
}

/** An agent pane in a list: "reviewer · claude · repo · 1a2b3c4d". */
export function paneAgentListing(pane: Pane): string {
  return [
    paneAgentTitle(pane) || "Agent",
    basename(pane.foreground_cwd || pane.cwd),
    shortId(pane.pane_id),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The agent.list record for a pane: the same pane, and the same terminal and
 * harness when the record names them, so a replacement agent's record (and
 * its name) never lands on another pane.
 */
export function agentListRecord(
  agents: readonly Record<string, unknown>[],
  pane: Pick<Pane, "pane_id" | "terminal_id" | "agent">,
): Record<string, unknown> | null {
  return (
    agents.find(
      (candidate) =>
        candidate.pane_id === pane.pane_id &&
        (typeof candidate.terminal_id !== "string" ||
          candidate.terminal_id === pane.terminal_id) &&
        (typeof candidate.agent !== "string" || candidate.agent === pane.agent),
    ) ?? null
  );
}
