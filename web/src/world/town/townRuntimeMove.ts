import { bridge } from "../../api";
import type { AgentAddress } from "../../../../shared/agentMove";
import { tabCardKey } from "../../../../shared/terminalColor";
import type { AgentMoveOutcome } from "../agentMove";
import type { OfficeDesk, OfficeRoom } from "../herdrOfficeProjection";
import type { TownMoveOutcome } from "./townMoves";

import { canMoveDeskToRoom } from "./townMoveEligibility";

export async function requestRuntimeDeskMove(
  desk: OfficeDesk,
  room: OfficeRoom,
  source: { room: OfficeRoom; workspaceIds: readonly string[] } | undefined,
): Promise<TownMoveOutcome> {
  if (!source || !canMoveDeskToRoom(desk, room))
    return {
      status: "refused",
      reason: "unsupported",
      message:
        "Move one Claude or Codex agent at a time from Agent settings → Move to….",
    };
  const pane = desk.paneDevices[0]!;
  const address: AgentAddress = {
    connection_id: desk.tabRef.connectionId,
    generation: desk.tabRef.generation,
    workspace_id: source.room.workspaceRef.nativeId,
    tab_id: desk.tabRef.nativeId,
    pane_id: pane.paneRef.nativeId,
    terminal_id: pane.terminalRef.nativeId,
    color_key: tabCardKey(
      desk.tabRef.connectionId,
      desk.tabRef.nativeId,
      new Set(source.workspaceIds),
    ),
  };
  const result = (await bridge.call(
    "world.agent.move",
    {
      source: address,
      destination: {
        connection_id: room.workspaceRef.connectionId,
        generation: room.workspaceRef.generation,
        workspace_id: room.workspaceRef.nativeId,
      },
    },
    180_000,
  )) as AgentMoveOutcome;
  if (result.status === "moved" && result.target)
    return {
      status: "moved",
      tab_id: result.target.tab_id,
      workspace_id: result.target.workspace_id,
    };
  if (result.status === "refused")
    return {
      status: "refused",
      reason: "agent_not_ready",
      message: result.message,
    };
  return {
    status: "failed",
    message: result.message,
    rolled_back: result.status === "rolled_back",
    topology_known: false,
  };
}
