/**
 * Herdr's own order of a host's workspaces (rooms) and of a workspace's tabs
 * (desks), shared by Town and Board. Each move first reads the order from
 * Herdr, then asks Herdr to move on the exact connection and runtime
 * generation that owns the workspace or tab. No view keeps an order of its
 * own: Town's desks and Spaces' lists move when Herdr's new order arrives.
 */

import { bridge } from "../api";
import { operationalStore } from "../store";
import { deskReorderIndex } from "../../../shared/tabOrder";
import type { Tab, Workspace } from "../types";

/** The connection and runtime generation that own what moves. */
export type HerdrOrderOwner = { connectionId: string; generation: number };

export type HerdrOrderOutcome =
  | { status: "moved" }
  | { status: "refused"; reason: string; message: string };

export type HerdrTabOrderOutcome =
  | { status: "moved"; tab_id: string; workspace_id: string }
  | { status: "refused"; reason: string; message: string };

/**
 * The workspace.move calls that put `ids` (in that order) in Herdr's order
 * (`order`), leaving other workspaces where they are. Herdr inserts before
 * the workspace at `insert_index`, counted before removal, as tab.move does.
 * Undefined when one of `ids` is not in Herdr's order.
 */
export function herdrWorkspaceOrderMoves(
  order: readonly string[],
  ids: readonly string[],
): { workspace_id: string; insert_index: number }[] | undefined {
  if (ids.some((id) => !order.includes(id))) return undefined;
  const target = [...order];
  order
    .map((id, index) => (ids.includes(id) ? index : -1))
    .filter((index) => index >= 0)
    .forEach((slot, n) => (target[slot] = ids[n]!));
  const current = [...order];
  const moves: { workspace_id: string; insert_index: number }[] = [];
  target.forEach((id, index) => {
    if (current[index] === id) return;
    // Every workspace before `index` is already in place, so this one is
    // after it: inserting before the one at `index` puts it there.
    current.splice(current.indexOf(id), 1);
    current.splice(index, 0, id);
    moves.push({ workspace_id: id, insert_index: index });
  });
  return moves;
}

/**
 * The neighbour `id` changes places with when it moves one place earlier
 * (-1) or later (1) in `order`: null at either end, undefined when `id` is
 * not in the order.
 */
export function herdrOrderNeighbor(
  order: readonly string[],
  id: string,
  step: -1 | 1,
): string | null | undefined {
  const at = order.indexOf(id);
  if (at < 0) return undefined;
  return order[at + step] ?? null;
}

const CHANGED = (what: string): HerdrOrderOutcome => ({
  status: "refused",
  reason: "changed",
  message: `${what} changed. Try again.`,
});

async function herdrWorkspaceOrder(owner: HerdrOrderOwner) {
  const client = bridge.connection(owner.connectionId, owner.generation);
  const listed = (await client.call("workspace.list", {})) as
    | { workspaces?: Workspace[] }
    | undefined;
  return {
    client,
    order: [...(listed?.workspaces ?? [])]
      .sort((a, b) => a.number - b.number)
      .map((workspace) => workspace.workspace_id),
  };
}

/**
 * Put a host's workspaces `ids` in that order in Herdr, leaving its other
 * workspaces where they are.
 */
export async function requestWorkspaceOrder(
  owner: HerdrOrderOwner,
  ids: readonly string[],
): Promise<HerdrOrderOutcome> {
  if (!ids.length) return { status: "moved" };
  const { client, order } = await herdrWorkspaceOrder(owner);
  const moves = herdrWorkspaceOrderMoves(order, ids);
  if (!moves) return CHANGED("The building");
  for (const move of moves) await client.call("workspace.move", move);
  return { status: "moved" };
}

/**
 * Move one workspace a place earlier or later in Herdr's order: it changes
 * places with its neighbour there. Resolves with the neighbour it passed.
 */
export async function requestWorkspaceStep(
  owner: HerdrOrderOwner,
  workspaceId: string,
  step: -1 | 1,
): Promise<HerdrOrderOutcome & { neighbor?: string }> {
  const { client, order } = await herdrWorkspaceOrder(owner);
  const neighbor = herdrOrderNeighbor(order, workspaceId, step);
  if (neighbor === undefined) return CHANGED("The host's rooms");
  if (neighbor === null)
    return {
      status: "refused",
      reason: "edge",
      message: `It is already ${step < 0 ? "first" : "last"} in Herdr.`,
    };
  const ids = order.filter((id) => id === workspaceId || id === neighbor);
  const moves = herdrWorkspaceOrderMoves(order, [...ids].reverse())!;
  for (const move of moves) await client.call("workspace.move", move);
  return { status: "moved", neighbor };
}

const TAB_MOVE_UNSUPPORTED: HerdrTabOrderOutcome = {
  status: "refused",
  reason: "tab_move_unsupported",
  message: "This host's Herdr cannot reorder tabs. Herdr 0.7.2 or later can.",
};

/**
 * Reorder a tab within its workspace: it takes the slot of the tab `onto`
 * picks from the workspace's current order (as a tab dragged onto another in
 * Spaces), or goes last when it picks null. Herdr's order is read first,
 * then the tab moves with Spaces' tab.move.
 */
async function reorderTab(
  owner: HerdrOrderOwner,
  tabId: string,
  onto: (order: readonly string[]) => string | null | undefined,
): Promise<HerdrTabOrderOutcome> {
  const runtime = {
    connectionId: owner.connectionId,
    runtimeGeneration: owner.generation,
  };
  const operations = operationalStore(runtime);
  const observed = operations.get();
  if (observed.lastRefresh > 0 && !observed.tabMoveSupported)
    return TAB_MOVE_UNSUPPORTED;
  const listed = (await bridge
    .connection(owner.connectionId, owner.generation)
    .call("tab.list", {})) as
    | { tabs?: Tab[]; tab_move_supported?: boolean }
    | undefined;
  if (listed?.tab_move_supported === false) return TAB_MOVE_UNSUPPORTED;
  const tabs = listed?.tabs ?? [];
  const workspaceId = tabs.find((tab) => tab.tab_id === tabId)?.workspace_id;
  const order = tabs
    .filter((tab) => tab.workspace_id === workspaceId)
    .map((tab) => tab.tab_id);
  const ontoId = workspaceId ? onto(order) : undefined;
  const insertIndex =
    workspaceId && ontoId !== undefined
      ? deskReorderIndex(order, tabId, ontoId)
      : undefined;
  if (!workspaceId || insertIndex === undefined)
    return CHANGED("The room") as HerdrTabOrderOutcome;
  if (insertIndex === null)
    return { status: "moved", tab_id: tabId, workspace_id: workspaceId };
  const result = await operations.moveTab(tabId, insertIndex);
  if (result !== undefined)
    return { status: "moved", tab_id: tabId, workspace_id: workspaceId };
  return {
    status: "refused",
    reason: "tab_move",
    message: operations.get().error ?? "Herdr did not reorder the tab.",
  };
}

/** A tab takes `ontoId`'s slot in its workspace, or goes last when null. */
export function requestTabReorder(
  owner: HerdrOrderOwner,
  tabId: string,
  ontoId: string | null,
) {
  return reorderTab(owner, tabId, () => ontoId);
}

/**
 * Move a tab one place earlier or later in its workspace's order in Herdr:
 * it takes its neighbour's slot. Refused at either end.
 */
export async function requestTabStep(
  owner: HerdrOrderOwner,
  tabId: string,
  step: -1 | 1,
): Promise<HerdrTabOrderOutcome> {
  let edge = false;
  const outcome = await reorderTab(owner, tabId, (order) => {
    const neighbor = herdrOrderNeighbor(order, tabId, step);
    if (neighbor === null) edge = true;
    return neighbor ?? undefined;
  });
  return edge
    ? {
        status: "refused",
        reason: "edge",
        message: `It is already ${step < 0 ? "first" : "last"} in Herdr.`,
      }
    : outcome;
}
