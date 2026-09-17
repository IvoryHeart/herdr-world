import type { OfficeRoom } from "./herdrOfficeProjection";
import type { WorldObject, WorldSpaceObject } from "./worldObject";

export type OfficeRoomActionCapabilities = {
  createSeat: boolean;
  rename: boolean;
  close: boolean;
};

export function officeSpaceForRoom(
  world: WorldObject,
  room: Pick<OfficeRoom, "hostKey" | "workspaceRef">,
): WorldSpaceObject | null {
  return (
    world.spaces.find(
      (space) =>
        space.connectionId === room.hostKey &&
        space.nativeId === room.workspaceRef.nativeId,
    ) ?? null
  );
}

export function officeRoomActionCapabilities(
  world: WorldObject,
  room: Pick<OfficeRoom, "hostKey" | "workspaceRef" | "stale">,
): OfficeRoomActionCapabilities {
  const space = officeSpaceForRoom(world, room);
  const operational = Boolean(
    space &&
      space.selectedHost &&
      space.actionable &&
      !space.stale &&
      !room.stale,
  );
  return {
    createSeat: operational && space?.capabilities.launcher === true,
    rename: operational && space?.capabilities.roomMutation === true,
    close: operational && space?.capabilities.roomMutation === true,
  };
}

export function officeRoomKeyForSelection(
  world: WorldObject,
  selectedId: string | null,
) {
  if (!selectedId) return null;
  const selected = world.nodeById.get(selectedId);
  if (!selected) return null;
  if (selected.kind === "space") return selected.id;
  return selected.kind === "agent" || selected.kind === "terminal"
    ? selected.parentId
    : null;
}

export function createdRootPaneId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const rootPane = (value as { root_pane?: unknown }).root_pane;
  if (!rootPane || typeof rootPane !== "object") return null;
  const paneId = (rootPane as { pane_id?: unknown }).pane_id;
  return typeof paneId === "string" && paneId ? paneId : null;
}
