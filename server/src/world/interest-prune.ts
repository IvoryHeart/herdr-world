import { planBoardPatch } from "./board-plan";
import { interestKeyPrefix } from "../../../shared/interest";
import { bindingListingAbsent } from "./binding-resolution";
import { bindingPaneTerminals } from "./binding-pane-list";
import { serverLogger } from "../utils/logger";
import type { BoardDocument, BoardOp, BoardStorePort } from "./board-store";

/** Reconcile missed closes whenever a host becomes ready, including startup. */
export async function reconcileReadyInterest(
  board: BoardStorePort,
  lease: {
    connectionId: string;
    runtime: {
      herdr: {
        call(
          method: string,
          params: Record<string, unknown>,
          timeoutMs: number,
        ): Promise<unknown>;
      };
    };
    isCurrent(): boolean;
  } | null,
  changed: (revision: number) => void,
) {
  if (!lease) return;
  await pruneGoneInterest(board, lease.connectionId, {
    call: (method, params) => lease.runtime.herdr.call(method, params, 10_000),
    isCurrent: lease.isCurrent,
    changed,
  });
}

/** Herdr events after which a terminal may be gone. */
const CLOSING_EVENTS = new Set([
  "pane.closed",
  "tab.closed",
  "workspace.closed",
]);

export const closesTerminals = (eventName: string | null | undefined) =>
  CLOSING_EVENTS.has(eventName?.replaceAll("_", ".") ?? "");

/**
 * Drop a host's mute and focus records for terminals that are gone. Only a
 * complete pane listing from the host's current runtime counts: a failed call,
 * a pane without a terminal ID or a runtime that changed meanwhile keeps every
 * record. `changed` gets the board's new revision when something was dropped.
 */
export async function pruneGoneInterest(
  board: BoardStorePort,
  connectionId: string,
  host: {
    call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    isCurrent: () => boolean;
    changed: (revision: number) => void;
  },
  attempts = 3,
): Promise<void> {
  const prefix = interestKeyPrefix(connectionId);
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!host.isCurrent()) return;
    const observed = board.get();
    const stored = Object.keys(observed.layout.interest);
    if (!stored.some((key) => key.startsWith(prefix))) return;
    try {
      // One complete, unpaged listing from the current runtime.
      const listed = (await host.call("pane.list", {})) as { panes?: unknown };
      if (!host.isCurrent() || !Array.isArray(listed?.panes)) return;
      const terminals = bindingPaneTerminals(listed.panes);
      if (!terminals) return;
      const ops = goneInterestOps(observed, connectionId, terminals);
      if (!ops.length) return;
      // A newer edit (even clearing and restoring the same choice) is never
      // removed using a listing that predates it: list again instead.
      const saved = await board.patchIf(
        observed.revision,
        planBoardPatch([ops], () => (host.isCurrent() ? ops : null)),
      );
      if (saved) return host.changed(saved.revision);
    } catch (error) {
      serverLogger.warn("Board could not drop gone terminals' interest", {
        detail: String(error),
      });
      return;
    }
  }
}

/**
 * Interest records for one host whose terminals are gone. `terminals` must be
 * every terminal of a fresh, complete listing from the host's current
 * runtime; a failed or stale host keeps its records, so pass nothing then.
 */
export function goneInterestOps(
  document: BoardDocument,
  connectionId: string,
  terminals: ReadonlySet<string>,
): BoardOp[] {
  const prefix = interestKeyPrefix(connectionId);
  return Object.keys(document.layout.interest)
    .filter(
      (key) =>
        key.startsWith(prefix) &&
        bindingListingAbsent("interest", [key.slice(prefix.length)], terminals),
    )
    .map((key) => ({ op: "interest.set", key, interest: null }));
}
