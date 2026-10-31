/**
 * Town's room and seat actions: whether a seat or room can be created here
 * and why not, and creating, renaming and closing rooms through their
 * dialogs. Each acts on the room's own connection and generation, captured
 * when its dialog opened.
 */

import { useMemo } from "react";
import { CreateWorkspaceDialog } from "../../components/CreateWorkspaceDialog";
import { ConfirmDialog, TextInputDialog } from "../../components/ModalDialogs";
import {
  creationPendingReason,
  type useCreationProgress,
} from "../../creationRequests";
import { connectionSnapshot, endpointCreationReason, store } from "../../store";
import { requestAgentLaunch } from "../agentProfiles";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  officeCreationActionState,
  officeRoomActionCapabilities,
  type OfficeCreationActionState,
} from "../officeRoomActions";
import type { WorldObject } from "../worldObject";
import type { TownRoomActions } from "./TownCanvas";

export type TownRoomDialog =
  | {
      mode: "create";
      roomKey: string | null;
      owner?: { connectionId: string; runtimeGeneration: number };
    }
  | {
      mode: "rename" | "close";
      roomKey: string;
      label: string;
      owner: { connectionId: string; runtimeGeneration: number };
    };

export function useTownRoomActions({
  world,
  office,
  creationSnapshot,
  creationProgress,
  roomDialog,
  setRoomDialog,
  beforeLaunch,
}: {
  world: WorldObject;
  office: HerdrOfficeProjection;
  /** The store state creation readiness reads (endpointCreationReason). */
  creationSnapshot: Parameters<typeof connectionSnapshot>[0];
  creationProgress: ReturnType<typeof useCreationProgress>;
  /** Town keeps the open dialog's state where it always has (hook order). */
  roomDialog: TownRoomDialog | null;
  setRoomDialog(dialog: TownRoomDialog | null): void;
  /** Called before a room's launcher opens (Town closes its peek). */
  beforeLaunch(): void;
}) {
  const roomForKey = (roomKey: string | null) =>
    roomKey
      ? (office.rooms.find(
          (room) =>
            room.key === roomKey &&
            (!roomDialog?.owner ||
              roomDialog.roomKey !== roomKey ||
              (room.workspaceRef.connectionId ===
                roomDialog.owner.connectionId &&
                room.workspaceRef.generation ===
                  roomDialog.owner.runtimeGeneration)),
        ) ?? null)
      : null;
  const seatCreationStates = useMemo(
    () =>
      Object.fromEntries(
        office.rooms.map((room) => {
          const admitted = officeRoomActionCapabilities(world, room).createSeat;
          return [
            room.key,
            officeCreationActionState(
              admitted,
              admitted
                ? (creationPendingReason(
                    {
                      connectionId: room.workspaceRef.connectionId,
                      runtimeGeneration: room.workspaceRef.generation,
                    },
                    "tab",
                    room.workspaceRef.nativeId,
                    creationProgress,
                  ) ??
                    endpointCreationReason(
                      connectionSnapshot(
                        creationSnapshot,
                        room.workspaceRef.connectionId,
                      ),
                      "tab.create",
                      room.workspaceRef.nativeId,
                    ))
                : null,
            ),
          ];
        }),
      ) as Record<string, OfficeCreationActionState>,
    [creationSnapshot, creationProgress, office.rooms, world],
  );
  const seatCreationState = (roomKey: string) =>
    seatCreationStates[roomKey] ?? officeCreationActionState(false, null);
  const showCreateSeat = (roomKey: string) =>
    seatCreationState(roomKey).visible;
  const canCreateSeat = (roomKey: string) => seatCreationState(roomKey).enabled;
  const createSeatReason = (roomKey: string) =>
    seatCreationState(roomKey).reason;
  const roomCreationState = (roomKey: string | null) => {
    const room = roomForKey(roomKey);
    const destination = room
      ? world.hosts.find(
          (host) =>
            host.connectionId === room.workspaceRef.connectionId &&
            host.generation === room.workspaceRef.generation,
        )
      : world.hosts.find((host) => host.actionable && !host.stale);
    const admitted = Boolean(destination?.actionable && !destination.stale);
    return officeCreationActionState(
      admitted,
      admitted
        ? endpointCreationReason(
            connectionSnapshot(creationSnapshot, destination!.connectionId),
            "workspace.create",
            room?.workspaceRef.nativeId,
          )
        : null,
    );
  };
  const showCreateRoom = (roomKey: string | null) =>
    roomCreationState(roomKey).visible;
  const canCreateRoom = (roomKey: string | null) =>
    roomCreationState(roomKey).enabled;
  const createRoomReason = (roomKey: string | null) =>
    roomCreationState(roomKey).reason;
  const canManageRoom = (roomKey: string, action: "rename" | "close") => {
    const room = roomForKey(roomKey);
    if (!room) return false;
    return officeRoomActionCapabilities(world, room)[action];
  };
  const reportRoomActionFailure = (action: string, cause: unknown) => {
    store.notify({
      kind: "error",
      message: `${action} failed`,
      detail: cause instanceof Error ? cause.message : String(cause),
    });
  };
  const submitRenameRoom = async (label: string) => {
    if (
      roomDialog?.mode !== "rename" ||
      !canManageRoom(roomDialog.roomKey, "rename")
    ) {
      return;
    }
    const room = roomForKey(roomDialog.roomKey);
    if (!room) return;
    setRoomDialog(null);
    const value = label.trim();
    if (value && value !== roomDialog.label) {
      try {
        await store.renameQualifiedWorkspace(
          {
            connectionId: room.workspaceRef.connectionId,
            runtimeGeneration: room.observedGeneration,
          },
          room.workspaceRef.nativeId,
          value,
        );
      } catch (cause) {
        reportRoomActionFailure("Room rename", cause);
      }
    }
  };
  const closeRoom = async (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room || !canManageRoom(roomKey, "close")) return;
    setRoomDialog(null);
    try {
      await store.closeQualifiedWorkspace(
        {
          connectionId: room.workspaceRef.connectionId,
          runtimeGeneration: room.observedGeneration,
        },
        room.workspaceRef.nativeId,
      );
    } catch (cause) {
      reportRoomActionFailure("Room close", cause);
    }
  };
  const roomActions = {
    showCreateSeat,
    canCreateSeat,
    createSeatReason,
    onNewAgent: (roomKey) => {
      const room = roomForKey(roomKey);
      if (!room || !canCreateSeat(roomKey)) return;
      beforeLaunch();
      requestAgentLaunch({
        connectionId: room.workspaceRef.connectionId,
        generation: room.observedGeneration,
        workspaceId: room.workspaceRef.nativeId,
        workspaceLabel: room.displayLabel,
      });
    },
    showCreateRoom,
    canCreateRoom,
    createRoomReason,
    onCreateRoom: (roomKey) =>
      setRoomDialog({
        mode: "create",
        roomKey,
        ...(roomForKey(roomKey)
          ? {
              owner: {
                connectionId: roomForKey(roomKey)!.workspaceRef.connectionId,
                runtimeGeneration: roomForKey(roomKey)!.workspaceRef.generation,
              },
            }
          : {}),
      }),
    canRenameRoom: (roomKey) => canManageRoom(roomKey, "rename"),
    onRenameRoom: (roomKey) => {
      const room = roomForKey(roomKey);
      if (room) {
        setRoomDialog({
          mode: "rename",
          roomKey,
          label: room.displayLabel,
          owner: {
            connectionId: room.workspaceRef.connectionId,
            runtimeGeneration: room.workspaceRef.generation,
          },
        });
      }
    },
    canCloseRoom: (roomKey) => canManageRoom(roomKey, "close"),
    onCloseRoom: (roomKey) => {
      const room = roomForKey(roomKey);
      if (room) {
        setRoomDialog({
          mode: "close",
          roomKey,
          label: room.displayLabel,
          owner: {
            connectionId: room.workspaceRef.connectionId,
            runtimeGeneration: room.workspaceRef.generation,
          },
        });
      }
    },
  } satisfies Partial<TownRoomActions>;
  return {
    roomForKey,
    roomActions,
    submitRenameRoom,
    closeRoom,
  };
}

/** The create, rename and close room dialogs. */
export function TownRoomDialogs({
  dialog,
  setDialog,
  roomForKey,
  submitRenameRoom,
  closeRoom,
}: Pick<
  ReturnType<typeof useTownRoomActions>,
  "roomForKey" | "submitRenameRoom" | "closeRoom"
> & {
  dialog: TownRoomDialog | null;
  setDialog(dialog: TownRoomDialog | null): void;
}) {
  return (
    <>
      <CreateWorkspaceDialog
        open={dialog?.mode === "create"}
        initialDestination={
          dialog?.owner
            ? {
                ...dialog.owner,
                sourceWorkspaceId: roomForKey(dialog.roomKey)?.workspaceRef
                  .nativeId,
              }
            : undefined
        }
        onClose={() => setDialog(null)}
      />
      <TextInputDialog
        open={dialog?.mode === "rename"}
        title="Rename room"
        label="Room name"
        initialValue={dialog?.mode === "rename" ? dialog.label : ""}
        submitLabel="Rename"
        onClose={() => setDialog(null)}
        onSubmit={(label) => void submitRenameRoom(label)}
      />
      <ConfirmDialog
        open={dialog?.mode === "close"}
        title="Close room"
        message={
          dialog?.mode === "close"
            ? `Close room “${dialog.label}”? Its running terminal sessions will end.`
            : ""
        }
        confirmLabel="Close room"
        danger
        onClose={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.mode === "close") {
            void closeRoom(dialog.roomKey);
          }
        }}
      />
    </>
  );
}
