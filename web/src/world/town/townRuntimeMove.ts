import { bridge } from "../../api";
import type {
  AgentAddress,
  AgentMoveOutcome,
} from "../../../../shared/agentMove";
import { tabCardKey } from "../../../../shared/terminalColor";
import type { BoardTab, BoardWorkspace } from "../board/boardModel";
import type { OfficeDesk } from "../herdrOfficeProjection";
import { canHandoffDesk } from "./townMoveEligibility";
import type { TownMoveOutcome } from "./townMoves";

/** The source address World's service checks before a handoff. */
export function deskAgentAddress(
  desk: OfficeDesk,
  workspaceId: string,
  workspaceIds: readonly string[],
): AgentAddress | null {
  const pane = desk.paneDevices[0];
  if (!pane || !canHandoffDesk(desk)) return null;
  return {
    connection_id: desk.tabRef.connectionId,
    generation: desk.tabRef.generation,
    workspace_id: workspaceId,
    tab_id: desk.tabRef.nativeId,
    pane_id: pane.paneRef.nativeId,
    terminal_id: pane.terminalRef.nativeId,
    color_key: tabCardKey(
      desk.tabRef.connectionId,
      desk.tabRef.nativeId,
      new Set(workspaceIds),
    ),
  };
}

/** A Board card's one agent as a handoff source (its key is its card key). */
export function cardAgentAddress(
  tab: BoardTab,
  workspace: BoardWorkspace,
): AgentAddress | null {
  const [pane, ...more] = tab.panes;
  if (!pane || more.length || !pane.isAgent || pane.leaf.stale) return null;
  return {
    connection_id: workspace.connectionId,
    generation: workspace.generation,
    workspace_id: workspace.nativeId,
    tab_id: tab.nativeId,
    pane_id: pane.leaf.pane.pane_id,
    terminal_id: pane.leaf.terminalId,
    color_key: tab.key,
  };
}

export const workspaceRoom = (workspace: BoardWorkspace) => ({
  workspaceRef: {
    connectionId: workspace.connectionId,
    generation: workspace.generation,
    nativeId: workspace.nativeId,
  },
});

/**
 * Hand an agent to a room on another runtime (world.agent.move): it resumes
 * there and its desk keeps its pin, colour and links.
 */
export async function requestAgentHandoff(
  source: AgentAddress | null,
  room: {
    workspaceRef: {
      connectionId: string;
      generation: number;
      nativeId: string;
    };
  },
  call: typeof bridge.call = bridge.call.bind(bridge),
): Promise<TownMoveOutcome> {
  if (!source)
    return {
      status: "refused",
      reason: "unsupported",
      message: "Only a desk with one agent moves to another runtime.",
    };
  const result = (await call(
    "world.agent.move",
    {
      source,
      destination: {
        connection_id: room.workspaceRef.connectionId,
        generation: room.workspaceRef.generation,
        workspace_id: room.workspaceRef.nativeId,
      },
    },
    180_000,
  )) as AgentMoveOutcome;
  return result.status === "moved"
    ? {
        status: "moved",
        tab_id: result.target.tab_id,
        workspace_id: result.target.workspace_id,
      }
    : result.status === "uncertain"
      ? {
          status: "failed",
          message: result.message,
          rolled_back: false,
          topology_known: false,
        }
      : { status: "refused", reason: "agent_busy", message: result.message };
}
