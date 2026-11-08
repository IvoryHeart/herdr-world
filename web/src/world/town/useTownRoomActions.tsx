/**
 * Town's room and seat actions: whether a seat or room can be created here
 * and why not, and creating, renaming and closing rooms through their
 * dialogs. Each acts on the room's own connection and generation, captured
 * when its dialog opened.
 */

import { useMemo } from "react";
import { CreateWorkspaceDialog } from "../../components/CreateWorkspaceDialog";
import {
  creationPendingReason,
  type useCreationProgress,
} from "../../creationRequests";
import { connectionSnapshot, endpointCreationReason } from "../../store";
import { requestAgentLaunch } from "../agentProfiles";
import type { HerdrOfficeProjection } from "../herdrOfficeProjection";
import {
  officeCreationActionState,
  officeRoomActionCapabilities,
  type OfficeCreationActionState,
} from "../officeRoomActions";
import {
  closeRoom as closeSharedRoom,
  renameRoom,
  RoomRenameCloseDialogs,
} from "../roomRenameClose";
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
  /**
   * A building's + Add room doorway: a new room on its own host, from the
   * selected room when that room is in the building (as New room does).
   */
  const addRoomTarget = (hostKey: string, selectedRoomKey: string | null) => {
    const host = world.hosts.find((candidate) => candidate.id === hostKey);
    const selected = roomForKey(selectedRoomKey);
    const source =
      host &&
      selected?.workspaceRef.connectionId === host.connectionId &&
      selected.workspaceRef.generation === host.generation
        ? selected
        : null;
    return { host, source };
  };
  const addRoomState = (hostKey: string, selectedRoomKey: string | null) => {
    const { host, source } = addRoomTarget(hostKey, selectedRoomKey);
    if (source) return roomCreationState(source.key);
    const admitted = Boolean(host?.actionable && !host.stale);
    return officeCreationActionState(
      admitted,
      admitted
        ? endpointCreationReason(
            connectionSnapshot(creationSnapshot, host!.connectionId),
            "workspace.create",
          )
        : null,
    );
  };
  const canCreateRoom = (roomKey: string | null) =>
    roomCreationState(roomKey).enabled;
  const createRoomReason = (roomKey: string | null) =>
    roomCreationState(roomKey).reason;
  const onCreateRoom = (roomKey: string | null) =>
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
    });
  const canManageRoom = (roomKey: string, action: "rename" | "close") => {
    const room = roomForKey(roomKey);
    if (!room) return false;
    return officeRoomActionCapabilities(world, room)[action];
  };
  const roomTarget = (room: NonNullable<ReturnType<typeof roomForKey>>) => ({
    connectionId: room.workspaceRef.connectionId,
    generation: room.observedGeneration,
    workspaceId: room.workspaceRef.nativeId,
  });
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
    await renameRoom(roomTarget(room), roomDialog.label, label);
  };
  const closeRoom = async (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room || !canManageRoom(roomKey, "close")) return;
    setRoomDialog(null);
    await closeSharedRoom(roomTarget(room));
  };
  const roomActions = {
    showCreateSeat,
    canCreateSeat,
    createSeatReason,
    onNewAgent: (roomKey, from) => {
      const room = roomForKey(roomKey);
      if (!room || !canCreateSeat(roomKey)) return;
      beforeLaunch();
      requestAgentLaunch(
        {
          connectionId: room.workspaceRef.connectionId,
          generation: room.observedGeneration,
          workspaceId: room.workspaceRef.nativeId,
          workspaceLabel: room.displayLabel,
        },
        from,
      );
    },
    canCreateRoom,
    createRoomReason,
    onCreateRoom,
    addRoomState,
    onAddRoom: (hostKey, selectedRoomKey) => {
      const { host, source } = addRoomTarget(hostKey, selectedRoomKey);
      if (!host || !addRoomState(hostKey, selectedRoomKey).enabled) return;
      if (source) {
        onCreateRoom(source.key);
        return;
      }
      setRoomDialog({
        mode: "create",
        roomKey: null,
        owner: {
          connectionId: host.connectionId,
          runtimeGeneration: host.generation,
        },
      });
    },
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
      <RoomRenameCloseDialogs
        dialog={dialog?.mode === "create" ? null : dialog}
        onClose={() => setDialog(null)}
        onRename={(label) => void submitRenameRoom(label)}
        onConfirmClose={() => {
          if (dialog?.mode === "close") void closeRoom(dialog.roomKey);
        }}
      />
    </>
  );
}
