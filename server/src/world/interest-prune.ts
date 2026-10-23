import { interestKeyPrefix } from "../../../shared/interest";
import { serverLogger } from "../utils/logger";
import { type BoardStore, goneInterestOps } from "./board-store";

/** Reconcile missed closes whenever a host becomes ready, including startup. */
export async function reconcileReadyInterest(
  board: BoardStore,
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
  board: BoardStore,
  connectionId: string,
  host: {
    call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    isCurrent: () => boolean;
    changed: (revision: number) => void;
  },
): Promise<void> {
  if (!host.isCurrent()) return;
  const prefix = interestKeyPrefix(connectionId);
  const observed = board.get();
  const stored = Object.keys(observed.layout.interest);
  if (!stored.some((key) => key.startsWith(prefix))) return;
  try {
    const listed = (await host.call("pane.list", {})) as { panes?: unknown };
    if (!host.isCurrent() || !Array.isArray(listed?.panes)) return;
    const terminals = new Set<string>();
    for (const pane of listed.panes) {
      const terminal = (pane as { terminal_id?: unknown } | null)?.terminal_id;
      if (typeof terminal !== "string" || !terminal) return;
      terminals.add(terminal);
    }
    // A newer edit (even clearing and restoring the same choice) must never
    // be removed using a listing that predates it.
    if (board.get().revision !== observed.revision)
      return pruneGoneInterest(board, connectionId, host);
    const ops = goneInterestOps(observed, connectionId, terminals);
    if (ops.length) host.changed(board.patch(ops).revision);
  } catch (error) {
    serverLogger.warn("Board could not drop gone terminals' interest", {
      detail: String(error),
    });
  }
}
