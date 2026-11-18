import { ArrowLeft, ArrowRight } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TownRoomActions } from "./townRoomActions";

/**
 * A building's name on its sign: its handle. A drag (a touch hold) carries
 * the building to another lot; a tap zooms to it. Without a way to move
 * buildings it is only the name.
 */
export function TownBuildingName({
  hostKey,
  label,
  roomActions,
  onPress,
}: {
  hostKey: string;
  label: string;
  roomActions: TownRoomActions;
  /** The press, passed to the town beneath the sign. */
  onPress?(event: PointerEvent): boolean;
}) {
  const movable = Boolean(
    onPress &&
      (roomActions.buildingMoveNeighbor?.(hostKey, -1) ||
        roomActions.buildingMoveNeighbor?.(hostKey, 1)),
  );
  return (
    <strong
      className={movable ? "is-movable" : undefined}
      title={movable ? `Drag to move ${label}` : undefined}
      onPointerDown={
        movable
          ? (event: ReactPointerEvent<HTMLElement>) => {
              if (
                event.pointerType === "mouse"
                  ? event.button === 0
                  : event.isPrimary
              )
                onPress?.(event.nativeEvent);
            }
          : undefined
      }
    >
      {label}
    </strong>
  );
}

/**
 * A building's Move before and Move after, on its sign: it changes lots
 * with its neighbour in reading order. Nothing at either end, or when the
 * town has one building.
 */
export function TownBuildingMove({
  hostKey,
  label,
  roomActions,
}: {
  hostKey: string;
  label: string;
  roomActions: TownRoomActions;
}) {
  const { buildingMoveNeighbor, onMoveBuilding } = roomActions;
  if (!onMoveBuilding) return null;
  const before = buildingMoveNeighbor?.(hostKey, -1);
  const after = buildingMoveNeighbor?.(hostKey, 1);
  if (!before && !after) return null;
  const button = (step: -1 | 1, other: { label: string }) => (
    <button
      type="button"
      className="town-building-move"
      aria-label={`Move building ${label} ${step < 0 ? "before" : "after"} ${other.label}`}
      title={`Move ${step < 0 ? "before" : "after"} ${other.label}`}
      // The sign floats over the canvas: a press here is not a pan.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onMoveBuilding(hostKey, step);
      }}
    >
      {step < 0 ? (
        <ArrowLeft size={14} aria-hidden="true" />
      ) : (
        <ArrowRight size={14} aria-hidden="true" />
      )}
    </button>
  );
  return (
    <div
      className="town-building-moves"
      role="group"
      aria-label={`Move building ${label}`}
    >
      {before ? button(-1, before) : null}
      {after ? button(1, after) : null}
    </div>
  );
}
