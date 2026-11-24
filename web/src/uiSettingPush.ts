/**
 * One interface preference, pushed when any browser changes it. Carries no
 * connection envelope: preferences belong to the World service, not to a
 * Herdr connection. A null value means the preference was cleared.
 */
export interface UiSettingPush {
  key: string;
  value: unknown;
  /** The service's commit order for UI settings (settings-rpc.ts). */
  revision?: number;
}

export function parseUiSettingPush(value: unknown): UiSettingPush | null {
  if (!value || typeof value !== "object") return null;
  const push = value as Record<string, unknown>;
  if (typeof push.key !== "string" || push.key.length === 0) return null;
  return {
    key: push.key,
    value: push.value ?? null,
    ...(typeof push.revision === "number" ? { revision: push.revision } : {}),
  };
}

/**
 * The bridge's preference push subscribers. Pushes are accepted regardless of
 * the active Herdr connection: the preference belongs to the service that
 * served this page.
 */
export function createUiSettingPushes() {
  const handlers = new Set<(push: UiSettingPush) => void>();
  return {
    subscribe(handler: (push: UiSettingPush) => void): () => void {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
    deliver(value: unknown) {
      const push = parseUiSettingPush(value);
      if (push) for (const handler of handlers) handler(push);
    },
  };
}
