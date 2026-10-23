/** Server-relayed Herdr SemanticNotification (`herdr-world.task_notification`). */
export interface HerdrTaskNotification {
  sessionIdentityUnavailable?: true;
  agentSessionId?: string;
  /** `message`: a Herdr custom notification for the owner ("for you"). */
  kind: "completed" | "blocked" | "message";
  /** Herdr's agent label; absent when Herdr named none. */
  agent: string;
  agentKnown?: boolean;
  title: string;
  body: string | null;
  workspaceId: string | null;
  paneId: string | null;
}

function optionalEventText(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function parseHerdrTaskNotification(
  data: Record<string, unknown>,
): HerdrTaskNotification | null {
  const kind = data.kind;
  const title = optionalEventText(data.title);
  if (
    (kind !== "completed" && kind !== "blocked" && kind !== "message") ||
    !title
  )
    return null;
  return {
    kind,
    agent: optionalEventText(data.agent) ?? "Agent",
    ...(optionalEventText(data.agent) ? { agentKnown: true } : {}),
    title,
    body: optionalEventText(data.body),
    workspaceId: optionalEventText(data.workspace_id),
    paneId: optionalEventText(data.pane_id),
    ...(data.session_identity_unavailable === true
      ? { sessionIdentityUnavailable: true as const }
      : {}),
    ...(optionalEventText(data.agent_session_id)
      ? { agentSessionId: optionalEventText(data.agent_session_id)! }
      : {}),
  };
}
