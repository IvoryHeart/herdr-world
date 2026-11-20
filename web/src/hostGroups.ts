import type { WorldHost as HostCatalogueDto } from "../../shared/hosts";
import { worldHosts, type WorldHost } from "./worldHosts";
import type { State } from "./store/types";

/**
 * One machine as the service's host catalogue describes it: this computer or
 * one SSH destination, with the runtimes discovery found there. Runtime
 * connection IDs stay the only operation identities; a host only groups them.
 */
export type HostCatalogueEntry = {
  id: string;
  label: string;
  type: "local" | "ssh";
  sshDestination?: string;
  windows: boolean;
  state: HostCatalogueDto["state"];
  discovery: HostCatalogueDto["discovery"];
  discoveryError?: string;
  connectionIds: string[];
  /** What an empty, successfully discovered host could have installed. */
  installable: { kind: string; label: string }[];
};

const STATES = [
  "ready",
  "degraded",
  "unavailable",
  "empty",
  "disconnected",
] as const;
const DISCOVERY = ["pending", "complete", "error"] as const;

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const text = (value: unknown) =>
  typeof value === "string" && value.length > 0 ? value : null;

function parseHost(value: unknown): HostCatalogueEntry | null {
  const item = record(value);
  const id = text(item?.host_id);
  if (!item || !id) return null;
  const type =
    item.type === "ssh" ? "ssh" : item.type === "local" ? "local" : null;
  const state = STATES.find((each) => each === item.state);
  const discovery = DISCOVERY.find((each) => each === item.discovery);
  if (!type || !state || !discovery) return null;
  const ids = new Set<string>();
  for (const each of Array.isArray(item.connection_ids)
    ? item.connection_ids
    : [])
    if (text(each)) ids.add(each as string);
  for (const runtime of Array.isArray(item.runtimes) ? item.runtimes : []) {
    const runtimeId = text(record(runtime)?.connection_id);
    if (runtimeId) ids.add(runtimeId);
  }
  return {
    id,
    label: text(item.label) ?? text(item.ssh_destination) ?? "Host",
    type,
    ...(type === "ssh" && text(item.ssh_destination)
      ? { sshDestination: item.ssh_destination as string }
      : {}),
    windows: item.remote_platform === "windows",
    state,
    discovery,
    ...(text(item.discovery_error)
      ? { discoveryError: item.discovery_error as string }
      : {}),
    connectionIds: [...ids],
    installable: (Array.isArray(item.installable_runtimes)
      ? item.installable_runtimes
      : []
    ).flatMap((choice) => {
      const kind = text(record(choice)?.kind);
      return kind ? [{ kind, label: text(record(choice)?.label) ?? kind }] : [];
    }),
  };
}

/**
 * The `hosts` of a catalogue reply (`bridge.status`, `connections.list`).
 * `undefined` when the reply has none (an older service says nothing about
 * hosts); unreadable entries are skipped.
 */
export function parseHostCatalogue(
  catalogue: unknown,
): HostCatalogueEntry[] | undefined {
  const value = record(catalogue)?.hosts;
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  return value.flatMap((each) => {
    const host = parseHost(each);
    if (!host || seen.has(host.id)) return [];
    seen.add(host.id);
    return [host];
  });
}

/**
 * One row of every "which host?" list: a machine, with the runtime
 * connections World holds there. `runtimes` is empty for a host where
 * discovery found nothing yet.
 */
export type WorldHostGroup = {
  id: string;
  label: string;
  runtimes: WorldHost[];
  /**
   * The runtime connection IDs World holds on the host (`runtimes`), which
   * the Hosts filter stores; a runtime discovery lost is not among them.
   */
  connectionIds: string[];
  /** Null when the service sent no host catalogue (an older service). */
  entry: HostCatalogueEntry | null;
};

type GroupSources = Pick<State, "connections" | "coreConnections"> & {
  hostCatalogue?: readonly HostCatalogueEntry[];
};

let cached: {
  runtimes: WorldHost[];
  catalogue: GroupSources["hostCatalogue"];
  groups: WorldHostGroup[];
} | null = null;

/**
 * Hosts in the catalogue's order, each with its runtimes. A runtime the
 * catalogue does not place (an older service, or a profile it has not
 * grouped yet) is a host of its own, keyed by its runtime endpoint so two
 * profiles of one endpoint still read as one host.
 */
export function worldHostGroups(sources: GroupSources): WorldHostGroup[] {
  const runtimes = worldHosts(sources);
  if (
    cached &&
    cached.runtimes === runtimes &&
    cached.catalogue === sources.hostCatalogue
  )
    return cached.groups;
  const placed = new Set<string>();
  const groups: WorldHostGroup[] = [];
  for (const entry of sources.hostCatalogue ?? []) {
    const members = new Set(entry.connectionIds);
    const held = runtimes.filter(
      (runtime) => members.has(runtime.id) && !placed.has(runtime.id),
    );
    for (const runtime of held) placed.add(runtime.id);
    groups.push({
      id: entry.id,
      label: entry.label,
      runtimes: held,
      connectionIds: held.map(({ id }) => id),
      entry,
    });
  }
  const byEndpoint = new Map<string, WorldHostGroup>();
  for (const runtime of runtimes) {
    if (placed.has(runtime.id)) continue;
    const existing = byEndpoint.get(runtime.endpoint);
    if (existing) {
      existing.runtimes.push(runtime);
      existing.connectionIds.push(runtime.id);
      continue;
    }
    const group: WorldHostGroup = {
      id: `runtime:${runtime.id}`,
      label: runtime.label,
      runtimes: [runtime],
      connectionIds: [runtime.id],
      entry: null,
    };
    byEndpoint.set(runtime.endpoint, group);
    groups.push(group);
  }
  cached = { runtimes, catalogue: sources.hostCatalogue, groups };
  return groups;
}

/** Herdr (TUI) reads as "Herdr"; other runtimes by their own name. */
export function runtimeName(runtime: Pick<WorldHost, "runtime">) {
  return runtime.runtime === "herdr" ? "Herdr" : runtime.runtime;
}

/**
 * How a host reads in a list: "Ready", "No runtime found", "Looking for
 * runtimes…", or what went wrong.
 */
export function hostStateLabel(group: WorldHostGroup): string {
  const entry = group.entry;
  if (entry?.discovery === "pending" && !group.runtimes.length)
    return "Looking for runtimes…";
  if (entry?.discovery === "error" && !group.runtimes.length)
    return "Could not look for runtimes";
  if (!group.runtimes.length) return "No runtime found";
  const ready = group.runtimes.filter(({ state }) => state === "ready").length;
  if (ready === group.runtimes.length) return "ready";
  if (ready > 0) return `${ready} of ${group.runtimes.length} ready`;
  const states = new Set(group.runtimes.map(({ state }) => state));
  return states.size === 1 ? group.runtimes[0]!.state : "not ready";
}

/**
 * The runtime World works through on a host when nothing says otherwise:
 * the preferred (default or inherited) connection if the host holds it, else
 * its first ready runtime, else its first.
 */
export function primaryRuntime(
  group: Pick<WorldHostGroup, "runtimes">,
  preferredId?: string,
): WorldHost | undefined {
  return (
    group.runtimes.find(({ id }) => id === preferredId) ??
    group.runtimes.find(({ state }) => state === "ready") ??
    group.runtimes[0]
  );
}

/** The host holding a runtime connection, if any group does. */
export function hostOfRuntime(
  groups: readonly WorldHostGroup[],
  connectionId: string,
): WorldHostGroup | undefined {
  return groups.find((group) => group.connectionIds.includes(connectionId));
}
