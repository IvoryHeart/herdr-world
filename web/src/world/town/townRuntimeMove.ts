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

/** A Board card's one terminal as a handoff source (its key is its card key). */
export function cardAgentAddress(
  tab: BoardTab,
  workspace: BoardWorkspace,
): AgentAddress | null {
  const [pane, ...more] = tab.panes;
  if (!pane || more.length || pane.leaf.stale) return null;
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
 * there and its desk keeps its pin, colour and links. With nothing to resume
 * the service says so first; it starts fresh there only once confirmed.
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
  confirm: (message: string) => boolean = (message) => window.confirm(message),
): Promise<TownMoveOutcome> {
  if (!source)
    return {
      status: "refused",
      reason: "unsupported",
      message: "Only a desk with one terminal moves to another runtime.",
    };
  const move = (fresh: boolean) =>
    call(
      "world.agent.move",
      {
        source,
        destination: {
          connection_id: room.workspaceRef.connectionId,
          generation: room.workspaceRef.generation,
          workspace_id: room.workspaceRef.nativeId,
        },
        ...(fresh ? { fresh: true } : {}),
      },
      180_000,
    ) as Promise<AgentMoveOutcome>;
  let result = await move(false);
  if (result.status === "confirm") {
    if (!confirm(result.message))
      return { status: "refused", reason: "cancelled", message: "Not moved." };
    result = await move(true);
  }
  if (result.status === "confirm")
    return {
      status: "refused",
      reason: "unsupported",
      message: result.message,
    };
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
      : {
          status: "refused",
          // The service's own reason and words (world/agent-move.ts).
          reason: result.reason ?? "refused",
          message: result.message,
        };
}

/**
 * Board's Move to… rooms for `source`: rooms of another runtime only. Two
 * connections of one Herdr (a startup default and a saved profile of the
 * same socket) are one runtime (equal `endpoint`, townBuildings.ts), so its
 * rooms are not "another runtime".
 */
export function otherRuntimeRooms<
  Room extends { connectionId: string; stale: boolean },
>(
  rooms: readonly Room[],
  source: { connection_id: string },
  endpointOf: (connectionId: string) => string | undefined,
): Room[] {
  const home = endpointOf(source.connection_id) ?? source.connection_id;
  return rooms.filter(
    (room) =>
      !room.stale &&
      (endpointOf(room.connectionId) ?? room.connectionId) !== home,
  );
}
