import type {
  WorldRuntimeConnection,
  WorldRuntimeState,
  WorldRuntimeSnapshot,
} from "./runtimeStore";

export type ObservationBase = {
  service_incarnation: string;
  hosts: {
    connection_id: string;
    generation: number;
    token: string;
  }[];
};
export class MissingObservationBase extends Error {}

export function observationBase(
  state: WorldRuntimeState,
  incarnation: string,
): ObservationBase | undefined {
  if (state.serviceIncarnation !== incarnation) return undefined;
  return {
    service_incarnation: incarnation,
    hosts: state.connections.flatMap((host) =>
      typeof host.token === "string" &&
      host.snapshotGeneration === host.generation
        ? [
            {
              connection_id: host.connectionId,
              generation: host.generation,
              token: host.token,
            },
          ]
        : [],
    ),
  };
}

const metadata = [
  "connectionId",
  "label",
  "source",
  "isDefault",
  "state",
  "generation",
  "snapshotGeneration",
  "stale",
  "actionable",
  "error",
  "snapshotError",
  "token",
] as const;
export function sameObservationHost(
  a: WorldRuntimeConnection,
  b: WorldRuntimeConnection,
) {
  return (
    a.snapshot === b.snapshot && metadata.every((key) => a[key] === b[key])
  );
}

/** Share immutable records only inside the same admitted service/owner generation. */
function shareRecords<T>(next: T[], previous: T[]): T[] {
  const prior = new Map(
    previous.map((value) => [JSON.stringify(value), value]),
  );
  const shared = next.map((value) => prior.get(JSON.stringify(value)) ?? value);
  return shared.length === previous.length &&
    shared.every((value, i) => value === previous[i])
    ? previous
    : shared;
}
function shareSnapshot(
  next: WorldRuntimeSnapshot,
  previous: WorldRuntimeSnapshot,
): WorldRuntimeSnapshot {
  return {
    ...next,
    workspaces: shareRecords(next.workspaces, previous.workspaces),
    tabs: shareRecords(next.tabs, previous.tabs),
    panes: shareRecords(next.panes, previous.panes),
    agents: shareRecords(next.agents, previous.agents),
  };
}

/** A confirmation never creates content; missing retained content resets the whole reply. */
export function decodeObservationHost(
  value: unknown,
  state: WorldRuntimeState,
  incarnation: string,
  base: ObservationBase | undefined,
  decode: (value: unknown) => WorldRuntimeConnection | null,
): WorldRuntimeConnection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (
    !(
      row.token === null ||
      (typeof row.token === "string" &&
        row.token.length > 0 &&
        row.token.length <= 64)
    )
  )
    throw new Error("invalid World observation token");
  const held =
    state.serviceIncarnation === incarnation
      ? state.connections.find(
          (host) => host.connectionId === row.connection_id,
        )
      : undefined;
  let next: WorldRuntimeConnection | null;
  if (row.unchanged === true) {
    const sent = base?.hosts.find(
      (host) => host.connection_id === row.connection_id,
    );
    if (
      Object.prototype.hasOwnProperty.call(row, "snapshot") ||
      !sent ||
      !held?.snapshot ||
      held.token !== row.token ||
      sent.token !== row.token ||
      sent.generation !== row.generation ||
      held.snapshotGeneration !== row.snapshot_generation ||
      sent.generation !== row.snapshot_generation
    )
      throw new MissingObservationBase(
        "World observation base is no longer held",
      );
    next = decode({ ...row, snapshot: null });
    if (next)
      next = { ...next, token: row.token as string, snapshot: held.snapshot };
  } else {
    next = decode(row);
    if (next) {
      next.token = row.token as string | null;
      if (
        held?.snapshot &&
        next.snapshot &&
        held.snapshotGeneration === next.snapshotGeneration
      ) {
        next.snapshot =
          held.token === next.token
            ? held.snapshot
            : shareSnapshot(next.snapshot, held.snapshot);
      }
    }
  }
  if (
    !next ||
    (row.unchanged !== true &&
      (next.token === null) !== (next.snapshot === null))
  )
    throw new Error("invalid World observation host");
  return held && next && sameObservationHost(held, next) ? held : next;
}
