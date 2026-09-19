/**
 * Extracts the Herdr event name from a subscription envelope. Herdr emits
 * `{ event, data }` where `data.type` mirrors the event name, so accept both.
 */
export function herdrEventName(event: unknown): string | null {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const envelope = event as {
    event?: unknown;
    data?: unknown;
  };
  if (typeof envelope.event === "string" && envelope.event) {
    return envelope.event;
  }
  const data = envelope.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const type = (data as { type?: unknown }).type;
    if (typeof type === "string" && type) return type;
  }
  return null;
}
