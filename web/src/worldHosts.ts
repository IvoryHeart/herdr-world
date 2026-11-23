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
  /** Equal for profiles of one runtime endpoint. */
  endpoint: string;
  /**
   * This computer (`local`) or one SSH destination: the machine the runtime
   * runs on. Town's buildings (#1213) and the Hosts filter (#1227) group by it.
   */
  machine: string;
};

function machineOf(
  connection: Pick<ConnectionSummary, "id" | "type" | "ssh_destination">,
) {
  if (connection.type === "local") return "local";
  if (connection.type === "ssh" && connection.ssh_destination)
    return `ssh:${connection.ssh_destination}`;
  // An older catalogue without profile fields: a machine of its own.
  return `connection:${connection.id}`;
}

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
      machine: machineOf(connection),
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
        machine: machineOf(connection),
      })),
  ];
  cached = {
    connections: sources.connections,
    coreConnections: sources.coreConnections,
    hosts,
  };
  return hosts;
}

/** One machine of the Hosts list: every runtime World holds there. */
export type WorldMachine = {
  machine: string;
  /** Its first runtime's name, as Town names the machine's building. */
  label: string;
  /** Its runtimes' connection IDs, in catalogue order. */
  ids: string[];
  /** Its runtimes' states summarised, e.g. "ready" or "1 of 2 reconnecting". */
  status: string;
};

const machinesCache = /* @__PURE__ */ new WeakMap<
  readonly WorldHost[],
  WorldMachine[]
>();

/** The catalogue's machines, in the order their first runtime appears. */
export function worldMachines(hosts: readonly WorldHost[]): WorldMachine[] {
  const cachedMachines = machinesCache.get(hosts);
  if (cachedMachines) return cachedMachines;
  const machines = worldHostGroups(hosts, "machine").map((group) => ({
    machine: group.key,
    label: group.label,
    ids: group.hosts.map(({ id }) => id),
    status: machineStatus(group.hosts.map(({ state }) => state)),
  }));
  machinesCache.set(hosts, machines);
  return machines;
}

/** One state when all runtimes share it, else how many are in each other. */
export function machineStatus(states: readonly ConnectionLifecycleState[]) {
  const counts = new Map<ConnectionLifecycleState, number>();
  for (const state of states) counts.set(state, (counts.get(state) ?? 0) + 1);
  if (counts.size === 1) return states[0]!;
  return [...counts]
    .filter(([state]) => state !== "ready")
    .map(([state, count]) => `${count} of ${states.length} ${state}`)
    .join(", ");
}

/**
 * A Hosts filter widened to whole machines: a selected runtime selects every
 * runtime of its machine, so a selection saved per connection (before #1227)
 * maps to its machine. IDs the catalogue does not list are kept as they are.
 * Returns the given list when it already covers its machines.
 */
export function hostsFilterByMachine<Ids extends readonly string[] | null>(
  ids: Ids,
  hosts: readonly Pick<WorldHost, "id" | "machine">[],
): Ids {
  if (ids === null) return ids;
  const selected = new Set(ids);
  const machines = new Set(
    hosts.filter(({ id }) => selected.has(id)).map(({ machine }) => machine),
  );
  const added = hosts
    .filter(({ id, machine }) => machines.has(machine) && !selected.has(id))
    .map(({ id }) => id);
  return (added.length ? [...ids, ...added] : ids) as Ids;
}

/** Count machines once; unidentified connections remain distinct. */
export function hostCount(hosts: readonly Pick<WorldHost, "machine">[]) {
  return new Set(hosts.map(({ machine }) => machine)).size;
}

/** How a runtime reads beside its machine: a room plaque, a navigator row. */
export function runtimeTag(runtime: WorldHost["runtime"]) {
  return runtime === "herdr" ? "Herdr TUI" : runtime;
}

/** How a menu names a host's runtime; Herdr (TUI) hosts read as before. */
export function hostRuntimeLabel(host: Pick<WorldHost, "runtime">) {
  return host.runtime === "herdr" ? null : host.runtime;
}

/**
 * Which group a runtime stands in under the "Group runtimes" setting
 * (world/runtimeGrouping.ts): its machine, or itself. The one rule every
 * view groups runtimes by: Town's buildings, the navigator and Desk.
 */
export function runtimeGroupKey(
  host: Pick<WorldHost, "id" | "machine">,
  grouping: "machine" | "runtime",
) {
  return grouping === "machine" ? host.machine : `runtime:${host.id}`;
}

/** Runtimes a view shows together under the "Group runtimes" setting. */
export type WorldHostGroup = {
  key: string;
  /** Its first runtime's name, as Town names the machine's building. */
  label: string;
  /** Its runtimes, in catalogue order. */
  hosts: WorldHost[];
};

const groupsCache = /* @__PURE__ */ new WeakMap<
  readonly WorldHost[],
  Partial<Record<"machine" | "runtime", WorldHostGroup[]>>
>();

/** The catalogue's groups, in the order their first runtime appears. */
export function worldHostGroups(
  hosts: readonly WorldHost[],
  grouping: "machine" | "runtime",
): WorldHostGroup[] {
  const cachedGroups = groupsCache.get(hosts) ?? {};
  const known = cachedGroups[grouping];
  if (known) return known;
  const byKey = new Map<string, WorldHost[]>();
  for (const host of hosts) {
    const key = runtimeGroupKey(host, grouping);
    byKey.set(key, [...(byKey.get(key) ?? []), host]);
  }
  const groups = [...byKey].map(([key, members]) => ({
    key,
    label: members[0]!.label,
    hosts: members,
  }));
  groupsCache.set(hosts, { ...cachedGroups, [grouping]: groups });
  return groups;
}

/**
 * Each connection's group, by connection ID. A connection the catalogue does
 * not list (yet) is a group of its own.
 */
export function hostGroupOf(
  hosts: readonly WorldHost[],
  grouping: "machine" | "runtime",
): (connectionId: string) => WorldHostGroup | undefined {
  const byId = new Map<string, WorldHostGroup>();
  for (const group of worldHostGroups(hosts, grouping))
    for (const host of group.hosts) byId.set(host.id, group);
  return (connectionId) => byId.get(connectionId);
}

/** A connection's group: `hostGroupOf`'s answer, or a test's stand-in. */
export type HostGroupOf = (
  connectionId: string,
) => Pick<WorldHostGroup, "key" | "label"> | undefined;

/** A view's items (navigator hosts, Board zones) in one runtime group. */
export type RuntimeGroup<T> = {
  key: string;
  label: string;
  members: T[];
  /**
   * In groups of two or more, each member's runtime tag by connection ID:
   * "Herdr TUI", "herdr-core", or with its name when two share a kind.
   */
  tags: Map<string, string>;
};

/**
 * A view's per-connection items, grouped as World's "Group runtimes" setting
 * groups their connections (`hostGroupOf`), in first-seen order. An item
 * whose connection the catalogue does not list stands alone. The navigator
 * and Board both group through this, so they never disagree.
 */
export function groupByRuntime<T>(
  items: readonly T[],
  sourceOf: (item: T) => {
    connectionId: string;
    label: string;
    runtime?: WorldHost["runtime"];
  },
  groupOf: HostGroupOf,
): RuntimeGroup<T>[] {
  const byKey = new Map<string, RuntimeGroup<T>>();
  for (const item of items) {
    const source = sourceOf(item);
    const group = groupOf(source.connectionId);
    const key = group?.key ?? `runtime:${source.connectionId}`;
    const entry = byKey.get(key) ?? {
      key,
      label: group?.label ?? source.label,
      members: [],
      tags: new Map<string, string>(),
    };
    entry.members.push(item);
    byKey.set(key, entry);
  }
  for (const entry of byKey.values()) {
    if (entry.members.length < 2) continue;
    const sources = entry.members.map(sourceOf);
    const kinds = sources.map(({ runtime }) => runtime ?? "herdr");
    sources.forEach((source, index) => {
      const kind = kinds[index]!;
      // Two runtimes of one kind on a machine: their names tell them apart.
      entry.tags.set(
        source.connectionId,
        kinds.filter((each) => each === kind).length > 1
          ? `${runtimeTag(kind)} · ${source.label}`
          : runtimeTag(kind),
      );
    });
  }
  return [...byKey.values()];
}
