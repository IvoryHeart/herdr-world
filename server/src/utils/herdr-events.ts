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

const PANE_REPAINT_FIELDS = new Set([
  "revision",
  "terminal_title",
  "terminal_title_stripped",
  "scroll",
]);

function canonicalPaneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalPaneValue);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, canonicalPaneValue(record[key])]),
  );
}

/** Compare consecutive payloads per pane, forgetting them across event gaps. */
export function createPaneActivityClassifier() {
  const previousByPane = new Map<string, string>();
  return {
    classify(event: unknown): "activity" | undefined {
      const name = herdrEventName(event);
      const pane =
        name === "pane_updated" || name === "pane.updated"
          ? (event as { data?: { pane?: unknown } }).data?.pane
          : undefined;
      if (!pane || typeof pane !== "object" || Array.isArray(pane)) {
        previousByPane.clear();
        return;
      }
      const payload = pane as Record<string, unknown>;
      const paneId = payload.pane_id;
      if (typeof paneId !== "string" || !paneId) {
        previousByPane.clear();
        return;
      }
      // Include unknown fields so future semantic changes remain fail-closed.
      const signature = JSON.stringify(
        Object.keys(payload)
          .filter((key) => !PANE_REPAINT_FIELDS.has(key))
          .sort()
          // Herdr's nested metadata maps have no stable serialization order.
          .map((key) => [key, canonicalPaneValue(payload[key])]),
      );
      const previous = previousByPane.get(paneId);
      previousByPane.set(paneId, signature);
      return previous === signature ? "activity" : undefined;
    },
    reset() {
      previousByPane.clear();
    },
  };
}
