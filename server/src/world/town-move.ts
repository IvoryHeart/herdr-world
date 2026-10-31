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
  type BoardStore,
} from "./board-store";
import { moveWorkspaceIds } from "./move-workspace-ids";
import {
  appearanceForMove,
  capturedMoveColors,
  reconciledAppearanceOps,
  moveAppearanceEditOps,
} from "./appearance-move";
import type { AppearanceChanges } from "./appearance-edits";
import { terminalSettingsMoveCall } from "../agent/terminal-tokens";

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
  board: Pick<
    BoardStore,
    "get" | "patch" | "captureColorChanges" | "captureAppearanceChanges"
  >;
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
  context = {
    ...context,
    call: terminalSettingsMoveCall(context.call, context.isCurrent),
  };
  let queue = context.queues.get(context.connectionId);
  if (!queue) {
    queue = createMoveQueue();
    context.queues.set(context.connectionId, queue);
  }
  return queue(async (): Promise<MoveOutcome> => {
    if (!context.isCurrent())
      return {
        status: "refused",
        reason: "stale",
        message: "The host reconnected. Try again.",
      };
    // The move functions reread topology after admission to the queue. Capture
    // colours here too: a preceding move or a close can have changed them.
    const before = context.board.get();
    const colorChanged = context.board.captureColorChanges();
    const appearanceChanged = context.board.captureAppearanceChanges();
    const colorsBefore = before.appearance
      ? appearanceForMove(
          before,
          context.connectionId,
          (
            (await context.call("pane.list", {})) as {
              panes: Record<string, unknown>[];
            }
          ).panes,
        ).layout.colors
      : before.layout.colors;
    const prepared = typeof prepare === "function" ? await prepare() : prepare;
    if ("status" in prepared) return prepared;
    const request = prepared;
    if (!context.isCurrent())
      return {
        status: "refused",
        reason: "stale",
        message: "The host reconnected. Read Groups again.",
      };
    const result = await (request.kind === "desk"
      ? moveDesk(context.call, { ...request, isCurrent: context.isCurrent })
      : movePane(context.call, { ...request, isCurrent: context.isCurrent }));
    // Shared appearance requires native movement and its latest
    // document reconciliation to finish in this slot, for both RPC and CLI.
    if (result.status === "moved" || result.status === "failed") {
      try {
        await followMove(
          context,
          request,
          result,
          colorsBefore,
          colorChanged,
          appearanceChanged,
        );
      } catch (error) {
        context.onFollowError(error);
      }
    }
    return result;
  });
}

async function followMove(
  context: TownMoveContext,
  request: TownMoveRequest,
  result: Extract<MoveOutcome, { status: "moved" | "failed" }>,
  colorsBefore: BoardDocument["layout"]["colors"],
  colorChanged: ReturnType<BoardStore["captureColorChanges"]>,
  appearanceChanged: AppearanceChanges,
) {
  const movedTab = request.kind === "desk" ? request.tab_id : null;
  const workspaceIds =
    result.status === "moved" && movedTab
      ? await moveWorkspaceIds(context.call, result)
      : result.status === "failed" && context.board.get().appearance
        ? new Set(
            (
              (await context.call("workspace.list", {})) as {
                workspaces: { workspace_id: string }[];
              }
            ).workspaces.map((workspace) => workspace.workspace_id),
          )
        : new Set<string>();
  const observed =
    result.status === "moved" && context.board.get().appearance
      ? (
          (await context.call("pane.list", {})) as {
            panes: Record<string, unknown>[];
          }
        ).panes
      : [];
  if (!context.isCurrent()) throw new Error("Move runtime changed");
  // Read after every asynchronous native probe so concurrent field/string edits survive.
  const current = context.board.get();
  const following =
    result.status === "moved" && current.appearance
      ? appearanceForMove(
          current,
          context.connectionId,
          observed,
          movedTab,
          result,
        )
      : current;
  const chosen = capturedMoveColors(
    colorsBefore,
    current,
    context.connectionId,
    colorChanged,
  );
  const carried =
    result.status === "moved" && current.appearance
      ? appearanceForMove(
          { ...current, layout: { ...current.layout, colors: chosen } },
          context.connectionId,
          observed,
          movedTab,
          result,
        ).layout.colors
      : chosen;
  const ops =
    result.status === "moved"
      ? moveFollowOps(
          following,
          context.connectionId,
          movedTab,
          result,
          movedTab
            ? {
                before: carried,
                workspaceIds,
                inherited:
                  request.kind === "desk" && request.inherited_color === true,
              }
            : undefined,
        )
      : reconcileOps(current, context.connectionId, result.topology ?? []);
  if (result.status === "failed" && current.appearance)
    ops.push(
      ...reconciledAppearanceOps(
        { ...current, layout: { ...current.layout, colors: chosen } },
        context.connectionId,
        result.topology ?? [],
        workspaceIds,
      ),
    );
  ops.push(
    ...moveAppearanceEditOps(
      following,
      ops,
      appearanceChanged,
      result.status === "moved" && movedTab
        ? {
            connectionId: context.connectionId,
            from: movedTab,
            to: result.tab_id,
            workspaceIds,
          }
        : null,
    ),
  );
  if (!context.isCurrent()) throw new Error("Move runtime changed");
  if (ops.length) context.publishBoard(context.board.patch(ops).revision);
}
