/** Session-qualified recency shared by list enrichment and pushed values. */
export type AgentActivityEntry = {
  pane_id: string;
  terminal_id: string;
  agent: string;
  session: string | null;
  last_activity_at: number;
};
export type AgentActivityIdentity = Omit<
  AgentActivityEntry,
  "last_activity_at"
>;
export type AgentActivityMap = Record<string, AgentActivityEntry>;

export function activityIdentity(
  value: unknown,
  wire = false,
): AgentActivityIdentity | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const rawSession = row.agent_session;
  const session = wire
    ? row.session
    : rawSession && typeof rawSession === "object"
      ? ((rawSession as Record<string, unknown>).value ?? null)
      : null;
  if (
    typeof row.pane_id !== "string" ||
    !row.pane_id ||
    typeof row.terminal_id !== "string" ||
    !row.terminal_id ||
    typeof row.agent !== "string" ||
    !row.agent ||
    (session !== null && typeof session !== "string")
  )
    return null;
  return {
    pane_id: row.pane_id,
    terminal_id: row.terminal_id,
    agent: row.agent,
    session,
  };
}

export function activityKey(value: AgentActivityIdentity): string {
  return JSON.stringify([
    value.pane_id,
    value.terminal_id,
    value.agent,
    value.session,
  ]);
}

export function activityEntries(
  value: unknown,
  wire = false,
): AgentActivityEntry[] {
  if (!Array.isArray(value)) return [];
  const entries = new Map<string, AgentActivityEntry>();
  for (const row of value) {
    const identity = activityIdentity(row, wire);
    const time: unknown = row?.last_activity_at;
    if (
      !identity ||
      typeof time !== "number" ||
      !Number.isFinite(time) ||
      time <= 0
    )
      continue;
    const key = activityKey(identity);
    if (time > (entries.get(key)?.last_activity_at ?? 0))
      entries.set(key, { ...identity, last_activity_at: time });
  }
  return [...entries]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, entry]) => entry);
}

export function activityFromList(result: unknown): AgentActivityEntry[] {
  return activityEntries(
    result && typeof result === "object" && "agents" in result
      ? result.agents
      : null,
  );
}

export function enrichActivityList<T>(
  result: T,
  entries: readonly AgentActivityEntry[],
): T {
  if (
    !result ||
    typeof result !== "object" ||
    !("agents" in result) ||
    !Array.isArray(result.agents)
  )
    return result;
  const byKey = new Map(
    entries.map((entry) => [activityKey(entry), entry.last_activity_at]),
  );
  return {
    ...result,
    agents: result.agents.map((agent) => {
      const identity = activityIdentity(agent);
      const time = identity && byKey.get(activityKey(identity));
      return time ? { ...agent, last_activity_at: time } : agent;
    }),
  };
}

/** Keep the maximum per complete identity, including identities awaiting pane admission. */
export function rememberActivity(
  previous: AgentActivityMap,
  entries: readonly AgentActivityEntry[],
): AgentActivityMap {
  const next = { ...previous };
  for (const entry of entries) {
    const key = activityKey(entry);
    const old = next[key];
    if (
      !old ||
      activityKey(old) !== key ||
      old.last_activity_at < entry.last_activity_at
    )
      next[key] = entry;
  }
  return next;
}
