import type { BridgeId, BridgeRuntime } from "../bridge";
import { supportsLauncherPresets } from "../launcherPresets";
import type { BridgeConnectionState } from "../runtimeConnection";
import { runtimeCommandReady, runtimeFeatureReady } from "../runtimeClient";
import type { HerdrOfficeProjection, OfficeRoom } from "./herdrOfficeProjection";

export type WorldSeatLaunchRequest = {
  bridgeId: BridgeId;
  workspaceId: string;
};

export type WorldRoomDialogRequest = {
  mode: "create" | "rename" | "close";
  bridgeId: BridgeId;
  workspaceId: string;
  label: string;
};

type CreateWorldRoomActionsOptions = {
  projection: HerdrOfficeProjection;
  getRuntime: (bridgeId: BridgeId | null | undefined) => BridgeRuntime | null;
  connectionStates: Readonly<Partial<Record<BridgeId, BridgeConnectionState>>>;
  selectedRuntimeId: BridgeId | null;
  selectedWorkspaceId: string | null;
  createTabSupported: boolean;
  requiredCapabilities: readonly string[];
  onStatus: (message: string) => void;
  onSelectBridge: (bridgeId: BridgeId) => void;
  onSelectWorkspace: (bridgeId: BridgeId, workspaceId: string) => void;
  onOpenSeatLauncher: (request: WorldSeatLaunchRequest) => void;
  onOpenRoomDialog: (request: WorldRoomDialogRequest) => void;
};

export type WorldRoomActions = {
  canCreateSeat: (roomKey: string) => boolean;
  openNewSeat: (roomKey?: string) => void;
  canCreateRoom: (roomKey?: string) => boolean;
  openNewRoom: (roomKey?: string) => void;
  canRenameRoom: (roomKey: string) => boolean;
  openRoomRename: (roomKey: string) => void;
  canCloseRoom: (roomKey: string) => boolean;
  openRoomClose: (roomKey: string) => void;
};

export function createWorldRoomActions({
  projection,
  getRuntime,
  connectionStates,
  selectedRuntimeId,
  selectedWorkspaceId,
  createTabSupported,
  requiredCapabilities,
  onStatus,
  onSelectBridge,
  onSelectWorkspace,
  onOpenSeatLauncher,
  onOpenRoomDialog,
}: CreateWorldRoomActionsOptions): WorldRoomActions {
  const roomForKey = (roomKey?: string) =>
    roomKey ? projection.rooms.find(({ key }) => key === roomKey) ?? null : null;

  const runtimeForRoom = (room?: OfficeRoom | null) =>
    getRuntime(room?.hostKey ?? selectedRuntimeId) ?? null;

  const canCreateSeat = (roomKey: string) => {
    const room = roomForKey(roomKey);
    if (!room) {
      return false;
    }
    const runtime = runtimeForRoom(room);
    const state = runtime ? connectionStates[runtime.id] : null;
    return Boolean(
      runtimeFeatureReady(runtime, state, "launcher_presets", requiredCapabilities) &&
      supportsLauncherPresets(runtime?.capabilities) &&
      runtimeCommandReady(runtime, state, "tab.create", requiredCapabilities),
    );
  };

  const openNewSeat = (roomKey?: string) => {
    const room = roomForKey(roomKey);
    const bridgeId = room?.hostKey ?? selectedRuntimeId;
    const workspaceId = room?.workspaceRef.nativeTargetId ?? selectedWorkspaceId;
    if (!bridgeId || !getRuntime(bridgeId)) {
      onStatus("Select a connected workspace before starting a seat.");
      return;
    }
    if (!workspaceId) {
      onStatus("No active workspace is available on this host.");
      return;
    }
    if (roomKey ? !canCreateSeat(roomKey) : !createTabSupported) {
      onStatus("New seats are unavailable on this host.");
      return;
    }
    onSelectWorkspace(bridgeId, workspaceId);
    onOpenSeatLauncher({ bridgeId, workspaceId });
  };

  const canCreateRoom = (roomKey?: string) => {
    const runtime = runtimeForRoom(roomForKey(roomKey));
    const state = runtime ? connectionStates[runtime.id] : null;
    return Boolean(
      runtimeCommandReady(runtime, state, "workspace.create", requiredCapabilities),
    );
  };

  const openNewRoom = (roomKey?: string) => {
    const runtime = runtimeForRoom(roomForKey(roomKey));
    if (!runtime || !canCreateRoom(roomKey)) {
      onStatus("Room creation is unavailable on this host.");
      return;
    }
    onSelectBridge(runtime.id);
    onOpenRoomDialog({
      mode: "create",
      bridgeId: runtime.id,
      workspaceId: "new",
      label: "",
    });
  };

  const canManageRoom = (
    roomKey: string,
    command: "workspace.rename" | "workspace.close",
  ) => {
    const room = roomForKey(roomKey);
    const runtime = runtimeForRoom(room);
    const state = runtime ? connectionStates[runtime.id] : null;
    return Boolean(
      room && runtimeCommandReady(runtime, state, command, requiredCapabilities),
    );
  };

  const openRoomDialog = (
    roomKey: string,
    mode: "rename" | "close",
    unavailableMessage: string,
  ) => {
    const room = roomForKey(roomKey);
    const command = mode === "rename" ? "workspace.rename" : "workspace.close";
    if (!room || !canManageRoom(roomKey, command)) {
      onStatus(unavailableMessage);
      return;
    }
    onOpenRoomDialog({
      mode,
      bridgeId: room.hostKey,
      workspaceId: room.workspaceRef.nativeTargetId,
      label: room.displayLabel,
    });
  };

  return {
    canCreateSeat,
    openNewSeat,
    canCreateRoom,
    openNewRoom,
    canRenameRoom: (roomKey) => canManageRoom(roomKey, "workspace.rename"),
    openRoomRename: (roomKey) =>
      openRoomDialog(roomKey, "rename", "Room renaming is unavailable on this host."),
    canCloseRoom: (roomKey) => canManageRoom(roomKey, "workspace.close"),
    openRoomClose: (roomKey) =>
      openRoomDialog(roomKey, "close", "Room closing is unavailable on this host."),
  };
}
