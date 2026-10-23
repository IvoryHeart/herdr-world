/** A sender is an explicit Herdr claim, never inferred from a target or focus. */
export type NotificationSender =
  | { known: false }
  | { known: true; agent: string };

export function notificationSender(
  agent: string | null | undefined,
): NotificationSender {
  return agent?.trim() ? { known: true, agent } : { known: false };
}

/** Older relays and malformed claims remain unattributed. */
export function parseNotificationSender(value: unknown): NotificationSender {
  if (
    value &&
    typeof value === "object" &&
    "known" in value &&
    value.known === true &&
    "agent" in value &&
    typeof value.agent === "string" &&
    value.agent.trim()
  )
    return { known: true, agent: value.agent };
  return { known: false };
}
