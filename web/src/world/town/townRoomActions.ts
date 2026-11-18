/**
 * What Town's rooms can do: the actions TownView supplies to TownCanvas and
 * its room plaques, and a place's colour choice for the shared picker.
 */

import type { TownMoveResult } from "./townMoves";
import type { TownRoomPlacement } from "./townRoomPlace";
import type { TownMoveCommand } from "./scene/townInteraction";

/** A place's colour in the shared picker (ColorSwatch.tsx). */
export type PlaceColorChoice = {
  palette: readonly { id: string; hex: string }[];
  current: { id: string; custom: boolean };
  onColor(id: string | null): void;
  /** The default's colour, shown while the place has none of its own. */
  defaultHex?: string;
};

export type TownRoomActions = {
  showCreateSeat(roomKey: string): boolean;
  canCreateSeat(roomKey: string): boolean;
  createSeatReason(roomKey: string): string | null;
  /**
   * Open this room's launcher: Terminal, a profile or an agent kind. `from`
   * the town center, a started agent arrives there (townArrivals.ts).
   */
  onNewAgent(roomKey: string, from?: "center"): void;
  canCreateRoom(roomKey: string | null): boolean;
  createRoomReason(roomKey: string | null): string | null;
  onCreateRoom(roomKey: string | null): void;
  /**
   * Whether a building's + Add room doorway shows, can create, and why not. A
   * selected room of that building is the source, as for onCreateRoom.
   */
  addRoomState(
    hostKey: string,
    selectedRoomKey: string | null,
  ): {
    visible: boolean;
    enabled: boolean;
    reason: string | null;
  };
  /** New room on this building's host, from its + Add room doorway. */
  onAddRoom(hostKey: string, selectedRoomKey: string | null): void;
  /** Why a room's actions are disabled: World only watches herdr-core. */
  roomViewOnly?(roomKey: string): string | undefined;
  canRenameRoom(roomKey: string): boolean;
  onRenameRoom(roomKey: string): void;
  canCloseRoom(roomKey: string): boolean;
  onCloseRoom(roomKey: string): void;
  /** A herdr-core room's worktrees (new, open, remove): shown when offered. */
  canManageWorktrees?(roomKey: string): boolean;
  onWorktrees?(roomKey: string): void;
  /** List every pane of a desk with more panes than drawn seats. */
  onChoosePanes(deskKey: string): void;
  /** Keyboard move: choose another room for a desk (key M on its target). */
  onMoveDesk(deskKey: string): void;
  /** Keyboard move: choose another desk for an agent (key M on its target). */
  onMoveAgent(agentKey: string): void;
  /**
   * A room's (workspace's) or building's (host's) colour for the shared
   * picker; null when it cannot be changed here.
   */
  placeColor(kind: "room" | "host", key: string): PlaceColorChoice | null;
  /** A desk dragged onto another room; resolves how the move ended. */
  onDropDesk(deskKey: string, roomKey: string): Promise<TownMoveResult>;
  /**
   * A desk dragged within its room: into `ontoDeskKey`'s slot, or last when
   * null. Resolves how the reorder ended.
   */
  onReorderDesk(
    deskKey: string,
    ontoDeskKey: string | null,
  ): Promise<TownMoveResult>;
  /** An agent dragged onto another desk; resolves how the move ended. */
  onDropAgent(agentKey: string, deskKey: string): Promise<TownMoveResult>;
  /**
   * A room moved in its building (dropped, or a Move before/after): save
   * where every room of the building stands and put Herdr's workspace order
   * in reading order. Resolves how the move ended; without it a dropped room
   * goes back. `label` names what moved in its notes (Tidy rooms: the
   * building's rooms), else the room.
   */
  onPlaceRooms?(
    roomKey: string,
    placement: TownRoomPlacement,
    label?: string,
  ): Promise<TownMoveResult>;
  /**
   * A building's rooms were tidied (TownView says so, offering Undo, which
   * resolves how it ended), or were already tidy (`undo` null).
   */
  onRoomsTidied?(
    hostLabel: string,
    undo: (() => Promise<TownMoveResult>) | null,
  ): void;
  /** Whether the room's host can change its rooms now. */
  canMoveRoom?(roomKey: string): boolean;
  /**
   * Filled in by TownCanvas from the town it shows: the room a Move before
   * (-1) or after (1) changes places with, its neighbour in reading order.
   * Null at either end, or when the room cannot move.
   */
  roomMoveNeighbor?(roomKey: string, step: -1 | 1): { label: string } | null;
  /** Change places with that neighbour (TownCanvas fills this in). */
  onMoveRoom?(roomKey: string, step: -1 | 1): void;
  /** Whether a building has rooms to tidy (TownCanvas fills this in). */
  canTidyRooms?(hostKey: string): boolean;
  /**
   * Tidy rooms, from the building's reception board: its rooms glide into
   * the default arrangement (townRoomTidy), saved like a room move
   * (TownCanvas fills this in).
   */
  onTidyRooms?(hostKey: string): void;
  /**
   * A building moved to another lot (dropped, or a Move before/after): save
   * the order the buildings shown stand in, by host key. Resolves how the
   * move ended; without it a building cannot move.
   */
  onPlaceBuildings?(
    hostKey: string,
    order: readonly string[],
  ): Promise<TownMoveResult>;
  /**
   * Filled in by TownCanvas from the town it shows: the building a Move
   * before (-1) or after (1) changes lots with, its neighbour in reading
   * order. Null at either end, or when buildings cannot move.
   */
  buildingMoveNeighbor?(
    hostKey: string,
    step: -1 | 1,
  ): { label: string } | null;
  /** Change lots with that neighbour (TownCanvas fills this in). */
  onMoveBuilding?(hostKey: string, step: -1 | 1): void;
  /** Reveal the next group of desks, or fold the room back to 24. */
  onToggleFold?(roomKey: string, nextLimit?: number): void;
  /** A desk dragged onto another desk: join its team (townTeams.ts). */
  onGroupDesk(deskKey: string, targetDeskKey: string): Promise<TownMoveResult>;
  /** A grouped desk dropped on its own room's floor: leave its team. */
  onUngroupDesk(deskKey: string): Promise<TownMoveResult>;
  /** An agent, or a desk's agents, dropped on the bin or a bus stop. */
  onBinDrop?(kind: "agent" | "desk", key: string): void;
};

/** Carries out a finished Town drag through the view's actions. */
export function runTownMove(
  actions: TownRoomActions,
  command: TownMoveCommand,
): Promise<TownMoveResult> {
  switch (command.kind) {
    case "agent":
      return actions.onDropAgent(command.agentKey, command.deskKey);
    case "group":
      return actions.onGroupDesk(command.deskKey, command.targetDeskKey);
    case "ungroup":
      return actions.onUngroupDesk(command.deskKey);
    case "reorder":
      return actions.onReorderDesk(command.deskKey, command.ontoDeskKey);
    case "desk":
      return actions.onDropDesk(command.deskKey, command.roomKey);
    case "room":
      return (
        actions.onPlaceRooms?.(command.roomKey, command.placement) ??
        Promise.resolve("returned")
      );
    case "building":
      return (
        actions.onPlaceBuildings?.(command.hostKey, command.order) ??
        Promise.resolve("returned")
      );
  }
}
