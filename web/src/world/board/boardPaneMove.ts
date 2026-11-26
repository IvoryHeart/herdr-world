import { bridge } from "../../api";
import type { TownMoveOutcome } from "../town/townMoves";
import {
  cardAgentAddress,
  requestAgentHandoff,
  workspaceRoom,
} from "../town/townRuntimeMove";
import type { BoardPane, BoardTab, BoardWorkspace } from "./boardModel";

export type BoardPaneMoveRequest = {
  pane: BoardPane;
  source: BoardTab;
  target: BoardTab;
  sourceWorkspace: BoardWorkspace;
  targetWorkspace: BoardWorkspace;
};
export type BoardPaneMove = (
  request: BoardPaneMoveRequest,
  allowClose: boolean,
) => Promise<TownMoveOutcome>;

export function boardPaneMoveReason({
  pane,
  source,
  target,
  sourceWorkspace: from,
  targetWorkspace: to,
}: BoardPaneMoveRequest): string | null {
  if (source.key === target.key) return "The pane is already in that tab.";
  // Another runtime: the agent resumes there (world.agent.move).
  if (from.connectionId !== to.connectionId)
    return pane.leaf.stale || source.stale || from.stale || to.stale
      ? "The host is unavailable. Wait for a fresh connection."
      : source.workspaceKey !== from.key || target.workspaceKey !== to.key
        ? "The pane or tab changed. Try again."
        : cardAgentAddress(source, from)
          ? null
          : "Only a card with one terminal moves to another runtime.";
  if (
    !pane.leaf.actionable ||
    pane.leaf.stale ||
    !source.actionable ||
    source.stale ||
    !target.actionable ||
    target.stale ||
    !from.actionable ||
    !to.actionable
  )
    return "The host is unavailable. Wait for a fresh connection.";
  if (
    source.workspaceKey !== from.key ||
    target.workspaceKey !== to.key ||
    !source.panes.some((entry) => entry.key === pane.key)
  )
    return "The pane or tab changed. Try again.";
  if (
    from.connectionId !== to.connectionId ||
    from.generation !== to.generation ||
    pane.leaf.connectionId !== from.connectionId ||
    pane.leaf.generation !== from.generation
  )
    return "Panes move only within one host and its current runtime.";
  return null;
}

/** The service, shared with Town, reads the full destination layout and follows strings. */
export async function moveBoardPane(
  request: BoardPaneMoveRequest,
  allowClose: boolean,
  connect: (
    id: string,
    generation: number,
  ) => {
    call(
      method: string,
      params: Record<string, unknown>,
      timeout?: number,
    ): Promise<unknown>;
  } = (id, generation) => bridge.connection(id, generation),
  call: typeof bridge.call = bridge.call.bind(bridge),
): Promise<TownMoveOutcome> {
  const reason = boardPaneMoveReason(request);
  if (reason)
    return { status: "refused", reason: "unavailable", message: reason };
  const { pane, target, source, sourceWorkspace: from } = request;
  if (from.connectionId !== request.targetWorkspace.connectionId)
    return requestAgentHandoff(
      cardAgentAddress(source, from),
      workspaceRoom(request.targetWorkspace),
      call,
    );
  const result = await connect(
    pane.leaf.connectionId,
    pane.leaf.generation,
  ).call(
    "town.move_pane",
    {
      pane_id: pane.leaf.pane.pane_id,
      tab_id: target.nativeId,
      allow_close_room: allowClose,
    },
    90_000,
  );
  const outcome = result as Partial<TownMoveOutcome> | undefined;
  if (
    outcome?.status === "moved" ||
    outcome?.status === "refused" ||
    outcome?.status === "failed"
  )
    return outcome as TownMoveOutcome;
  return {
    status: "failed",
    rolled_back: false,
    topology_known: false,
    message: "The host did not report the pane's location. Check both tabs.",
  };
}
