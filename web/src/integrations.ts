import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bridge } from "./api";
import {
  INTEGRATION_KIND_LABELS,
  INTEGRATION_KINDS,
  INTEGRATION_PROVISION_LABELS,
  INTEGRATION_PROVISIONS,
  INTEGRATION_STATE_LABELS,
  INTEGRATION_STATES,
  type IntegrationEntry,
  type IntegrationSetting,
  type IntegrationsSnapshot,
  sourceEntry,
  type VaultStatus,
  WORLD_INTEGRATIONS_PATH,
} from "../../shared/integrations";
import type { WorldSourcesSnapshot } from "../../shared/worldSources";
import { useWorldSources } from "./world/worldSources";

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

type IntegrationHosts = NonNullable<IntegrationsSnapshot["hosts"]>;

const choices = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((choice) => {
        const item = record(choice);
        return item && text(item.kind)
          ? [
              {
                kind: text(item.kind),
                label: text(item.label) || text(item.kind),
              },
            ]
          : [];
      })
    : [];

/** Each machine's runtimes and the runtimes it could add (`available_runtimes`). */
function parseHosts(value: unknown): IntegrationHosts | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((each) => {
    const host = record(each);
    if (!host || !text(host.host_id)) return [];
    return [
      {
        host_id: text(host.host_id),
        label: text(host.label) || text(host.host_id),
        runtimes: Array.isArray(host.runtimes)
          ? host.runtimes.flatMap((runtime) => {
              const item = record(runtime);
              return item && text(item.connection_id)
                ? [
                    {
                      connection_id: text(item.connection_id),
                      kind: text(item.kind),
                      version: text(item.version) || null,
                      installed: item.installed !== false,
                      state: text(item.state),
                      generation:
                        typeof item.generation === "number"
                          ? item.generation
                          : 0,
                    },
                  ]
                : [];
            })
          : [],
        available_runtimes: choices(host.available_runtimes),
      },
    ];
  });
}

export function parseIntegrations(value: unknown): IntegrationsSnapshot {
  const snapshot = record(value);
  const hosts = parseHosts(snapshot?.hosts);
  return {
    ...(hosts ? { hosts } : {}),
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

/**
 * Source rows follow the shared source snapshot. The service refreshes a
 * source on its own schedule, so a refresh that finishes (or fails) after the
 * registry was read reaches the open screen without another registry request.
 * An unloaded source snapshot (`observedAt` 0) leaves the registry's rows.
 */
export function withLiveSources(
  snapshot: IntegrationsSnapshot,
  sources: WorldSourcesSnapshot,
): IntegrationsSnapshot {
  if (!sources.observedAt || !sources.sources.length) return snapshot;
  let changed = false;
  const integrations = snapshot.integrations.map((entry) => {
    if (entry.kind !== "source" || entry.control !== "source") return entry;
    const status = sources.sources.find((source) => source.id === entry.type);
    if (!status) return entry;
    changed = true;
    return sourceEntry(status);
  });
  return changed ? { ...snapshot, integrations } : snapshot;
}

/**
 * The registry for a view, fetched on mount and after any change here; its
 * source rows track the live source snapshot (see `withLiveSources`).
 */
export function useIntegrations(enabled = true): {
  snapshot: IntegrationsSnapshot | null;
  error: string | null;
  refresh(): Promise<void>;
} {
  const [listed, setSnapshot] = useState<IntegrationsSnapshot | null>(null);
  const sources = useWorldSources();
  const snapshot = useMemo(
    () => (listed ? withLiveSources(listed, sources) : null),
    [listed, sources],
  );
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

/** The lower-case words of a search box; none when it is blank. */
export function searchTerms(query: string): string[] {
  return query.toLowerCase().split(/\s+/u).filter(Boolean);
}

/** Every search word appears somewhere in the texts; no words match all. */
export function matchesTerms(
  terms: readonly string[],
  texts: readonly (string | undefined)[],
): boolean {
  if (!terms.length) return true;
  const haystack = texts.join(" ").toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * The Integrations search: a row matches on its name, type, kind, status,
 * detail, transport and what it gives World, so "error", "ssh" or "tickets"
 * narrow a long list as well as a name does.
 */
export function integrationMatches(
  entry: IntegrationEntry,
  terms: readonly string[],
): boolean {
  return matchesTerms(terms, [
    entry.label,
    entry.type,
    entry.detail,
    INTEGRATION_KIND_LABELS[entry.kind],
    INTEGRATION_STATE_LABELS[entry.state],
    entry.connection?.transport,
    ...entry.provides.map(
      (provision) => INTEGRATION_PROVISION_LABELS[provision],
    ),
  ]);
}
