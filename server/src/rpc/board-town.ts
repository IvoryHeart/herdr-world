import { planBoardPatch } from "../world/board-plan";
import { checkAnchor } from "../world/board-anchor";
import { linkedNoteText, sendNote } from "../world/board-send";
import { executeTownMove } from "../world/town-move";
import type { ConnectionRpcContext } from "./context";
import { qualifyBoardSend } from "../world/board-binding-send";

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
      const readLinked = () =>
        linkedNoteText(board().get(), {
          connection_id: route.connectionId,
          pane_id: String(p.pane_id ?? ""),
          terminal_id: String(p.terminal_id ?? ""),
          note_id: String(p.note_id ?? ""),
          string_id: String(p.string_id ?? ""),
          note_rev: Number(p.note_rev),
        });
      let linked =
        route.scope === "connection"
          ? readLinked()
          : ({
              status: "refused",
              reason: "changed",
              message: "No host was named; nothing was sent.",
            } as const);
      const attached =
        "text" in linked &&
        rpc.services.bindings &&
        rpc.services.serviceIncarnation &&
        (await qualifyBoardSend(rpc.services.bindings, {
          record_id: String(p.string_id ?? ""),
          slot: linked.end,
          pane_id: String(p.pane_id ?? ""),
          terminal_id: String(p.terminal_id ?? ""),
          fence: {
            adapter: "herdr",
            instance: route.connectionId,
            generation: route.generation,
            service_incarnation: rpc.services.serviceIncarnation,
          },
          isCurrent: requestIsCurrent,
          call: (method, params) => herdr.call(method, params, 10_000),
        }));
      // The note/string may change while its source listing or commit is awaited.
      if (attached) linked = readLinked();
      const result =
        "text" in linked && attached
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
          : "text" in linked
            ? {
                status: "refused" as const,
                reason: "changed" as const,
                message:
                  "That pane is no longer the one this note is strung to.",
              }
            : linked;
      // A confirmed replacement (or a newer token for the same agent)
      // becomes the string's recipient.
      if ("text" in linked && result.status === "sent" && result.recipient)
        try {
          publishBoardChanged(
            (
              await board().patch(
                planBoardPatch([linked, result, p, route], () => {
                  if (!requestIsCurrent())
                    throw new Error(
                      "Board send runtime changed before saving recipient",
                    );
                  return [
                    {
                      op: "anchor.recipient",
                      string_id: String(p.string_id ?? ""),
                      end: linked.end,
                      connection_id: route.connectionId,
                      pane_id: String(p.pane_id ?? ""),
                      terminal_id: String(p.terminal_id ?? ""),
                      recipient: result.recipient!,
                    },
                  ];
                }),
              )
            ).revision,
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
    try {
      const p = params ?? {};
      const result = await executeTownMove(
        {
          connectionId: route.connectionId,
          generation: route.generation,
          call,
          isCurrent: requestIsCurrent,
          queues: townMoveQueues,
          board: {
            get: () => board().get(),
            patch: (ops) => board().patch(ops),
            patchIf: (revision, ops) => board().patchIf(revision, ops),
            captureColorChanges: () => board().captureColorChanges(),
            captureAppearanceChanges: () => board().captureAppearanceChanges(),
          },
          publishBoard: publishBoardChanged,
          onFollowError: (error) =>
            logger.warn("Board strings did not follow a move", {
              detail: String(error),
            }),
        },
        method === "town.move_desk"
          ? {
              kind: "desk",
              tab_id: String(p.tab_id ?? ""),
              workspace_id: String(p.workspace_id ?? ""),
              allow_close_room: p.allow_close_room === true,
              inherited_color: p.inherited_color === true,
            }
          : {
              kind: "pane",
              pane_id: String(p.pane_id ?? ""),
              tab_id: String(p.tab_id ?? ""),
              allow_close_room: p.allow_close_room === true,
            },
      );
      sendReply({ id, result }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  return false;
}
