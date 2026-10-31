import { planBoardPatch } from "./board-plan";
import type { BoardDocument, BoardOp, BoardStorePort } from "./board-store";
import type { WorldSnapshotResult } from "./snapshot";
import { bindingListingAbsent } from "./binding-resolution";
import { bindingPaneTerminals } from "./binding-pane-list";
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
function absentOps(
  document: BoardDocument,
  connectionId: string,
  seen: ReadonlySet<string>,
): BoardOp[] {
  const keys = Object.entries(document.appearance ?? {})
    .filter(
      ([, entry]) =>
        entry.connection_id === connectionId &&
        bindingListingAbsent("appearance", entry.witness, seen),
    )
    .map(([key]) => key);
  return keys.length ? [{ op: "appearance.prune", keys }] : [];
}
/** Propose absence candidates; cached snapshots alone cannot authorize deletion. */
export function snapshotAppearancePruneOps(
  document: BoardDocument,
  result: WorldSnapshotResult,
  isCurrent: (connectionId: string, generation: number) => boolean,
): BoardOp[] {
  const perConnection = result.connections.flatMap((connection): BoardOp[] => {
    const snapshot = connection.snapshot;
    if (
      !snapshot ||
      connection.stale ||
      !connection.actionable ||
      connection.state !== "ready" ||
      connection.snapshot_generation !== connection.generation ||
      !isCurrent(connection.connection_id, connection.generation) ||
      snapshot.coverage.panes !== snapshot.panes.length ||
      snapshot.coverage.tabs !== snapshot.tabs.length ||
      snapshot.coverage.workspaces !== snapshot.workspaces.length
    )
      return [];
    const seen = bindingPaneTerminals(snapshot.panes);
    return seen ? absentOps(document, connection.connection_id, seen) : [];
  });
  const keys = perConnection.flatMap((op) =>
    op.op === "appearance.prune" ? op.keys : [],
  );
  return keys.length ? [{ op: "appearance.prune", keys }] : [];
}

type AppearanceReadHost = {
  call(method: string, params: Record<string, unknown>): Promise<unknown>;
  isCurrent(): boolean;
};
const pendingSnapshots = new WeakSet<BoardStorePort>();

/** One background sweep per store preserves the aggregate snapshot response deadline. */
export async function pruneSnapshotAppearance(
  board: BoardStorePort,
  before: BoardDocument,
  snapshot: WorldSnapshotResult,
  hostFor: (
    connectionId: string,
    generation: number,
  ) => AppearanceReadHost | null,
  changed: (revision: number) => void,
): Promise<void> {
  if (pendingSnapshots.has(board)) return;
  const hosts = new Map<string, AppearanceReadHost>();
  const proposed = snapshotAppearancePruneOps(
    before,
    snapshot,
    (id, generation) => {
      const host = hostFor(id, generation);
      if (!host || !host.isCurrent()) return false;
      hosts.set(id, host);
      return true;
    },
  );
  if (!proposed.length) return;
  const candidates = new Set(
    proposed.flatMap((op) => (op.op === "appearance.prune" ? op.keys : [])),
  );
  pendingSnapshots.add(board);
  try {
    const keys: string[] = [];
    for (const [connectionId, host] of hosts) {
      if (
        ![...candidates].some(
          (key) => before.appearance?.[key]?.connection_id === connectionId,
        )
      )
        continue;
      const seen = await currentTerminals(host);
      if (!seen) continue;
      for (const op of absentOps(before, connectionId, seen)) {
        if (op.op === "appearance.prune")
          keys.push(...op.keys.filter((key) => candidates.has(key)));
      }
    }
    const current = new Set(
      [...hosts].filter(([, host]) => host.isCurrent()).map(([id]) => id),
    );
    const admitted = keys.filter((key) =>
      current.has(before.appearance![key]!.connection_id),
    );
    if (!admitted.length) return;
    const saved = await board.patchIf(
      before.revision,
      planBoardPatch([before, admitted], () => {
        const keys = admitted.filter((key) =>
          hosts.get(before.appearance![key]!.connection_id)?.isCurrent(),
        );
        return keys.length ? [{ op: "appearance.prune", keys }] : null;
      }),
    );
    if (saved) changed(saved.revision);
  } finally {
    pendingSnapshots.delete(board);
  }
}

async function currentTerminals(
  host: AppearanceReadHost,
): Promise<Set<string> | null> {
  if (!host.isCurrent()) return null;
  let result: unknown;
  try {
    result = await host.call("pane.list", {});
  } catch {
    return null;
  }
  return host.isCurrent() && record(result)
    ? bindingPaneTerminals(result.panes)
    : null;
}
/** A live complete native list proves terminal absence; a moving terminal remains retained. */
export async function pruneGoneAppearance(
  board: BoardStorePort,
  connectionId: string,
  host: {
    call(method: string, params: Record<string, unknown>): Promise<unknown>;
    isCurrent(): boolean;
    changed(revision: number): void;
  },
): Promise<void> {
  const before = board.get();
  if (
    !Object.values(before.appearance ?? {}).some(
      (entry) => entry.connection_id === connectionId,
    ) ||
    !host.isCurrent()
  )
    return;
  const seen = await currentTerminals(host);
  if (!seen || !host.isCurrent()) return;
  const ops = absentOps(before, connectionId, seen);
  if (!ops.length) return;
  const saved = await board.patchIf(
    before.revision,
    planBoardPatch([ops], () => (host.isCurrent() ? ops : null)),
  );
  if (saved) host.changed(saved.revision);
}
