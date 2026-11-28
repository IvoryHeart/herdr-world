import { bridge } from "../../api";
import type {
  AgentAddress,
  AgentMoveOutcome,
} from "../../../../shared/agentMove";
import { tabCardKey } from "../../../../shared/terminalColor";
import { moveBoardRefuses } from "../moveBoardRefuses";
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

/** The page's socket, as a move that outlives it sees it. */
export type MoveLink = {
  /** Changes whenever the page's socket closes. */
  epoch(): number;
  /** True once the socket is back, false after `waitMs`. */
  back(waitMs: number): Promise<boolean>;
};

const bridgeLink: MoveLink = {
  epoch: () => bridge.clientGeneration,
  back: (waitMs) =>
    new Promise((done) => {
      let stop = () => {};
      const timer = setTimeout(() => {
        stop();
        done(false);
      }, waitMs);
      stop = bridge.onStatus((status) => {
        if (status !== "connected") return;
        clearTimeout(timer);
        queueMicrotask(() => stop());
        done(true);
      });
    }),
};

const moveId = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");

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
  link: MoveLink = bridgeLink,
): Promise<TownMoveOutcome> {
  if (!source)
    return {
      status: "refused",
      reason: "unsupported",
      message: "Only a desk with one terminal moves to another runtime.",
    };
  const move = async (fresh: boolean): Promise<AgentMoveOutcome> => {
    const params = {
      source,
      destination: {
        connection_id: room.workspaceRef.connectionId,
        generation: room.workspaceRef.generation,
        workspace_id: room.workspaceRef.nativeId,
      },
      ...(fresh ? { fresh: true } : {}),
      ...(moveBoardRefuses() ? { test_board_refuses: true } : {}),
      move_id: moveId(),
    };
    // The move runs on in the service when the page's socket closes (a slow
    // link): once it is back, ask how this move ended, never move again.
    for (let follows = 0; ; follows += 1) {
      const epoch = link.epoch();
      try {
        return (await call(
          "world.agent.move",
          follows ? { ...params, follow: true } : params,
          180_000,
        )) as AgentMoveOutcome;
      } catch (error) {
        const lost =
          link.epoch() !== epoch ||
          String((error as Error)?.message).startsWith("timeout:");
        if (!lost || follows >= 3 || !(await link.back(60_000))) throw error;
      }
    }
  };
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
        // What stayed behind (its desk details), in the service's words.
        ...(result.message ? { message: result.message } : {}),
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
