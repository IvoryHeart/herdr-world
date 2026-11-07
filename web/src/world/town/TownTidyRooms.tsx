import { Sparkles } from "lucide-react";
import type { TownRoomActions } from "./townRoomActions";

/**
 * A building's Tidy rooms: named on its sign (seen from the town) and an
 * icon on its reception board (seen inside). Nothing when the building has
 * no room its host can change.
 */
export function TownTidyRooms({
  hostKey,
  hostLabel,
  roomActions,
  named = false,
}: {
  hostKey: string;
  hostLabel: string | undefined;
  roomActions: TownRoomActions;
  /** Show the words beside the sparkles (the building's sign). */
  named?: boolean;
}) {
  const { onTidyRooms, canTidyRooms } = roomActions;
  if (!onTidyRooms || !canTidyRooms?.(hostKey)) return null;
  return (
    <button
      type="button"
      className={
        named
          ? "town-tidy-rooms town-tidy-rooms-named"
          : "world-room-overlay-action town-tidy-rooms"
      }
      aria-label={`Tidy rooms in ${hostLabel ?? "this building"}`}
      title="Tidy rooms"
      // The sign floats over the canvas: a press here is not a pan.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onTidyRooms(hostKey);
      }}
    >
      <Sparkles size={14} aria-hidden="true" />
      {named ? "Tidy rooms" : null}
    </button>
  );
}
