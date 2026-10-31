import { planBoardPatch } from "../world/board-plan";
import { parseObservationBase } from "../world/observation-v1";
import { pruneSnapshotAppearance } from "../world/appearance-prune";
import {
  legacyAppearanceObservations,
  legacyAppearanceObservationOps,
} from "../world/appearance-observation";
import { handleAppearanceRpc } from "./appearance";
import { handleDeskRpc } from "./desk";
import { handleCompletionSeenRpc } from "./completion-seen";
import { profileWrite } from "../agent/profile-store";
import { recordSpawnClaims } from "../world/relations";
import { WorldSnapshotAdmission } from "../bridge/world-snapshot-admission";
import { sendWorldSnapshotReply } from "../bridge/world-snapshot-reply";
import { BoardConflictError, clientBoardOps } from "../world/board-store";
import type { BridgeRpcContext } from "./context";

/** Aggregate World methods: snapshot, board document, profiles, watchlist and completion seen (world.*). */
export function handleWorldRpc(
  rpc: BridgeRpcContext,
): false | Promise<false | void> {
  const { method } = rpc;
  if (!method.startsWith("world.")) return false;
  return dispatchWorldRpc(rpc);
}

async function dispatchWorldRpc(rpc: BridgeRpcContext): Promise<false | void> {
  const { id, method, params, req, sendError, sendReply, ws } = rpc;
  const {
    bindBoardRecipients,
    board,
    clients,
    connectionManager,
    logger,
    profiles,
    terminalSettings,
    publishBoardChanged,
    publishProfilesChanged,
    publishWatchlistChanged,
    publishWorldInvalidation,
    safeSend,
    snapshotAdmission,
    worldSnapshots,
    worldWatchlist,
    worldCli,
  } = rpc.services;
  if (method === "world.focused.observe") {
    try {
      rpc.services.focusedAcquisition.declare(ws, params);
      sendReply({ id, result: { ok: true } }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method.startsWith("world.appearance.")) return handleAppearanceRpc(rpc);
  if (method.startsWith("world.desk.")) return handleDeskRpc(rpc);
  if (method.startsWith("world.completion_seen."))
    return handleCompletionSeenRpc(rpc);
  if (method === "world.snapshot") {
    let transfer: ReturnType<WorldSnapshotAdmission["open"]> | undefined;
    try {
      const base = parseObservationBase(params);
      const snapshots = worldSnapshots;
      if (!snapshots) throw new Error("World snapshot service is unavailable");
      if (
        req.accept_world_snapshot_chunks === true &&
        req.accept_world_snapshot_chunk_admission === true
      )
        transfer = snapshotAdmission.open(ws, id);
      const beforeAppearanceRead = board().get();
      const snapshot = await snapshots.snapshot(params);
      void pruneSnapshotAppearance(
        board(),
        beforeAppearanceRead,
        snapshot,
        (connectionId, generation) => {
          const lease = connectionManager.readyRuntimeLease(connectionId);
          return lease && lease.generation === generation && lease.isCurrent()
            ? {
                call: (method, params) =>
                  lease.runtime.herdr.call(method, params, 10_000),
                isCurrent: () => lease.isCurrent(),
              }
            : null;
        },
        publishBoardChanged,
      ).catch((error) =>
        logger.warn("World could not prune absent appearance", {
          detail: String(error),
        }),
      );
      await recordSpawnClaims(
        board(),
        snapshot,
        publishBoardChanged,
        logger,
        rpc.services.clock.now(),
        (id, generation) => {
          const lease = connectionManager.readyRuntimeLease(id);
          return Boolean(
            lease && lease.generation === generation && lease.isCurrent(),
          );
        },
      );
      try {
        const observations = legacyAppearanceObservations(snapshot);
        let changed = false;
        const document = await board().patch(
          planBoardPatch([observations], (current) => {
            const appearanceOps = legacyAppearanceObservationOps(
              current,
              observations,
              (connectionId, generation) => {
                const lease = connectionManager.readyRuntimeLease(connectionId);
                return Boolean(
                  lease && lease.generation === generation && lease.isCurrent(),
                );
              },
            );
            changed = appearanceOps.length > 0;
            return changed ? appearanceOps : null;
          }),
        );
        if (changed) publishBoardChanged(document.revision);
      } catch (error) {
        logger.warn("World could not bind legacy tab colours", {
          detail: String(error),
        });
      }
      await sendWorldSnapshotReply(
        id,
        snapshots.observation.reply(snapshot, base),
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
  if (
    method === "world.asks.get" ||
    method === "world.ask.answer" ||
    method === "world.ask.dismiss" ||
    method === "world.ask.deliveries.get" ||
    method === "world.ask.delivery.get" ||
    method === "world.ask.delivery.resend" ||
    method === "world.ask.delivery.close"
  ) {
    try {
      sendReply({ id, result: await worldCli.rpc(method, params) }, method);
    } catch (error) {
      sendError(`${method}-error`, error);
    }
    return;
  }
  if (method === "world.board.get") {
    try {
      const document = board().get();
      await rpc.services.bindings?.settled();
      sendReply({ id, result: document }, "world-board-get");
    } catch (error) {
      sendError("world-board-get-error", error);
    }
    return;
  }
  if (method === "world.board.patch") {
    try {
      let ops: import("../world/board-store").BoardOp[] = [];
      let observed = new Map<
        string,
        import("../world/board-recipient").ObservedAgent
      >();
      const prepare = planBoardPatch(
        [params],
        (document: import("../world/board-store").BoardDocument) => {
          if (!rpc.requestIsCurrent())
            throw new Error("Board request is no longer current");
          ({ ops, observed } = clientBoardOps(
            (params as { ops?: unknown } | undefined)?.ops,
            document,
          ));
          return ops;
        },
      );
      const revision = (params as { revision?: unknown } | undefined)?.revision;
      if (
        revision !== undefined &&
        (!Number.isSafeInteger(revision) || Number(revision) < 0)
      )
        throw new Error("invalid Board revision");
      const result = await (revision === undefined
        ? board().patch(prepare)
        : board().patchIf(Number(revision), prepare));
      if (!result)
        throw new BoardConflictError(
          "The Board changed. Review the current Group before editing again.",
          board().get(),
        );
      publishBoardChanged(result.revision);
      await rpc.services.bindings?.settled();
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
      sendReply(
        { id, result: await terminalSettings().settled() },
        "world-profiles-get",
      );
    } catch (error) {
      sendError("world-profiles-get-error", error);
    }
    return;
  }
  if (method === "world.town_master.set") {
    try {
      const result = await terminalSettings().setMaster(params ?? {});
      sendReply({ id, result }, "world-town-master-set");
    } catch (error) {
      sendError("world-town-master-set-error", error);
    }
    return;
  }
  const profilesWrite = profileWrite(method);
  if (profilesWrite) {
    try {
      await profilesWrite(profiles(), params);
      const result = terminalSettings().get();
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
