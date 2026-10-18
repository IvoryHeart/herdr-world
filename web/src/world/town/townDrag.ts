import type { TownLevel } from "./townCamera";
import type { TownHit } from "./townHitTest";
import type { TownModel } from "./townModel";

/** A desk or agent being dragged, and where it would land. */
export type TownDrag = {
  kind: "desk" | "agent";
  key: string;
  hostKey: string;
  /** The desk's room, or the agent's desk: dropping there does nothing. */
  from: string;
  label: string;
  target?: { key: string | null; label: string };
};

/** What a held press picks up: a desk or a seated agent, zoomed in. */
export function townDragFor(
  hit: TownHit | null,
  model: TownModel,
  level: TownLevel,
): TownDrag | null {
  if (!hit || (level !== "room" && level !== "desk")) return null;
  if (hit.kind === "agent") {
    const agent = model.agents.get(hit.key);
    const seat = model.agentSeats.get(hit.key);
    if (!agent || !seat || !agent.canOpenInSpaces || agent.stale) return null;
    return {
      kind: "agent",
      key: agent.key,
      hostKey: agent.hostKey,
      from: seat.deskKey,
      label: `Move ${agent.displayLabel}`,
    };
  }
  const deskKey =
    hit.kind === "desk" ? hit.key : hit.kind === "pane" ? hit.deskKey : null;
  const desk = deskKey ? model.desks.get(deskKey) : undefined;
  if (!desk || !desk.canOpenInSpaces) return null;
  return {
    kind: "desk",
    key: desk.key,
    hostKey: desk.hostKey,
    from: desk.roomKey,
    label: `Move ${desk.displayLabel}`,
  };
}

/** Where a drag would land under the pointer, or why it can't. */
export function townDropTarget(
  drag: TownDrag,
  hit: TownHit | null,
  model: TownModel,
): { key: string | null; label: string } {
  if (drag.kind === "desk") {
    const roomKey =
      hit?.kind === "room"
        ? hit.key
        : hit?.kind === "cell"
          ? hit.roomKey
          : hit?.kind === "desk"
            ? model.desks.get(hit.key)?.roomKey
            : hit?.kind === "pane"
              ? model.desks.get(hit.deskKey)?.roomKey
              : hit?.kind === "agent"
                ? model.agents.get(hit.key)?.roomKey
                : undefined;
    const room = roomKey ? model.rooms.get(roomKey) : undefined;
    if (!room) return { key: null, label: `${drag.label}: drop on a room` };
    if (room.hostKey !== drag.hostKey)
      return { key: null, label: "Desks move only within one host" };
    if (room.key === drag.from)
      return { key: null, label: `${drag.label}: already in this room` };
    return { key: room.key, label: `${drag.label} to ${room.displayLabel}` };
  }
  const deskKey =
    hit?.kind === "desk"
      ? hit.key
      : hit?.kind === "pane"
        ? hit.deskKey
        : hit?.kind === "agent"
          ? model.agentSeats.get(hit.key)?.deskKey
          : undefined;
  const desk = deskKey ? model.desks.get(deskKey) : undefined;
  if (!desk) return { key: null, label: `${drag.label}: drop on a desk` };
  if (desk.hostKey !== drag.hostKey)
    return { key: null, label: "Agents move only within one host" };
  if (desk.key === drag.from)
    return { key: null, label: `${drag.label}: already at this desk` };
  return { key: desk.key, label: `${drag.label} to ${desk.displayLabel}` };
}
