import type { WorldObject } from "./worldObject";
import { inPublishedOrder, type HostGroupOf } from "../worldHosts";

/** A connection's group under "Group runtimes" (worldHosts.ts `hostGroupOf`). */
export type DeskHostGroupOf = HostGroupOf;

type Elsewhere = {
  /** The group's key: a machine, or one runtime (worldHosts.ts). */
  key: string;
  /** The group's runtimes that have agents here, in published order. */
  connectionIds: string[];
  label: string;
  stale: boolean;
  needs: number;
  done: number;
  working: number;
};

/**
 * Desk's own host label: the one host, as "Group runtimes" groups them (a
 * machine's runtimes count once, or each runtime apart), else "N hosts".
 */
export function deskHostLabel(
  world: WorldObject,
  groupOf: DeskHostGroupOf,
): string | undefined {
  const groups = new Map(
    world.hosts.map((host) => {
      const group = groupOf(host.connectionId);
      return [group?.key ?? `runtime:${host.connectionId}`, group] as const;
    }),
  );
  return groups.size === 1
    ? ([...groups.values()][0]?.label ?? world.hosts[0]?.label)
    : `${groups.size} hosts`;
}

/**
 * Read-only summaries of managed hosts other than the selected one, one per
 * group of World's "Group runtimes" setting: a machine's runtimes together,
 * or each runtime apart. Without `groupOf` each connection is its own.
 */
export function otherHostSummaries(
  world: WorldObject,
  filtered?: WorldObject,
  groupOf: DeskHostGroupOf = () => undefined,
): Elsewhere[] {
  const included = filtered
    ? new Set(filtered.hosts.map((host) => host.connectionId))
    : null;
  const hosts = new Map<string, Elsewhere>();
  for (const leaf of inPublishedOrder(
    world.leaves,
    (each) => each.connectionId,
    groupOf,
  )) {
    if (
      leaf.kind !== "agent" ||
      (included ? included.has(leaf.connectionId) : leaf.selectedHost)
    )
      continue;
    const group = groupOf(leaf.connectionId);
    const key = group?.key ?? `runtime:${leaf.connectionId}`;
    const host = hosts.get(key) ?? {
      key,
      connectionIds: [],
      label: group?.label ?? leaf.hostLabel,
      stale: false,
      needs: 0,
      done: 0,
      working: 0,
    };
    if (!host.connectionIds.includes(leaf.connectionId))
      host.connectionIds.push(leaf.connectionId);
    host.stale ||= leaf.stale;
    if (leaf.status === "blocked") host.needs += 1;
    else if (leaf.status === "done") host.done += 1;
    else if (leaf.status === "working") host.working += 1;
    hosts.set(key, host);
  }
  return [...hosts.values()];
}
