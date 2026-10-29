import {
  appearanceForMove,
  capturedMoveColors,
  reconciledAppearanceOps,
} from "../world/appearance-move";
import { moveWorkspaceIds } from "../world/move-workspace-ids";
import { checkAnchor } from "../world/board-anchor";
import { linkedNoteText, sendNote } from "../world/board-send";
import { moveFollowOps, reconcileOps } from "../world/board-store";
import { createMoveQueue, moveDesk, movePane } from "../world/desk-move";
import type { ConnectionRpcContext } from "./context";

/** Board and Town actions on one connection (board.*, town.*). */
export function handleBoardTownRpc(
  rpc: ConnectionRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (
    !(
      method === "board.check_anchor" ||
      method === "board.send_note" ||
      method === "town.move_desk" ||
      method === "town.move_pane"
    )
  )
    return false;
  return dispatchBoardTownRpc(rpc);
}

async function dispatchBoardTownRpc(
  rpc: ConnectionRpcContext,
): Promise<false | void> {
  const {
    id,
    method,
    params,
    requestIsCurrent,
    route,
    sendError,
    sendReply,
    connection,
  } = rpc;
  const { board, logger, publishBoardChanged, townMoveQueues } = rpc.services;
  const { herdr } = connection;
  // Town desk and agent moves: several confirmed pane moves on this exact
  // connection and runtime generation, with rollback (see world/desk-move).
  if (method === "board.check_anchor") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result = await checkAnchor(
        (rpc, rpcParams) => herdr.call(rpc, rpcParams, 10_000),
        {
          kind: p.kind as "workspace" | "tab" | "pane",
          native_id: String(p.native_id ?? ""),
          isCurrent: requestIsCurrent,
        },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "board.send_note") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      // Send what the saved board says, not the caller's copy: the string
      // and note must still be the ones the user saw.
      const linked =
        route.scope === "connection"
          ? linkedNoteText(board().get(), {
              connection_id: route.connectionId,
              pane_id: String(p.pane_id ?? ""),
              terminal_id: String(p.terminal_id ?? ""),
              note_id: String(p.note_id ?? ""),
              string_id: String(p.string_id ?? ""),
              note_rev: Number(p.note_rev),
            })
          : ({
              status: "refused",
              reason: "changed",
              message: "No host was named; nothing was sent.",
            } as const);
      const result =
        "text" in linked
          ? await sendNote(
              (rpc, rpcParams) => herdr.call(rpc, rpcParams, 15_000),
              {
                pane_id: String(p.pane_id ?? ""),
                terminal_id: String(p.terminal_id ?? ""),
                text: linked.text,
                recipient: linked.recipient,
                confirm_recipient:
                  typeof p.confirm_recipient === "string"
                    ? p.confirm_recipient
                    : undefined,
                isCurrent: requestIsCurrent,
              },
            )
          : linked;
      // A confirmed replacement (or a newer token for the same agent)
      // becomes the string's recipient.
      if ("text" in linked && result.status === "sent" && result.recipient)
        try {
          publishBoardChanged(
            board().patch([
              {
                op: "anchor.recipient",
                string_id: String(p.string_id ?? ""),
                end: linked.end,
                connection_id: route.connectionId,
                pane_id: String(p.pane_id ?? ""),
                terminal_id: String(p.terminal_id ?? ""),
                recipient: result.recipient,
              },
            ]).revision,
          );
        } catch (error) {
          logger.warn("Board could not record a string's agent", {
            detail: String(error),
          });
        }
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "town.move_desk" || method === "town.move_pane") {
    const call = (rpc: string, rpcParams: Record<string, unknown>) =>
      herdr.call(rpc, rpcParams, 15_000);
    // One move at a time per connection: each re-reads the topology (and the
    // last-desk check) only once the previous move has finished.
    let queue = townMoveQueues.get(route.connectionId);
    if (!queue) {
      queue = createMoveQueue();
      townMoveQueues.set(route.connectionId, queue);
    }
    try {
      const p = params ?? {};
      await queue(async () => {
        const before = board().get();
        const colorChanged = board().captureColorChanges();
        // Preserve a captured choice if Herdr closes the old tab during relocation.
        const colorsBefore = before.appearance
          ? appearanceForMove(
              before,
              route.connectionId,
              (
                (await call("pane.list", {})) as {
                  panes: Record<string, unknown>[];
                }
              ).panes,
            ).layout.colors
          : before.layout.colors;
        if (!requestIsCurrent()) throw new Error("Move runtime changed");
        const result = await (method === "town.move_desk"
          ? moveDesk(call, {
              tab_id: String(p.tab_id ?? ""),
              workspace_id: String(p.workspace_id ?? ""),
              allow_close_room: p.allow_close_room === true,
              isCurrent: requestIsCurrent,
            })
          : movePane(call, {
              pane_id: String(p.pane_id ?? ""),
              tab_id: String(p.tab_id ?? ""),
              allow_close_room: p.allow_close_room === true,
              isCurrent: requestIsCurrent,
            }));
        // Keep native movement and its document reconciliation in the same queue slot.
        if (result.status === "moved" || result.status === "failed") {
          try {
            const movedTab =
              method === "town.move_desk" ? String(p.tab_id ?? "") : null;
            const workspaceIds =
              result.status === "moved" && movedTab
                ? await moveWorkspaceIds(call, result)
                : result.status === "failed" && board().get().appearance
                  ? new Set(
                      (
                        (await call("workspace.list", {})) as {
                          workspaces: { workspace_id: string }[];
                        }
                      ).workspaces.map((workspace) => workspace.workspace_id),
                    )
                  : new Set<string>();
            const observed =
              result.status === "moved" && board().get().appearance
                ? (
                    (await call("pane.list", {})) as {
                      panes: Record<string, unknown>[];
                    }
                  ).panes
                : [];
            if (!requestIsCurrent()) throw new Error("Move runtime changed");
            // Re-read after every asynchronous native probe so concurrent field/string edits survive.
            const current = board().get();
            const following =
              result.status === "moved" && current.appearance
                ? appearanceForMove(
                    current,
                    route.connectionId,
                    observed,
                    movedTab,
                    result,
                  )
                : current;
            const chosen = capturedMoveColors(
              colorsBefore,
              current,
              route.connectionId,
              colorChanged,
            );
            const carried =
              result.status === "moved" && current.appearance
                ? appearanceForMove(
                    {
                      ...current,
                      layout: { ...current.layout, colors: chosen },
                    },
                    route.connectionId,
                    observed,
                    movedTab,
                    result,
                  ).layout.colors
                : chosen;
            const ops =
              result.status === "moved"
                ? moveFollowOps(
                    following,
                    route.connectionId,
                    movedTab,
                    result,
                    movedTab
                      ? {
                          before: carried,
                          workspaceIds,
                          inherited: p.inherited_color === true,
                        }
                      : undefined,
                  )
                : reconcileOps(
                    current,
                    route.connectionId,
                    result.topology ?? [],
                  );
            if (result.status === "failed" && current.appearance)
              ops.push(
                ...reconciledAppearanceOps(
                  { ...current, layout: { ...current.layout, colors: chosen } },
                  route.connectionId,
                  result.topology ?? [],
                  workspaceIds,
                ),
              );
            if (!requestIsCurrent()) throw new Error("Move runtime changed");
            if (ops.length) publishBoardChanged(board().patch(ops).revision);
          } catch (error) {
            logger.warn("Board strings did not follow a move", {
              detail: String(error),
            });
          }
        }
        sendReply({ id, result }, method);
      });
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  return false;
}
