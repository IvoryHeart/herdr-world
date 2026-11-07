import { Plus } from "lucide-react";
import { TOWN_TILE as T, type TownLayout } from "./townLayout";
import type { TownRoomActions } from "./townRoomActions";
import "./townAddRoom.css";

/**
 * A building's + Add room slot: a dashed ghost room where its next room
 * would stand (townLayout's addRoom). It creates a room on that building's
 * host, as the town center's New room does, and the room takes its place.
 */
export function TownAddRoom({
  building,
  hostLabel,
  roomActions,
  selectedRoomKey,
}: {
  building: TownLayout["buildings"][number];
  hostLabel: string;
  roomActions: TownRoomActions;
  selectedRoomKey: string | null;
}) {
  const state = roomActions.addRoomState(building.hostKey, selectedRoomKey);
  if (!state.visible) return null;
  const { x, y, w, h } = building.addRoom;
  const label = `Add room to ${hostLabel}`;
  return (
    <button
      className="town-add-room"
      type="button"
      aria-label={label}
      title={state.reason ?? label}
      disabled={!state.enabled}
      data-host={building.hostKey}
      style={{ left: x * T, top: y * T, width: w * T, height: h * T }}
      onClick={() => roomActions.onAddRoom(building.hostKey, selectedRoomKey)}
    >
      <Plus size={28} strokeWidth={3} aria-hidden="true" />
      <span>Add room</span>
    </button>
  );
}
