import { CORE_APP_SPACE_REASON, isCoreAppSpace } from "./coreRooms";
import type { OfficeRoom } from "./herdrOfficeProjection";
import type { WorldObject, WorldSpaceObject } from "./worldObject";

export type OfficeRoomActionCapabilities = {
  createSeat: boolean;
  rename: boolean;
  close: boolean;
  /** A herdr-core room: its actions show, disabled with this reason. */
  viewOnly?: string;
  /** Why rename and close are disabled while the room still takes agents. */
  manageReason?: string;
  /** A herdr-core room: its actions go through world.core.* (coreControl). */
  core?: true;
  /**
   * A herdr-core room's Git worktrees (create, open, remove): World runs
   * Git on the core's host and makes each worktree one of its own rooms.
   */
  worktrees?: true;
  /** A herdr-core room that is a linked worktree World opened: removable. */
  linkedWorktree?: true;
};

export type OfficeCreationActionState = {
  visible: boolean;
  enabled: boolean;
  reason: string | null;
};

// A World snapshot may spend 20s observing hosts. Keep retrying through that
// complete server window, then allow delivery and rendering a small grace.
export const CREATED_PANE_ADMISSION_TIMEOUT_MS = 21_000;
const CREATED_PANE_ADMISSION_RETRY_MS = 120;

export function createdPaneAdmissionRetryDelay(
  deadlineAt: number,
  now: number,
): number | null {
  const remaining = deadlineAt - now;
  return remaining > 0
    ? Math.min(CREATED_PANE_ADMISSION_RETRY_MS, remaining)
    : null;
}

export function officeCreationActionState(
  admitted: boolean,
  endpointReason: string | null,
  viewOnly?: string,
): OfficeCreationActionState {
  // Not silently missing: World only watches herdr-core, and says so.
  if (viewOnly) return { visible: true, enabled: false, reason: viewOnly };
  return {
    visible: admitted,
    enabled: admitted && endpointReason === null,
    reason: admitted ? endpointReason : null,
  };
}

export function officeSpaceForRoom(
  world: WorldObject,
  room: Pick<OfficeRoom, "hostKey" | "workspaceRef">,
): WorldSpaceObject | null {
  const space = world.nodeById.get(room.workspaceRef.worldId);
  return space?.kind === "space" &&
    space.parentId === room.hostKey &&
    space.connectionId === room.workspaceRef.connectionId &&
    space.generation === room.workspaceRef.generation &&
    space.nativeId === room.workspaceRef.nativeId
    ? space
    : null;
}

export function officeRoomActionCapabilities(
  world: WorldObject,
  room: Pick<OfficeRoom, "hostKey" | "workspaceRef" | "stale">,
): OfficeRoomActionCapabilities {
  return spaceRoomActionCapabilities(
    officeSpaceForRoom(world, room),
    room.stale,
  );
}

/**
 * What a workspace (room) can do now, from World's own space object: Town
 * and Board offer the same room actions.
 */
export function spaceRoomActionCapabilities(
  space: WorldSpaceObject | null,
  stale = false,
): OfficeRoomActionCapabilities {
  // A live herdr-core room takes agents and shells. World's own rooms are
  // renamed and closed in World; a Herdr app space is the app's.
  if (space?.coreControl && !space.stale && !stale) {
    const own = !isCoreAppSpace(space.nativeId);
    return {
      createSeat: true,
      rename: own,
      close: own,
      core: true,
      worktrees: true,
      ...(own && space.workspace.worktree?.is_linked_worktree === true
        ? { linkedWorktree: true as const }
        : {}),
      ...(own ? {} : { manageReason: CORE_APP_SPACE_REASON }),
    };
  }
  const operational = Boolean(
    space && space.actionable && !space.stale && !stale,
  );
  return {
    createSeat: operational && space?.capabilities.launcher === true,
    rename: operational && space?.capabilities.roomMutation === true,
    close: operational && space?.capabilities.roomMutation === true,
    ...(space?.viewOnly && !space.stale && !stale
      ? { viewOnly: space.viewOnly }
      : {}),
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
