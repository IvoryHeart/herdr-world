import {
  createMoveQueue,
  moveDesk,
  movePane,
  type DeskMoveRequest,
  type PaneMoveRequest,
  type HerdrCall,
  type MoveOutcome,
} from "./desk-move";
import {
  moveFollowOps,
  reconcileOps,
  type BoardDocument,
  type BoardOp,
} from "./board-store";
import { moveWorkspaceIds } from "./move-workspace-ids";

export type TownMoveRequest =
  | (Omit<DeskMoveRequest, "isCurrent"> & {
      kind: "desk";
      inherited_color?: boolean;
    })
  | (Omit<PaneMoveRequest, "isCurrent"> & { kind: "pane" });
export type TownMoveContext = {
  /** The exact captured connection/runtime, never a default-connection lookup. */
  connectionId: string;
  generation: number;
  call: HerdrCall;
  isCurrent(): boolean;
  /** The service-owned map shared by every adapter. */
  queues: Map<string, ReturnType<typeof createMoveQueue>>;
  board: {
    get(): BoardDocument;
    patch(ops: readonly BoardOp[]): BoardDocument;
  };
  publishBoard(revision: number): void;
  onFollowError(error: unknown): void;
};

/** Shared execution only. RPC and CLI retain their transport and argument rules. */
export async function executeTownMove(
  context: TownMoveContext,
  prepare:
    | TownMoveRequest
    | (() => Promise<
        TownMoveRequest | Extract<MoveOutcome, { status: "refused" }>
      >),
): Promise<MoveOutcome> {
  let queue = context.queues.get(context.connectionId);
  if (!queue) {
    queue = createMoveQueue();
    context.queues.set(context.connectionId, queue);
  }
  let colorsBefore!: BoardDocument["layout"]["colors"];
  let request: TownMoveRequest;
  const result = await queue(async (): Promise<MoveOutcome> => {
    if (!context.isCurrent())
      return {
        status: "refused",
        reason: "stale",
        message: "The host reconnected. Try again.",
      };
    // The move functions reread topology after admission to the queue. Capture
    // colours here too: a preceding move or a close can have changed them.
    colorsBefore = context.board.get().layout.colors;
    const prepared = typeof prepare === "function" ? await prepare() : prepare;
    if ("status" in prepared) return prepared;
    request = prepared;
    if (!context.isCurrent())
      return {
        status: "refused",
        reason: "stale",
        message: "The host reconnected. Read Groups again.",
      };
    return request.kind === "desk"
      ? moveDesk(context.call, { ...request, isCurrent: context.isCurrent })
      : movePane(context.call, { ...request, isCurrent: context.isCurrent });
  });

  // Preserve the existing ordering: following observed Board anchors is after
  // move serialization, and must not hold the queue through workspace reads.
  if (result.status === "moved" || result.status === "failed") {
    try {
      const ops =
        result.status === "moved"
          ? moveFollowOps(
              context.board.get(),
              context.connectionId,
              request!.kind === "desk" ? request!.tab_id : null,
              result,
              request!.kind === "desk"
                ? {
                    before: colorsBefore,
                    workspaceIds: await moveWorkspaceIds(context.call, result),
                    inherited: request!.inherited_color === true,
                  }
                : undefined,
            )
          : reconcileOps(
              context.board.get(),
              context.connectionId,
              result.topology ?? [],
            );
      if (ops.length) context.publishBoard(context.board.patch(ops).revision);
    } catch (error) {
      context.onFollowError(error);
    }
  }
  return result;
}
