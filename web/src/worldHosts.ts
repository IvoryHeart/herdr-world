import type { ConnectionLifecycleState, ConnectionSummary } from "./api";
import type { CoreConnectionSummary } from "./coreConnections";
import type { HostGrouping } from "../../shared/hostGrouping";

/** A herdr-core profile as the catalogue keeps it: no observation. */
export type CoreConnectionProfileSummary = Omit<
  CoreConnectionSummary,
  "observation"
>;

/**
 * One host World can show or put work on, whichever runtime serves it. Every
 * "which host?" list and choice reads this one catalogue (`worldHosts`), so a
 * herdr-core connection is a host like any Herdr (TUI) connection. Which
 * machine (host) each runtime stands on is not decided here: World publishes
 * it (`host_grouping` `hosts`, shared/hostGrouping.ts) and every host list
 * and count reads it through `hostGroupOf`. A host is a machine, whatever
 * "Group runtimes" says; that setting only changes Town's buildings.
 */
export type WorldHost = {
  id: string;
  label: string;
  /** Herdr's TUI (`herdr`) or herdr-core (`herdr-core`). */
  runtime: "herdr" | "herdr-core";
  state: ConnectionLifecycleState;
  generation: number;
};

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
    })),
    ...(sources.coreConnections ?? [])
      .filter(({ id }) => !tuiIds.has(id))
      .map((connection) => ({
        id: connection.id,
        label: connection.label,
        runtime: "herdr-core" as const,
        state: connection.state,
        generation: connection.generation,
      })),
  ];
  cached = {
    connections: sources.connections,
    coreConnections: sources.coreConnections,
    hosts,
  };
  return hosts;
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
 * A Hosts filter widened to whole hosts: a selected runtime selects every
 * runtime of its published host (machine), so a selection saved per connection
 * (before #1227) shows its whole group. IDs no group lists are kept as they
 * are. Returns the given list when it already covers its groups.
 */
export function hostsFilterByGroup<Ids extends readonly string[] | null>(
  ids: Ids,
  grouping: Pick<HostGrouping, "hosts"> | undefined,
): Ids {
  if (ids === null) return ids;
  const selected = new Set(ids);
  const added = (grouping?.hosts ?? []).flatMap((group) =>
    group.members.some((member) => selected.has(member.connection_id))
      ? group.members
          .map((member) => member.connection_id)
          .filter((id) => !selected.has(id))
      : [],
  );
  return (added.length ? [...ids, ...added] : ids) as Ids;
}

/** One row of the Hosts list: a published host (machine) and its runtimes. */
export type HostGroupRow = {
  key: string;
  label: string;
  /** Its runtimes the catalogue lists, in published order. */
  ids: string[];
  /** In rows of two or more runtimes, each one's tag ("Herdr TUI", …). */
  runtimes: string[];
  /** Its runtimes' states summarised, e.g. "ready" or "1 of 2 reconnecting". */
  status: string;
};

/**
 * The Hosts list: World's published hosts (machines) in their order, each
 * with its runtimes and their live state. A runtime World has not grouped yet is a row of
 * its own, after them.
 */
export function hostGroupRows(
  hosts: readonly WorldHost[],
  grouping: Pick<HostGrouping, "hosts"> | undefined,
): HostGroupRow[] {
  const byId = new Map(hosts.map((host) => [host.id, host]));
  const grouped = new Set<string>();
  const rows: HostGroupRow[] = [];
  for (const group of grouping?.hosts ?? []) {
    const members = group.members.flatMap((member) => {
      const host = byId.get(member.connection_id);
      return host ? [host] : [];
    });
    for (const member of group.members) grouped.add(member.connection_id);
    if (!members.length) continue;
    rows.push({
      key: group.key,
      label: group.label,
      ids: members.map(({ id }) => id),
      runtimes: members.length > 1 ? runtimeTags(members) : [],
      status: machineStatus(members.map(({ state }) => state)),
    });
  }
  for (const host of hosts)
    if (!grouped.has(host.id))
      rows.push({
        key: `runtime:${host.id}`,
        label: host.label,
        ids: [host.id],
        runtimes: [],
        status: host.state,
      });
  return rows;
}

/** How many published hosts (machines) hold these runtimes. */
export function hostGroupCount(
  ids: readonly string[],
  grouping: Pick<HostGrouping, "hosts"> | undefined,
) {
  const groupOf = hostGroupOf(grouping);
  return new Set(ids.map((id) => groupOf(id)?.key ?? `runtime:${id}`)).size;
}

/** How a runtime reads beside its machine: a room plaque, a navigator row. */
export function runtimeTag(runtime: WorldHost["runtime"]) {
  return runtime === "herdr" ? "Herdr TUI" : runtime;
}

/** How a menu names a host's runtime; Herdr (TUI) hosts read as before. */
export function hostRuntimeLabel(host: Pick<WorldHost, "runtime">) {
  return host.runtime === "herdr" ? null : host.runtime;
}

const groupOfCache = /* @__PURE__ */ new WeakMap<
  Pick<HostGrouping, "hosts">,
  HostGroupOf
>();

/**
 * Each connection's published host (machine), by connection ID: worked out
 * once on the service. A connection no host lists (yet) is a host of its own.
 */
export function hostGroupOf(
  grouping: Pick<HostGrouping, "hosts"> | undefined,
): HostGroupOf {
  if (!grouping) return () => undefined;
  const known = groupOfCache.get(grouping);
  if (known) return known;
  const byId = new Map<string, { key: string; label: string; order: number }>();
  for (const group of grouping.hosts)
    for (const member of group.members)
      byId.set(member.connection_id, {
        key: group.key,
        label: group.label,
        order: byId.size,
      });
  const groupOf: HostGroupOf = (connectionId) => byId.get(connectionId);
  groupOfCache.set(grouping, groupOf);
  return groupOf;
}

/**
 * A connection's group: `hostGroupOf`'s answer, or a test's stand-in.
 * `order` is the connection's place in World's published order (its group's,
 * then its own within the group).
 */
export type HostGroupOf = (
  connectionId: string,
) => { key: string; label: string; order?: number } | undefined;

/** Items in World's published order; those it has not grouped keep theirs, after. */
export function inPublishedOrder<T>(
  items: readonly T[],
  connectionOf: (item: T) => string,
  groupOf: HostGroupOf,
): T[] {
  const order = (item: T) =>
    groupOf(connectionOf(item))?.order ?? Number.POSITIVE_INFINITY;
  return items
    .map((item, index) => ({ item, index, at: order(item) }))
    .sort((a, b) => a.at - b.at || a.index - b.index)
    .map(({ item }) => item);
}

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
 * A view's per-connection items, grouped by their connections' published
 * hosts (machines, `hostGroupOf`), in World's published order. An item
 * whose connection World has not grouped stands alone, after them. The navigator
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
  for (const item of inPublishedOrder(
    items,
    (each) => sourceOf(each).connectionId,
    groupOf,
  )) {
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
    const tags = runtimeTags(sources);
    sources.forEach((source, index) =>
      entry.tags.set(source.connectionId, tags[index]!),
    );
  }
  return [...byKey.values()];
}

/** Each of a machine's runtimes' tags: "Herdr TUI", "herdr-core", … */
function runtimeTags(
  sources: readonly { label: string; runtime?: WorldHost["runtime"] }[],
) {
  const kinds = sources.map(({ runtime }) => runtime ?? "herdr");
  return sources.map((source, index) => {
    const kind = kinds[index]!;
    // Two runtimes of one kind on a machine: their names tell them apart.
    return kinds.filter((each) => each === kind).length > 1
      ? `${runtimeTag(kind)} · ${source.label}`
      : runtimeTag(kind);
  });
}
