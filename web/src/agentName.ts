import type { Pane } from "./types";

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
