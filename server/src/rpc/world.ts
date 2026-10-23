import { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import { sendWorldSnapshotReply } from "../bridge/world-snapshot-reply";
import { BoardConflictError, clientBoardOps } from "../world/board-store";
import type { BridgeRpcContext } from "./context";

/** Aggregate World methods: snapshot, board document, profiles and watchlist (world.*). */
export async function handleWorldRpc(
  rpc: BridgeRpcContext,
): Promise<false | void> {
  const { id, method, params, req, sendError, sendReply, ws } = rpc;
  const {
    bindBoardRecipients,
    board,
    clients,
    connectionManager,
    logger,
    profiles,
    publishBoardChanged,
    publishProfilesChanged,
    publishWatchlistChanged,
    publishWorldInvalidation,
    safeSend,
    snapshotAdmission,
    worldSnapshots,
    worldWatchlist,
  } = rpc.services;
  if (method === "world.snapshot") {
    let transfer: ReturnType<WorldSnapshotAdmission["open"]> | undefined;
    try {
      const snapshots = worldSnapshots;
      if (!snapshots) throw new Error("World snapshot service is unavailable");
      if (
        req.accept_world_snapshot_chunks === true &&
        req.accept_world_snapshot_chunk_admission === true
      )
        transfer = snapshotAdmission.open(ws, id);
      await sendWorldSnapshotReply(
        id,
        await snapshots.snapshot(params),
        req.accept_world_snapshot_chunks === true,
        (payload) => safeSend(ws, payload, "world-snapshot"),
        () => clients.has(ws),
        transfer?.wait,
      );
    } catch (error) {
      sendError("world-snapshot-error", error);
    } finally {
      transfer?.close();
    }
    return;
  }
  if (method === "world.board.get") {
    try {
      sendReply({ id, result: board().get() }, "world-board-get");
    } catch (error) {
      sendError("world-board-get-error", error);
    }
    return;
  }
  if (method === "world.board.patch") {
    try {
      const { ops, observed } = clientBoardOps(
        (params as { ops?: unknown } | undefined)?.ops,
      );
      const result = board().patch(ops);
      publishBoardChanged(result.revision);
      sendReply({ id, result: { document: result } }, "world-board-patch");
      void bindBoardRecipients(ops, observed).catch((error) =>
        logger.warn("Board could not record a string's agent", {
          detail: String(error),
        }),
      );
    } catch (error) {
      if (error instanceof BoardConflictError)
        sendReply(
          { id, result: { conflict: error.message, document: error.document } },
          "world-board-patch",
        );
      else sendError("world-board-patch-error", error);
    }
    return;
  }
  if (method === "world.profiles.get") {
    try {
      sendReply({ id, result: profiles().get() }, "world-profiles-get");
    } catch (error) {
      sendError("world-profiles-get-error", error);
    }
    return;
  }
  if (method === "world.profiles.save" || method === "world.profiles.delete") {
    try {
      const p = (params ?? {}) as Record<string, unknown>;
      const result =
        method === "world.profiles.save"
          ? profiles().save(p.profile)
          : profiles().delete(String(p.id ?? ""));
      publishProfilesChanged(result.revision);
      sendReply({ id, result }, "world-profiles-write");
    } catch (error) {
      sendError("world-profiles-write-error", error);
    }
    return;
  }
  if (method === "world.watchlist.list") {
    sendReply({ id, result: worldWatchlist.list() }, "world-watchlist-list");
    return;
  }
  if (method === "world.watchlist.pin" || method === "world.watchlist.unpin") {
    try {
      const identity = params as Record<string, unknown> | undefined;
      const connectionId = identity?.connection_id;
      const generation = identity?.connection_generation;
      const terminalId = identity?.terminal_id;
      if (
        typeof connectionId !== "string" ||
        !connectionId ||
        !Number.isSafeInteger(generation) ||
        (generation as number) < 0 ||
        typeof terminalId !== "string" ||
        !terminalId
      ) {
        throw new Error("invalid World watch identity");
      }
      if (method === "world.watchlist.unpin") {
        const result = worldWatchlist.unpin({
          connection_id: connectionId,
          connection_generation: generation as number,
          terminal_id: terminalId,
        });
        if (result.changed) {
          publishWorldInvalidation(connectionId, generation as number);
          publishWatchlistChanged(result.revision);
        }
        sendReply(
          { id, result: { ...worldWatchlist.list(), changed: result.changed } },
          "world-watchlist-unpin",
        );
        return;
      }
      const lease = connectionManager.readyRuntimeLease(connectionId);
      if (!lease || lease.generation !== generation || !lease.isCurrent()) {
        throw new Error("World watch target is unavailable");
      }
      const paneResult = await lease.runtime.herdr.call("pane.list", {}, 5_000);
      const panes = (paneResult as { panes?: unknown })?.panes;
      const matches = Array.isArray(panes)
        ? panes.filter(
            (pane) =>
              pane &&
              typeof pane === "object" &&
              (pane as Record<string, unknown>).terminal_id === terminalId,
          )
        : [];
      if (!lease.isCurrent() || matches.length !== 1) {
        throw new Error("World watch target is unavailable");
      }
      const result = worldWatchlist.pin({
        connection_id: connectionId,
        connection_generation: generation as number,
        terminal_id: terminalId,
        label: typeof identity?.label === "string" ? identity.label : "Watch",
      });
      if (result.changed) {
        publishWorldInvalidation(connectionId, generation as number);
        publishWatchlistChanged(result.revision);
      }
      sendReply(
        { id, result: { ...worldWatchlist.list(), changed: result.changed } },
        "world-watchlist-pin",
      );
    } catch (error) {
      sendError("world-watchlist-error", error);
    }
    return;
  }
  if (method.startsWith("world.")) {
    sendError(
      "unknown-world-method",
      new Error(`unknown bridge-global method: ${method}`),
    );
    return;
  }
  return false;
}
