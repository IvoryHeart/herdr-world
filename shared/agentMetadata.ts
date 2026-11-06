/** Display metadata matching; identity and progress admission remain separate. */
export function agentListRecord(
  agents: readonly Record<string, unknown>[],
  pane: { pane_id: unknown; terminal_id?: unknown; agent?: unknown },
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

/** The activity component of the canonical World/Desk review stop. */
export function agentActivityAt(
  pane: { last_activity_at?: unknown },
  metadata: Record<string, unknown> | null | undefined,
): number | null {
  const activity = pane.last_activity_at ?? metadata?.last_activity_at;
  return typeof activity === "number" &&
    Number.isFinite(activity) &&
    activity > 0
    ? activity
    : null;
}
