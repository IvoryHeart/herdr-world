import type { ConnectionLifecycleState, ConnectionSummary } from "./api";
import type { CoreConnectionSummary } from "./coreConnections";

/** A herdr-core profile as the catalogue keeps it: no observation. */
export type CoreConnectionProfileSummary = Omit<
  CoreConnectionSummary,
  "observation"
>;

/**
 * One host World can show or put work on, whichever runtime serves it. Every
 * "which host?" list and choice reads this one catalogue (`worldHosts`), so a
 * herdr-core connection is a host like any Herdr (TUI) connection.
 */
export type WorldHost = {
  id: string;
  label: string;
  /** Herdr's TUI (`herdr`) or herdr-core (`herdr-core`). */
  runtime: "herdr" | "herdr-core";
  state: ConnectionLifecycleState;
  generation: number;
  /** Equal for profiles of one runtime endpoint, which count as one host. */
  endpoint: string;
  /** A profile World cannot edit, such as the startup configuration's. */
  readOnly?: true;
};

function tuiEndpoint(connection: ConnectionSummary): string {
  if (
    connection.type === "local" &&
    connection.control_socket_path &&
    connection.client_socket_path
  )
    return JSON.stringify([
      "local",
      connection.control_socket_path,
      connection.client_socket_path,
    ]);
  if (
    connection.type === "ssh" &&
    connection.ssh_destination &&
    connection.remote_control_socket_path &&
    connection.remote_client_socket_path
  )
    return JSON.stringify([
      "ssh",
      connection.ssh_destination,
      connection.remote_control_socket_path,
      connection.remote_client_socket_path,
    ]);
  return JSON.stringify(["connection", connection.id]);
}

function coreEndpoint(connection: CoreConnectionProfileSummary): string {
  // One core per (where, state directory, session). An empty state directory
  // is core's own default there, so two such profiles name the same core.
  return JSON.stringify([
    "herdr-core",
    connection.type,
    connection.ssh_destination ?? "",
    connection.core_state_dir,
    connection.core_session,
  ]);
}

type HostSources = {
  connections: readonly ConnectionSummary[];
  coreConnections?: readonly CoreConnectionProfileSummary[];
};

let cached: {
  connections: HostSources["connections"];
  coreConnections: HostSources["coreConnections"];
  hosts: WorldHost[];
} | null = null;

/**
 * Herdr (TUI) hosts first, in catalogue order, then herdr-core hosts. A core
 * ID the TUI catalogue also lists is the TUI's (the service never registers
 * one ID twice; this only keeps the list unique if it ever did).
 */
export function worldHosts(sources: HostSources): WorldHost[] {
  if (
    cached &&
    cached.connections === sources.connections &&
    cached.coreConnections === sources.coreConnections
  )
    return cached.hosts;
  const tuiIds = new Set(sources.connections.map(({ id }) => id));
  const hosts: WorldHost[] = [
    ...sources.connections.map((connection) => ({
      id: connection.id,
      label: connection.label,
      runtime: "herdr" as const,
      state: connection.state,
      generation: connection.generation,
      endpoint: tuiEndpoint(connection),
      ...(connection.read_only ? { readOnly: true as const } : {}),
    })),
    ...(sources.coreConnections ?? [])
      .filter(({ id }) => !tuiIds.has(id))
      .map((connection) => ({
        id: connection.id,
        label: connection.label,
        runtime: "herdr-core" as const,
        state: connection.state,
        generation: connection.generation,
        endpoint: coreEndpoint(connection),
      })),
  ];
  cached = {
    connections: sources.connections,
    coreConnections: sources.coreConnections,
    hosts,
  };
  return hosts;
}

/** Count runtime endpoints once; unidentified connections remain distinct. */
export function hostCount(hosts: readonly Pick<WorldHost, "endpoint">[]) {
  return new Set(hosts.map(({ endpoint }) => endpoint)).size;
}

/** How a menu names a host's runtime; Herdr (TUI) hosts read as before. */
export function hostRuntimeLabel(host: Pick<WorldHost, "runtime">) {
  return host.runtime === "herdr" ? null : host.runtime;
}
