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
  | { status: "failed"; message: string; rolled_back: boolean };

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

export async function requestAgentMove(
  device: OfficePaneDevice,
  desk: OfficeDesk,
  neighbour: OfficePaneDevice,
  split: "right" | "down",
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
        target_pane_id: neighbour.paneRef.nativeId,
        split,
        allow_close_room: allowCloseRoom,
      },
      moveTimeoutMs,
    ),
  );
}

/**
 * Where an agent joins a desk: next to the last pane, across the table when
 * that keeps the desk balanced (an odd number of panes), beside it otherwise.
 */
export function townSeatSplit(desk: OfficeDesk): "right" | "down" {
  return desk.paneDevices.length % 2 === 1 ? "down" : "right";
}
