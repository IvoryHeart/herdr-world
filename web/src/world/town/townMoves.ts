/**
 * Town desk and agent moves. The World service runs the move (see
 * server/src/world/desk-move.ts); the browser only asks, on the exact
 * connection and runtime generation that owns the desk.
 */

import { bridge } from "../../api";
import { operationalStore } from "../../store";
import { tabMoveInsertIndex } from "../../tabReorder";
import type { Tab } from "../../types";
import type {
  OfficeDesk,
  OfficePaneDevice,
  OfficeRoom,
} from "../herdrOfficeProjection";

export type TownMoveOutcome =
  | { status: "moved"; tab_id: string; workspace_id: string }
  | { status: "refused"; reason: string; message: string }
  | {
      status: "failed";
      message: string;
      /** True only when every pane was confirmed back where it started. */
      rolled_back: boolean;
      /** False when any pane's location could not be found or read. */
      topology_known?: boolean;
      topology?: { terminal_id: string; pane_id: string; tab_id: string }[];
    };

/** How a move ended, for the drag animation and the notice. */
export type TownMoveResult = "moved" | "returned" | "uncertain";

export function townMoveResult(outcome: TownMoveOutcome): TownMoveResult {
  if (outcome.status === "moved") return "moved";
  return outcome.status === "failed" && !outcome.rolled_back
    ? "uncertain"
    : "returned";
}

/**
 * The notice for a move that did not complete. A failed move that could not
 * be confirmed back must not read as "nothing happened": say where the panes
 * are, or that their locations are unknown.
 */
export function townMoveNotice(
  label: string,
  outcome: TownMoveOutcome,
  sourceTab: string,
): string {
  if (outcome.status === "moved") return `${label} moved`;
  if (outcome.status === "refused" || outcome.rolled_back)
    return `${label} not moved: ${outcome.message}`;
  if (outcome.topology_known === false || !outcome.topology?.length)
    return `${label} may be split between rooms: ${outcome.message} Check both rooms.`;
  const away = outcome.topology.filter(
    (pane) => pane.tab_id !== sourceTab,
  ).length;
  return `${label} was only partly moved: ${away} of ${outcome.topology.length} panes are now outside the original desk. ${outcome.message}`;
}

/** Desks and agents move only within one host and its current runtime. */
const sameOwner = (
  a: { connectionId: string; generation: number },
  b: { connectionId: string; generation: number },
) => a.connectionId === b.connectionId && a.generation === b.generation;

const moveTimeoutMs = 90_000;

function parseOutcome(result: unknown): TownMoveOutcome {
  const value = result as Partial<TownMoveOutcome> & Record<string, unknown>;
  if (
    value?.status === "moved" ||
    value?.status === "refused" ||
    value?.status === "failed"
  )
    return value as TownMoveOutcome;
  return {
    status: "failed",
    message: "The host did not report the move's result.",
    rolled_back: false,
  };
}

export async function requestDeskMove(
  desk: OfficeDesk,
  room: OfficeRoom,
  allowCloseRoom: boolean,
): Promise<TownMoveOutcome> {
  if (!sameOwner(desk.tabRef, room.workspaceRef))
    return {
      status: "refused",
      reason: "other_host",
      message: "Desks move only within one host.",
    };
  const client = bridge.connection(
    desk.tabRef.connectionId,
    desk.tabRef.generation,
  );
  return parseOutcome(
    await client.call(
      "town.move_desk",
      {
        tab_id: desk.tabRef.nativeId,
        workspace_id: room.workspaceRef.nativeId,
        allow_close_room: allowCloseRoom,
      },
      moveTimeoutMs,
    ),
  );
}

/**
 * Herdr's tab.move index that puts `tabId` into `ontoId`'s slot of a room's
 * tab order (or last when `ontoId` is null): null when it is already there,
 * undefined when either tab is not in the order.
 */
export function deskReorderIndex(
  order: readonly string[],
  tabId: string,
  ontoId: string | null,
): number | null | undefined {
  const slot = ontoId === null ? order.length - 1 : order.indexOf(ontoId);
  if (slot < 0 || !order.includes(tabId)) return undefined;
  const next = order.filter((id) => id !== tabId);
  next.splice(slot, 0, tabId);
  return tabMoveInsertIndex(order, tabId, next);
}

/**
 * Reorder a desk within its room: it takes `onto`'s slot, as a tab dragged
 * onto another in Spaces, or goes last when `onto` is null. Town reads the room's order from Herdr, then moves
 * the tab with Spaces' tab.move on the exact connection and runtime
 * generation. Town shows no order of its own: desks move when Herdr's new
 * order arrives.
 */
export async function requestDeskReorder(
  desk: OfficeDesk,
  onto: OfficeDesk | null,
): Promise<TownMoveOutcome> {
  if (
    onto &&
    (!sameOwner(desk.tabRef, onto.tabRef) || desk.roomKey !== onto.roomKey)
  )
    return {
      status: "refused",
      reason: "other_room",
      message: "Desks reorder only within one room.",
    };
  const owner = {
    connectionId: desk.tabRef.connectionId,
    runtimeGeneration: desk.tabRef.generation,
  };
  const listed = (await bridge
    .connection(owner.connectionId, owner.runtimeGeneration)
    .call("tab.list", {})) as { tabs?: Tab[] } | undefined;
  const tabs = listed?.tabs ?? [];
  const tabId = desk.tabRef.nativeId;
  const workspaceId = tabs.find((tab) => tab.tab_id === tabId)?.workspace_id;
  const order = tabs
    .filter((tab) => tab.workspace_id === workspaceId)
    .map((tab) => tab.tab_id);
  const insertIndex = workspaceId
    ? deskReorderIndex(order, tabId, onto?.tabRef.nativeId ?? null)
    : undefined;
  if (!workspaceId || insertIndex === undefined)
    return {
      status: "refused",
      reason: "changed",
      message: "The room changed. Try again.",
    };
  if (insertIndex === null)
    return { status: "moved", tab_id: tabId, workspace_id: workspaceId };
  const operations = operationalStore(owner);
  const result = await operations.moveTab(tabId, insertIndex);
  if (result !== undefined)
    return { status: "moved", tab_id: tabId, workspace_id: workspaceId };
  return {
    status: "refused",
    reason: "tab_move",
    message: operations.get().error ?? "Herdr did not reorder the tab.",
  };
}

/**
 * Move one agent pane to another desk. The service reads the destination's
 * full layout and joins the pane next to its last pane, so crowded desks
 * (more panes than Town draws) land correctly.
 */
export async function requestAgentMove(
  device: OfficePaneDevice,
  desk: OfficeDesk,
  allowCloseRoom: boolean,
): Promise<TownMoveOutcome> {
  if (!sameOwner(device.paneRef, desk.tabRef))
    return {
      status: "refused",
      reason: "other_host",
      message: "Agents move only within one host.",
    };
  const client = bridge.connection(
    device.paneRef.connectionId,
    device.paneRef.generation,
  );
  return parseOutcome(
    await client.call(
      "town.move_pane",
      {
        pane_id: device.paneRef.nativeId,
        tab_id: desk.tabRef.nativeId,
        allow_close_room: allowCloseRoom,
      },
      moveTimeoutMs,
    ),
  );
}
