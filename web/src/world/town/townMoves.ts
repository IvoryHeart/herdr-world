/**
 * Town desk and agent moves. The World service runs the move (see
 * server/src/world/desk-move.ts); the browser only asks, on the exact
 * connection and runtime generation that owns the desk.
 */

import { bridge } from "../../api";
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
