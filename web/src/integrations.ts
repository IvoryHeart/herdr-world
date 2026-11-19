import { useCallback, useEffect, useRef, useState } from "react";
import { bridge } from "./api";
import {
  INTEGRATION_KINDS,
  INTEGRATION_PROVISIONS,
  INTEGRATION_STATES,
  type IntegrationEntry,
  type IntegrationSetting,
  type IntegrationsSnapshot,
  type VaultStatus,
  WORLD_INTEGRATIONS_PATH,
} from "../../shared/integrations";

export * from "../../shared/integrations";

/**
 * Opens Configuration on Integrations. `focus` names the row to show first
 * (`source:github`, `runtime:<id>`); elements without what they need send it
 * from their Connect button.
 */
export const WORLD_INTEGRATIONS_EVENT = "herdr-world:integrations";
/** An integration changed here: views that read the registry fetch again. */
export const WORLD_INTEGRATIONS_CHANGED_EVENT =
  "herdr-world:integrations-changed";

export type OpenIntegrationsDetail = { focus?: string };

export function openIntegrations(focus?: string): void {
  window.dispatchEvent(
    new CustomEvent<OpenIntegrationsDetail>(WORLD_INTEGRATIONS_EVENT, {
      detail: focus ? { focus } : {},
    }),
  );
}

export function integrationsChanged(): void {
  window.dispatchEvent(new Event(WORLD_INTEGRATIONS_CHANGED_EVENT));
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchIntegrations(
  fetchImpl: FetchLike = fetch,
): Promise<IntegrationsSnapshot> {
  const response = await fetchImpl(WORLD_INTEGRATIONS_PATH, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok)
    throw new Error(`World could not list integrations (${response.status})`);
  return parseIntegrations(await response.json());
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) => (typeof value === "string" ? value : "");
const oneOf = <T extends string>(values: readonly T[], value: unknown) =>
  values.includes(value as T) ? (value as T) : null;

function parseSetting(value: unknown): IntegrationSetting | null {
  const item = record(value);
  if (!item || !text(item.key)) return null;
  const raw = item.value;
  return {
    key: text(item.key),
    label: text(item.label) || text(item.key),
    value:
      typeof raw === "string" ||
      typeof raw === "number" ||
      typeof raw === "boolean"
        ? raw
        : null,
    ...(item.secret === true ? { secret: true as const } : {}),
  };
}

function parseEntry(value: unknown): IntegrationEntry | null {
  const item = record(value);
  if (!item) return null;
  const kind = oneOf(INTEGRATION_KINDS, item.kind);
  const state = oneOf(INTEGRATION_STATES, item.state);
  const control = oneOf(
    ["connection", "source", "skill", "metrics", "none"] as const,
    item.control,
  );
  if (!kind || !state || !control || !text(item.id)) return null;
  const connection = record(item.connection);
  return {
    id: text(item.id),
    kind,
    type: text(item.type),
    label: text(item.label) || text(item.id),
    provides: Array.isArray(item.provides)
      ? item.provides.flatMap((provision) => {
          const known = oneOf(INTEGRATION_PROVISIONS, provision);
          return known ? [known] : [];
        })
      : [],
    state,
    detail: text(item.detail),
    settings: Array.isArray(item.settings)
      ? item.settings.flatMap((setting) => {
          const parsed = parseSetting(setting);
          return parsed ? [parsed] : [];
        })
      : [],
    control,
    ...(connection &&
    text(connection.id) &&
    typeof connection.generation === "number"
      ? {
          connection: {
            id: text(connection.id),
            generation: connection.generation,
            transport: connection.transport === "ssh" ? "ssh" : "local",
            lifecycle:
              oneOf(
                [
                  "disconnected",
                  "connecting",
                  "ready",
                  "reconnecting",
                  "stopping",
                  "error",
                ] as const,
                connection.lifecycle,
              ) ?? "disconnected",
          },
        }
      : {}),
  };
}

function parseVault(value: unknown): VaultStatus {
  const vault = record(value);
  return {
    backend: vault?.backend === "keychain" ? "keychain" : "file",
    label: text(vault?.label) || "Private file",
    detail: text(vault?.detail),
    secrets: Array.isArray(vault?.secrets)
      ? vault.secrets.flatMap((secret) => {
          const item = record(secret);
          return item && text(item.name)
            ? [
                {
                  name: text(item.name),
                  label: text(item.label) || text(item.name),
                  usedBy: text(item.usedBy),
                },
              ]
            : [];
        })
      : [],
  };
}

export function parseIntegrations(value: unknown): IntegrationsSnapshot {
  const snapshot = record(value);
  return {
    observedAt:
      typeof snapshot?.observedAt === "number" ? snapshot.observedAt : 0,
    integrations: Array.isArray(snapshot?.integrations)
      ? snapshot.integrations.flatMap((entry) => {
          const parsed = parseEntry(entry);
          return parsed ? [parsed] : [];
        })
      : [],
    vault: parseVault(snapshot?.vault),
  };
}

/** The registry for a view, fetched on mount and after any change here. */
export function useIntegrations(enabled = true): {
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  refresh(): Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<IntegrationsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await fetchIntegrations();
      if (request !== sequence.current) return;
      setSnapshot(next);
      setError(null);
    } catch (cause) {
      if (request !== sequence.current) return;
      setError(
        cause instanceof Error && cause.message
          ? cause.message
          : "World could not list integrations",
      );
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onChanged = () => void refresh();
    window.addEventListener(WORLD_INTEGRATIONS_CHANGED_EVENT, onChanged);
    // Connection lifecycles change on the service; it says when.
    const stop = bridge.onControl((control) => {
      if (control.type === "world_connections_changed") onChanged();
    });
    return () => {
      sequence.current += 1;
      stop();
      window.removeEventListener(WORLD_INTEGRATIONS_CHANGED_EVENT, onChanged);
    };
  }, [enabled, refresh]);
  return { snapshot, error, refresh };
}
